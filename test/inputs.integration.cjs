// Opt-in desktop test: a temporary profile and generated clip keep the user's
// library, recording buffers and startup settings out of the test.
const { chromium } = require(process.env.CLIPPER_PLAYWRIGHT_MODULE || 'playwright')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { neutral } = require('../electron/input/timeline')
const root = path.resolve(__dirname, '..'), artifacts = path.join(root, '.test-artifacts')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let child, browser, page, profile, logs = ''
async function invoke(channel, ...args) {
  return page.evaluate(([channel, args]) => window.clipper.invoke(channel, ...args), [channel, args])
}
async function main() {
  const errors = []
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'clipper-input-test-'))
  const clipsDir = path.join(profile, 'clips')
  await fs.mkdir(clipsDir); await fs.mkdir(artifacts, { recursive: true })
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    setupDone: true, launchOnStartup: false, startMinimized: false, clipsDir,
    hotkeys: [], sessions: [{ id: 'main', name: 'Test', source: null, autoArm: false }],
    captureMic: false, captureSystemAudio: false, language: 'es',
  }))
  await fs.writeFile(path.join(profile, 'migrations.json'), '["mic-on-1.3"]')
  const executable = process.env.CLIPPER_ELECTRON_PATH || require('electron')
  child = spawn(executable, [root, '--remote-debugging-port=0', '--hidden'], {
    env: { ...process.env, CLIPPER_TEST_DATA: profile }, windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.on('error', error => { logs += error.stack })
  child.stderr.on('data', data => { logs += data })
  let endpoint
  for (let i = 0; i < 120; i++) {
    endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(logs)?.[1]
    if (endpoint) break
    if (child.exitCode !== null) throw Error(`Electron exited: ${logs}`)
    await pause(250)
  }
  if (!endpoint) throw Error(`No debugging endpoint: ${logs}`)
  browser = await chromium.connectOverCDP(endpoint)
  for (let i = 0; i < 80; i++) {
    page = browser.contexts()[0].pages().find(p => p.url().startsWith('app:'))
    if (page) break
    await pause(250)
  }
  assert.ok(page, 'Electron renderer must load')
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForSelector('.ci-settings')
  // Desktop mode is shown only once the provider has loaded settings/sources
  // and published its initial idle tray state.
  await page.locator('aside').getByText(/^escritorio$/i).waitFor()
  assert.equal((await invoke('inputs:status')).enabled, false)
  await invoke('inputs:enable', true); await invoke('tray:state', true, 'Input test')
  for (let i = 0; i < 50; i++) {
    // The provider initially publishes its idle tray state as it finishes
    // loading. This test arms directly, without a renderer-owned session.
    await invoke('tray:state', true, 'Input test')
    if ((await invoke('inputs:status')).recording) break
    await pause(100)
  }
  const recordingStatus = await invoke('inputs:status')
  assert.equal(recordingStatus.recording, true, JSON.stringify(recordingStatus))
  console.log('PASS opt-in, isolated worker and capture startup')
  let saved
  if (process.env.CLIPPER_TEST_NATIVE === '1') {
    const source = (await invoke('sources:list')).find(s => s.type === 'screen')
    assert.equal(await invoke('native:available'), true)
    const started = await invoke('native:start', 'input-test', {
      displayId: source.displayId, width: source.width, height: source.height,
      fps: 30, bitrateMbps: 3, maxSeconds: 12,
    })
    assert.equal(started.ok, true, JSON.stringify(started))
    await pause(3500)
    saved = await invoke('native:save', {
      sessionId: 'input-test', endWall: Date.now(), durationSec: 3,
      source: { type: 'screen', name: 'Input test' },
    })
    await invoke('native:stop', 'input-test')
    const track = JSON.parse(await fs.readFile(path.join(clipsDir, saved.inputsFile)))
    assert.ok(track.frames.length > 1); assert.ok(track.durationMs >= 2900)
    console.log('PASS real native recording with a separate input track')
  } else {
    execFileSync(require('ffmpeg-static'), [
      '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'color=c=0x172131:s=640x360:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      path.join(clipsDir, 'input-test.mp4'),
    ], { windowsHide: true })
    saved = {
      id: 'input-test', fileName: 'input-test.mp4', inputsFile: 'input-test.inputs.json',
      title: 'Input test', displayName: 'Input test', createdAt: new Date().toISOString(),
      durationSec: 3, source: { type: 'screen', name: 'Test' }, format: 'mp4',
      sizeBytes: (await fs.stat(path.join(clipsDir, 'input-test.mp4'))).size,
    }
    await fs.writeFile(path.join(clipsDir, 'index.json'), JSON.stringify([saved]))
  }
  const keyboard = neutral(); keyboard.keys = [87, 65, 160]
  keyboard.mouse = { buttons: [0], dx: 21, dy: -12, wheel: 120 }
  const controller = neutral()
  controller.pads = [{ id: 0, buttons: 4096 | 512, lt: 200, rt: 140, lx: .7, ly: .4, rx: -.3, ry: .5 }]
  await fs.writeFile(path.join(clipsDir, saved.inputsFile), JSON.stringify({
    version: 1, durationMs: 3000, frames: [
      { t: 0, state: neutral() }, { t: 400, state: keyboard },
      { t: 1000, state: neutral() }, { t: 1500, state: controller }, { t: 2200, state: neutral() },
    ],
  }))
  await page.reload(); await page.waitForSelector('.ci-settings')
  await page.getByRole('button', { name: saved.title, exact: true }).click({ force: true })
  await page.waitForSelector('.ci-controls button:not([disabled])')
  assert.equal(await page.locator('.ci-canvas').isVisible(), false)
  const digest = async () => createHash('sha256').update(await fs.readFile(path.join(clipsDir, saved.fileName))).digest('hex')
  const before = await digest()
  await page.locator('.ci-controls button').click()
  assert.equal(await page.locator('.ci-canvas').isVisible(), true)
  const video = page.locator('.clip-stage-video video')
  await video.evaluate(v => { v.pause(); v.currentTime = .6 })
  await pause(150); await page.screenshot({ path: path.join(artifacts, 'keyboard-overlay.png') })
  await video.evaluate(v => { v.currentTime = 1.8 })
  await pause(150); await page.screenshot({ path: path.join(artifacts, 'controller-overlay.png') })
  await page.getByLabel('Estilo de control').selectOption('ps')
  await page.getByLabel('Posición del mapa').selectOption('right')
  await page.locator('.ci-controls button').click()
  assert.equal(await page.locator('.ci-canvas').isVisible(), false)
  assert.equal(before, await digest())
  console.log('PASS hidden overlay, toggle, keyboard/controller maps, seek and unchanged video')
  const renamed = await invoke('clips:rename-file', saved.id, 'input-test-renamed')
  assert.equal(renamed.inputsFile, 'input-test-renamed.inputs.json')
  const trimmed = await invoke('clips:trim', { id: renamed.id, startSec: .5, endSec: 2.5, mode: 'new' })
  const cut = JSON.parse(await fs.readFile(path.join(clipsDir, trimmed.inputsFile)))
  assert.equal(cut.durationMs, 2000); assert.deepEqual(cut.frames[0].state.keys, [87, 65, 160])
  assert.equal(cut.frames.find(f => f.state.pads.length).t, 1000)
  const overwritten = await invoke('clips:trim', { id: trimmed.id, startSec: .5, endSec: 1.5, mode: 'overwrite' })
  const cut2 = JSON.parse(await fs.readFile(path.join(clipsDir, overwritten.inputsFile)))
  assert.equal(cut2.durationMs, 1000); assert.equal(cut2.frames.find(f => f.state.pads.length).t, 500)
  await invoke('clips:delete', overwritten.id)
  await assert.rejects(fs.access(path.join(clipsDir, overwritten.inputsFile)))
  await invoke('inputs:enable', false)
  assert.equal((await invoke('inputs:status')).recording, false)
  assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'input-settings.json'))).enabled, false)
  assert.deepEqual(errors, [])
  console.log('PASS sidecar rename, trims, deletion, persisted disable and no renderer errors')
}
main().catch(error => { console.error(error, logs.slice(-5000)); process.exitCode = 1 }).finally(async () => {
  try { if (page) await Promise.race([invoke('test:quit'), pause(3000)]) } catch {}
  if (child) { await pause(1000); child.kill() }
  if (browser) await browser.close().catch(() => {})
  if (profile) console.log('Isolated test profile:', profile)
})
