const fs = require('node:fs/promises')
const { COPYFILE_EXCL } = require('node:fs').constants
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { mediaPath, originalPath } = require('../media-paths')
const mediaFiles = require('../media-files')
const ffmpeg = require('../ffmpeg')
const { readTrack } = require('./recorder')
const { preferences } = require('./overlay-layout')
const { normalizeMix } = require('../audio/mix')

function installInputExport({ ipcMain, store }) {
  const jobs = new Map()
  const version = clip => String(clip.mediaRevision || clip.sizeBytes)
  const cleanup = async job => {
    if (jobs.get(job.sender) === job) jobs.delete(job.sender)
    job.sender.removeListener('destroyed', job.cancel)
    job.sender.removeListener('render-process-gone', job.cancel)
    if (job.dir) await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {})
  }
  const get = (sender, id) => {
    const job = jobs.get(sender)
    if (job?.id !== id || !job.dir || job.finishing) throw Error('La exportación ya no está disponible.')
    return job
  }

  const findClip = async (source) => {
    const url = new URL(source)
    const clipsDir = await store.getClipsDir()
    const name = decodeURIComponent(url.pathname.split('/')[1] || '')
    const clip = url.protocol === 'clip:' && (url.host === 'media'
      ? await store.getClip(name)
      : url.host === 'local' && (await store.listClips()).find(c => !c.storageDir && c.fileName === name))
    if (!clip || version(clip) !== url.searchParams.get('v')) throw Error('Volvé a abrir el clip para guardar los cambios.')
    return { clip, clipsDir, editing: url.searchParams.get('edit') === '1' }
  }

  const invalidate = async (clip, clipsDir, input) => {
    const dir = path.join(clipsDir, '.thumbs')
    const files = [`${clip.id}-strip.jpg`, `${clip.id}-preview.mp4`, clip.thumbnail].filter(Boolean).map(name => path.join(dir, name))
    await mediaFiles.release(files, async () => {
      if (clip.thumbnail) await ffmpeg.thumbnail(input, path.join(dir, clip.thumbnail)).catch(() => {})
      await Promise.all(files.slice(0, 2).map(file => fs.rm(file, { force: true }).catch(() => {})))
    })
  }

  async function replaceClip(clip, clipsDir, temp, updated) {
    const input = mediaPath(clip, clipsDir)
    const backup = temp + '.previous'
    await mediaFiles.release([input], async () => {
      await fs.link(input, backup).catch(() => fs.copyFile(input, backup))
      await mediaFiles.replaceFile(temp, input)
      try { await store.upsertClip(updated) }
      catch (error) {
        await mediaFiles.replaceFile(backup, input)
        throw error
      }
      await invalidate(updated, clipsDir, input)
    })
    return updated
  }

  ipcMain.handle('inputs:export:start', async ({ sender }, source, geometry, edits) => {
    if (jobs.has(sender)) throw Error('Ya hay una exportación en curso.')
    const { width, height, x, y } = geometry || {}
    if (geometry && (![width, height, x, y].every(Number.isInteger) || width < 2 || height < 2 ||
        width > 8192 || height > 8192 || width * height > 36_000_000 || x < 0 || y < 0 || x >= width || y >= height))
      throw Error('No se puede exportar con ese tamaño de video.')
    const job = { id: randomUUID(), sender, times: [] }
    jobs.set(sender, job)
    job.cancel = () => { if (!job.finishing) void cleanup(job) }
    sender.once('destroyed', job.cancel)
    sender.once('render-process-gone', job.cancel)
    try {
      const { clip, clipsDir, editing } = await findClip(source)
      if ((clip.savedEdit && !editing) || (geometry && !await readTrack(clip, clipsDir)))
        throw Error('Abrí el original para guardar los cambios.')
      const originalDuration = clip.savedEdit?.originalDuration ?? clip.durationSec
      const { start, end, mix, prefs } = edits || {}
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > originalDuration + 1)
        throw Error('El intervalo seleccionado no es válido.')
      if (jobs.get(sender) !== job) return null
      Object.assign(job, { clip, clipsDir, geometry, width, height, x, y, start, end,
        prefs: geometry ? preferences(prefs || {}) : null,
        mix: normalizeMix(mix && typeof mix === 'object' && !Array.isArray(mix) ? mix : clip.mix ?? undefined, clip.audioApps || []) })
      job.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipper-overlay-'))
      if (jobs.get(sender) !== job) { await cleanup(job); return null }
      return job.id
    } catch (error) {
      await cleanup(job)
      throw error
    }
  })

  ipcMain.handle('inputs:export:frame', async ({ sender }, id, time, data) => {
    const job = get(sender, id)
    const index = job.times.length
    if (!job.geometry || !Number.isInteger(time) || (index ? time <= job.times[index - 1] : time !== 0) ||
        time > 3_600_000 || index >= 120_000 || !(data instanceof ArrayBuffer) || data.byteLength < 33 || data.byteLength > 16 * 1024 * 1024)
      throw Error('El fotograma de inputs no es válido.')
    const png = Buffer.from(data)
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
    if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a' || !width || !height ||
        width > job.width - job.x || height > job.height - job.y ||
        (index && (width !== job.frameWidth || height !== job.frameHeight)))
      throw Error('El tamaño del mapa no es válido.')
    job.frameWidth = width
    job.frameHeight = height
    job.times.push(time)
    await fs.writeFile(path.join(job.dir, `${index}.png`), png, { flag: 'wx' })
  })

  ipcMain.handle('inputs:export:finish', async ({ sender }, id) => {
    const job = get(sender, id)
    job.finishing = true
    try {
      if (job.geometry && !job.times.length) throw Error('No se generó ningún fotograma de inputs.')
      const list = path.join(job.dir, 'map.ffconcat')
      if (job.geometry) await fs.writeFile(list, 'ffconcat version 1.0\n' + job.times.map((time, i) =>
        `file ${i}.png\noption framerate 1000\n` +
        (i + 1 < job.times.length ? `duration ${((job.times[i + 1] - time) / 1000).toFixed(3)}\n` : '')
      ).join(''))
      await mediaFiles.edit(job.clip.id, async () => {
        const clip = await store.getClip(job.clip.id)
        if (!clip || version(clip) !== version(job.clip) || clip.fileName !== job.clip.fileName ||
            job.clipsDir !== await store.getClipsDir()) throw Error('El clip cambió. Volvé a abrirlo para guardar los inputs.')
        const input = mediaPath(clip, job.clipsDir)
        const original = originalPath(clip, job.clipsDir)
        const dir = await fs.mkdtemp(path.join(path.dirname(input), '.clipper-inputs-'))
        try {
          const temp = path.join(dir, 'video' + path.extname(input))
          const mic = clip.micFile ? mediaPath(clip, job.clipsDir, clip.micFile) : null
          const apps = (clip.audioApps || []).map(track => ({ ...track, file: mediaPath(clip, job.clipsDir, track.file) }))
          const saved = clip.savedEdit
          const originalDuration = saved?.originalDuration ?? clip.durationSec
          const cut = job.start > .05 || job.end < originalDuration - .05
          await ffmpeg.renderMix(saved ? original : input, mic, job.mix, temp, {
            startSec: cut ? job.start : undefined, endSec: cut ? job.end : undefined,
            video: job.geometry || cut ? 'encode' : 'copy', apps,
            overlay: job.geometry ? { list, width: job.width, height: job.height, x: job.x, y: job.y } : undefined,
          })
          const { size } = await fs.stat(temp)
          const durationSec = await ffmpeg.probeDuration(temp)
          if (!size || !durationSec) throw Error('No se pudo verificar el video guardado.')
          if (!saved) {
            await fs.mkdir(path.dirname(original), { recursive: true })
            await fs.link(input, original).catch(async error => {
              if (error.code === 'EEXIST') return
              await fs.copyFile(input, original, COPYFILE_EXCL)
            })
          }
          await replaceClip(clip, job.clipsDir, temp, {
            ...clip, mediaRevision: randomUUID(), sizeBytes: size, durationSec, mix: job.mix,
            savedEdit: { originalSize: saved?.originalSize ?? clip.sizeBytes, originalDuration, start: job.start, end: job.end, prefs: job.prefs },
          })
        } finally {
          await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
        }
      })
    } finally {
      await cleanup(job)
    }
  })

  ipcMain.handle('inputs:restore', async (_event, source) => {
    const { clip } = await findClip(source)
    return mediaFiles.edit(clip.id, async () => {
      const { clip: current, clipsDir } = await findClip(source)
      if (!current.savedEdit) return
      const original = originalPath(current, clipsDir)
      const dir = await fs.mkdtemp(path.join(path.dirname(original), '.restore-'))
      try {
        const temp = path.join(dir, path.basename(original))
        await fs.copyFile(original, temp)
        await replaceClip(current, clipsDir, temp, {
          ...current, savedEdit: null, mediaRevision: randomUUID(),
          sizeBytes: current.savedEdit.originalSize, durationSec: current.savedEdit.originalDuration,
          mix: { game: 1, mic: 1, gameMuted: false, micMuted: false },
        })
        await mediaFiles.release([original], () => fs.rm(original, { force: true }).catch(() => {}))
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    })
  })

  ipcMain.handle('inputs:export:cancel', async ({ sender }, id) => {
    const job = jobs.get(sender)
    if (job?.id === id && !job.finishing) await cleanup(job)
  })
}

module.exports = { installInputExport }
