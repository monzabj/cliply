const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')
const media = require('./media-files')
const { directory, originalPath } = require('./media-paths')

function clipFiles(clip, library) {
  const root = directory(clip, library)
  const names = [clip.fileName, clip.micFile, clip.inputsFile, clip.markerFile, ...(clip.audioApps || []).map(t => t.file)].filter(Boolean)
  for (const name of names) {
    if (typeof name !== 'string' || path.basename(name) !== name || name === '.' || name === '..') throw Error('Invalid clip file name')
  }
  const files = names.map(name => path.join(root, name))
  if (clip.savedEdit) files.push(originalPath(clip, library))
  return [...new Set(files)]
}

async function destinationOutsideLibrary(destination, roots) {
  const target = await fs.realpath(destination)
  for (const root of roots) {
    const source = await fs.realpath(root)
    const relative = path.relative(source, target)
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      throw Error('Choose a destination outside the clip library / Elegí una carpeta fuera de la biblioteca')
    }
  }
  return target
}

async function cleanCache(clip, library) {
  const names = [clip.thumbnail, `${clip.id}-strip.jpg`, `${clip.id}-preview.mp4`].filter(Boolean)
  await Promise.all(names.filter(n => path.basename(n) === n).map(n => fs.rm(path.join(library, '.thumbs', n), { force: true }).catch(() => {})))
}

async function transferClip(clip, library, destination, move, store) {
  if (clip.recording) throw Error('Recording in progress / Grabación en curso')
  const sources = clipFiles(clip, library)
  const sizes = await Promise.all(sources.map(async file => {
    const stat = await fs.lstat(file)
    if (!stat.isFile()) throw Error('Not a regular file / Archivo no válido')
    return stat.size
  }))
  // Reserve a whole name family: never overwrite an existing video or sidecar.
  const ext = path.extname(clip.fileName), base = path.basename(clip.fileName, ext)
  let targets
  for (let suffix = 0; ; suffix++) {
    const stem = `${base}${suffix ? ` (${suffix})` : ''}`
    targets = sources.map((file, i) => path.join(destination,
      i === 0 ? `${stem}${ext}` : file === originalPath(clip, library)
        ? `${stem}.clipper-original${path.extname(file)}` : path.basename(file).startsWith(`${base}.`)
        ? `${stem}${path.basename(file).slice(base.length)}` : `${stem}.clipper-${i}${path.extname(file)}`))
    const exists = await Promise.all(targets.map(file => fs.lstat(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })))
    if (!exists.some(Boolean)) break
  }
  const copied = [], removed = []
  try {
    for (let i = 0; i < sources.length; i++) {
      await fs.copyFile(sources[i], targets[i], constants.COPYFILE_EXCL)
      copied.push(targets[i])
      if ((await fs.stat(targets[i])).size !== sizes[i]) throw Error('Incomplete copy / Copia incompleta')
    }
    if (move) {
      // All files have verified copies before any original is removed.
      for (let i = sources.length - 1; i >= 0; i--) {
        await fs.unlink(sources[i])
        removed.push(i)
      }
      await store.removeClip(clip.id)
    }
  } catch (error) {
    if (removed.length) {
      // Preserve the destination backups even if Windows prevents restoring a source.
      for (const i of removed) await fs.copyFile(targets[i], sources[i], constants.COPYFILE_EXCL).catch(() => {})
      throw Error(`${error.message} — destination copies preserved / copias conservadas en ${destination}`)
    }
    await Promise.all(copied.map(file => fs.unlink(file).catch(() => {})))
    throw error
  }
  if (move) await cleanCache(clip, library)
}

async function deleteClip(clip, library, store, trashItem) {
  if (clip.recording) throw Error('Recording in progress / Grabación en curso')
  // Sidecars first: if the video is locked, keep its library entry for retry.
  const files = clipFiles(clip, library)
  for (const file of [...files.slice(1), files[0]]) {
    try { await trashItem(file) }
    catch (error) {
      if (await fs.lstat(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })) throw error
    }
  }
  await store.removeClip(clip.id)
  await cleanCache(clip, library)
}

async function runBatch({ clips, action, library, destination, store, trashItem }) {
  if (!['copy', 'move', 'delete'].includes(action)) throw Error('Invalid action')
  if (action !== 'delete') destination = await destinationOutsideLibrary(destination, [library, ...new Set(clips.map(c => directory(c, library)))])
  const result = { completed: [], failed: [], canceled: false }
  for (const clip of clips) {
    try {
      await media.edit(clip.id, () => media.release(clipFiles(clip, library), () => action === 'delete'
        ? deleteClip(clip, library, store, trashItem)
        : transferClip(clip, library, destination, action === 'move', store)))
      result.completed.push(clip.id)
    } catch (error) { result.failed.push({ id: clip.id, title: clip.title, error: error.message }) }
  }
  return result
}

module.exports = { runBatch, clipFiles, destinationOutsideLibrary }
