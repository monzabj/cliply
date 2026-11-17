const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { mediaPath } = require('../media-paths')
const mediaFiles = require('../media-files')
const ffmpeg = require('../ffmpeg')
const { readTrack } = require('./recorder')

function installInputExport({ ipcMain, dialog, store, window }) {
  const jobs = new Map()
  const version = clip => String(clip.mediaRevision || clip.sizeBytes)
  const key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)
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

  ipcMain.handle('inputs:export:start', async ({ sender }, source, geometry) => {
    if (jobs.has(sender)) throw Error('Ya hay una exportación en curso.')
    const { width, height, x, y, mix } = geometry || {}
    if (![width, height, x, y].every(Number.isInteger) || width < 2 || height < 2 ||
        width > 8192 || height > 8192 || width * height > 36_000_000 || x < 0 || y < 0 || x >= width || y >= height)
      throw Error('No se puede exportar con ese tamaño de video.')
    const url = new URL(source)
    if (url.protocol !== 'clip:' || url.host !== 'local') throw Error('El clip no está disponible.')
    const job = { id: randomUUID(), sender, times: [] }
    jobs.set(sender, job)
    job.cancel = () => { if (!job.finishing) void cleanup(job) }
    sender.once('destroyed', job.cancel)
    sender.once('render-process-gone', job.cancel)
    try {
      const clipsDir = await store.getClipsDir()
      const clips = await store.listClips()
      const name = decodeURIComponent(url.pathname.slice(1))
      const clip = clips.find(c => !c.storageDir && c.fileName === name)
      if (!clip || version(clip) !== url.searchParams.get('v') || !await readTrack(clip, clipsDir))
        throw Error('Volvé a abrir el clip para exportar su pista de inputs.')
      const defaultPath = path.join(clipsDir, path.parse(clip.fileName).name + ' con inputs.mp4')
      const result = process.env.CLIPPER_TEST_DATA && process.env.CLIPPER_TEST_INPUT_EXPORT === '1'
        ? { filePath: path.join(process.env.CLIPPER_TEST_DATA, 'inputs-export.mp4') }
        : await dialog.showSaveDialog(window(), { defaultPath, filters: [{ name: 'Video MP4', extensions: ['mp4'] }] })
      if (!result.filePath || result.canceled || jobs.get(sender) !== job) {
        if (jobs.get(sender) === job) await cleanup(job)
        return null
      }
      const output = /\.mp4$/i.test(result.filePath) ? result.filePath : result.filePath + '.mp4'
      if (clips.some(c => key(mediaPath(c, clipsDir)) === key(output))) throw Error('Elegí un archivo distinto al de un clip de la biblioteca.')
      Object.assign(job, { clip, clipsDir, output, width, height, x, y, mix: mix && typeof mix === 'object' && !Array.isArray(mix) ? mix : clip.mix || undefined })
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
    if (!Number.isInteger(time) || (index ? time <= job.times[index - 1] : time !== 0) ||
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
      if (!job.times.length) throw Error('No se generó ningún fotograma de inputs.')
      const list = path.join(job.dir, 'map.ffconcat')
      await fs.writeFile(list, 'ffconcat version 1.0\n' + job.times.map((time, i) =>
        `file ${i}.png\noption framerate 1000\n` +
        (i + 1 < job.times.length ? `duration ${((job.times[i + 1] - time) / 1000).toFixed(3)}\n` : '')
      ).join(''))
      await mediaFiles.readJob(job.clip.id, async () => {
        const clip = await store.getClip(job.clip.id)
        if (!clip || version(clip) !== version(job.clip) || clip.fileName !== job.clip.fileName ||
            job.clipsDir !== await store.getClipsDir()) throw Error('El clip cambió. Volvé a abrirlo y exportalo de nuevo.')
        const outputKey = key(job.output)
        if ((await store.listClips()).some(c => key(mediaPath(c, job.clipsDir)) === outputKey))
          throw Error('Elegí un archivo distinto al de un clip de la biblioteca.')
        const dir = await fs.mkdtemp(path.join(path.dirname(job.output), '.clipper-export-'))
        try {
          const temp = path.join(dir, 'export.mp4')
          const input = mediaPath(clip, job.clipsDir)
          const mic = clip.micFile ? mediaPath(clip, job.clipsDir, clip.micFile) : null
          const apps = (clip.audioApps || []).map(track => ({ ...track, file: mediaPath(clip, job.clipsDir, track.file) }))
          await ffmpeg.renderMix(input, mic, job.mix, temp, { video: 'encode', apps,
            overlay: { list, width: job.width, height: job.height, x: job.x, y: job.y } })
          await mediaFiles.replaceFile(temp, job.output)
        } finally {
          await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
        }
      })
    } finally {
      await cleanup(job)
    }
  })

  ipcMain.handle('inputs:export:cancel', async ({ sender }, id) => {
    const job = jobs.get(sender)
    if (job?.id === id && !job.finishing) await cleanup(job)
  })
}

module.exports = { installInputExport }
