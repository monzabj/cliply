const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

const key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)
const streams = new Map(), blocked = new Set(), jobs = new Map(), edits = new Set()

function open(file, options, signal) {
  const name = key(file), stream = fs.createReadStream(file, options)
  if (!streams.has(name)) streams.set(name, new Set())
  streams.get(name).add(stream)
  const abort = () => stream.destroy()
  stream.once('close', () => {
    streams.get(name)?.delete(stream)
    if (!streams.get(name)?.size) streams.delete(name)
    signal?.removeEventListener('abort', abort)
  })
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  return stream
}

async function readJob(id, fn) {
  if (edits.has(id)) throw Error('El clip se está guardando. Esperá a que termine.')
  if (!jobs.has(id)) jobs.set(id, new Set())
  const job = Promise.resolve().then(fn)
  jobs.get(id).add(job)
  try { return await job }
  finally { jobs.get(id)?.delete(job); if (!jobs.get(id)?.size) jobs.delete(id) }
}

async function edit(id, fn) {
  if (edits.has(id)) throw Error('Ya se está guardando este clip.')
  edits.add(id)
  try {
    await Promise.allSettled([...(jobs.get(id) || [])])
    return await fn()
  } finally { edits.delete(id) }
}

async function release(files, fn) {
  const names = [...new Set(files.filter(Boolean).map(key))]
  names.forEach(name => blocked.add(name))
  try {
    await Promise.all(names.flatMap(name => [...(streams.get(name) || [])]).map(stream => new Promise(resolve => {
      if (stream.closed) return resolve()
      stream.once('close', resolve)
      stream.destroy()
    })))
    return await fn()
  } finally { names.forEach(name => blocked.delete(name)) }
}

/** Atomic replacement, allowing antivirus or a closing decoder to release its handle. */
async function replaceFile(temp, target, rename = fsp.rename, wait = delay) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(temp, target); return }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
      if (attempt >= 8) throw Error('Windows todavía está usando el archivo. Cerrá cualquier reproductor o vista previa externa y volvé a intentar. El clip original se conservó.', { cause: error })
      await wait(Math.min(1000, 100 * 2 ** attempt))
    }
  }
}

module.exports = { open, readJob, edit, release, replaceFile, isBlocked: file => blocked.has(key(file)), isEditing: id => edits.has(id) }
