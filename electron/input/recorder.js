const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { Timeline, neutral, sliceTrack } = require('./timeline')
const log = require('../log')
const timeline = new Timeline()
let app, store, enabled = false, armed = false, worker = null, error = null, ready = false
let startedAt = null
const settingsFile = () => path.join(app.getPath('userData'), 'input-settings.json')
const sidecarName = file => file.replace(/\.[^.]+$/, '') + '.inputs.json'
async function read(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return null } }
async function write(file, data) {
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data))
  await fs.rename(tmp, file)
}
function status() { return { enabled, armed, recording: ready && !!worker, error, supported: process.platform === 'win32' } }
function stop() {
  const old = worker
  worker = null; ready = false; startedAt = null
  if (old) old.kill()
  // Preserve a stopped recording in memory for an in-flight save. Disabling
  // explicitly clears it below; no files are written until a clip is saved.
  timeline.push(Date.now(), neutral())
}
function reconcile() {
  if (!enabled || !armed) { if (worker) stop(); return }
  if (worker || process.platform !== 'win32') return
  error = null; ready = false
  const executable = path.join(__dirname, 'InputWorker.exe').replace('app.asar', 'app.asar.unpacked')
  const child = spawn(executable, [String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  worker = child
  let buffer = '', stderr = ''
  const fail = reason => {
    if (worker !== child) return
    error = reason; stop()
    log.write('inputs', reason)
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', data => {
    if (worker !== child) return
    buffer += data
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
      try {
        const frame = JSON.parse(line)
        if (frame.ready) { ready = true; startedAt = Date.now(); continue }
        if (Number.isFinite(frame.t) && frame.state) timeline.push(frame.t, frame.state)
      } catch { /* a partial worker message cannot break video capture */ }
    }
  })
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-1000) })
  child.on('error', err => fail(`No se pudo iniciar la captura de inputs: ${err.message}`))
  child.on('exit', code => fail(`Se detuvo la captura de inputs (${code}): ${stderr}`))
}
async function configure() {
  const settings = await store.getSettings()
  const seconds = Math.max(30, ...settings.hotkeys.map(h => Number(h.durationSec) || 0))
  timeline.retainMs = Math.min(3600000, seconds * 1000 + 120000)
  reconcile()
}
function setArmed(value) { armed = !!value; reconcile() }
function snapshot(start, end) {
  if (!enabled || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const track = timeline.snapshot(start, end)
  if (track) track.coverageStartMs = Math.max(0, (timeline.frames[0]?.t || start) - start)
  return track
}
async function save(clipsDir, fileName, track) {
  if (!track) return null
  const name = sidecarName(fileName)
  try { await write(path.join(clipsDir, name), track); return name }
  catch (err) { log.write('inputs', `No se pudo guardar la pista: ${err.message}`); return null }
}
async function trim(clipsDir, clip, fileName, startSec, endSec) {
  if (!clip.inputsFile) return null
  const track = await read(path.join(clipsDir, clip.inputsFile))
  if (!track || track.version !== 1 || !Array.isArray(track.frames)) return null
  return save(clipsDir, fileName, sliceTrack(track, startSec * 1000, endSec * 1000))
}
async function install(context) {
  app = context.app; store = context.store
  enabled = (await read(settingsFile()))?.enabled === true
  context.ipcMain.handle('inputs:status', () => status())
  context.ipcMain.handle('inputs:enable', async (_event, value) => {
    const next = value === true
    await write(settingsFile(), { enabled: next })
    enabled = next
    if (!enabled) { stop(); timeline.clear() }
    await configure()
    return status()
  })
  context.ipcMain.handle('inputs:read', async (_event, fileName) => {
    // Resolve only indexed clips, never arbitrary renderer-provided paths.
    const clip = (await store.listClips()).find(c => c.fileName === fileName)
    if (!clip) return null
    const name = clip.inputsFile || sidecarName(clip.fileName)
    const track = await read(path.join(await store.getClipsDir(), path.basename(name)))
    return track?.version === 1 && Array.isArray(track.frames) ? track : null
  })
  await configure()
}
module.exports = { install, setArmed, configure, snapshot, save, trim, stop, status, sidecarName }
