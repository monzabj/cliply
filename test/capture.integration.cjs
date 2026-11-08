// Opt-in Windows regression test. All settings, buffers and clips are isolated.
const { chromium } = require(process.env.CLIPPER_PLAYWRIGHT_MODULE || 'playwright')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { sourceRef } = require('../electron/source-identity')
const root = path.resolve(__dirname, '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let child, browser, page, profile, log = ''
async function invoke(channel, ...args) {
  return page.evaluate(([channel, args]) => window.clipper.invoke(channel, ...args), [channel, args])
}
async function waitFor(check, message, timeout = 45000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await check()) return; await pause(150) }
  throw Error(message)
}
async function launch() {
  child = spawn(process.env.CLIPPER_ELECTRON_PATH || require('electron'), [root, '--hidden', '--remote-debugging-port=0'], {
    env: { ...process.env, CLIPPER_TEST_DATA: profile }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  })
  log = ''; child.stderr.on('data', data => { log += data })
  await waitFor(() => /DevTools listening on (ws:\/\/[^\s]+)/.test(log), 'No Electron endpoint')
  browser = await chromium.connectOverCDP(/DevTools listening on (ws:\/\/[^\s]+)/.exec(log)[1])
  await waitFor(() => { page = browser.contexts()[0].pages().find(p => p.url().startsWith('app:')); return !!page }, 'Renderer unavailable')
  await page.locator('aside').getByText(/^escritorio$/i).waitFor()
}
async function shutdown() {
  try { if (page) await invoke('test:quit') } catch {}
  if (child) await Promise.race([new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)), pause(10000)])
  if (child && child.exitCode === null) child.kill()
  if (browser) await browser.close().catch(() => {})
  page = null; child = null; browser = null
}
async function main() {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'clipper-capture-test-'))
  const clipsDir = path.join(profile, 'clips')
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    setupDone: true, clipsDir, captureMic: false, captureSystemAudio: false,
    hotkeys: [], language: 'es', sessions: [{ id: 'test', name: 'Test', source: null, autoArm: false }],
  }))
  await fs.writeFile(path.join(profile, 'migrations.json'), '["mic-on-1.3"]')
  await launch()
  const screens = (await invoke('sources:list')).filter(s => s.type === 'screen').sort((a, b) => b.width - a.width)
  assert.ok(screens.length >= 2, 'This test needs two monitors')
  assert.ok(screens.every(s => s.devicePath), 'Windows physical identity must be present')
  const settings = await invoke('settings:get')
  const expected = screens.slice(0, 2).map(sourceRef)
  await invoke('settings:save', {
    ...settings, sessions: expected.map((source, i) => ({ id: `test-${i}`, name: `Test ${source.width}`, source, autoArm: true })),
    hotkeys: expected.map((target, i) => ({ id: `key-${i}`, accelerator: i ? 'F9' : 'F8', action: 'clip', durationSec: 30, sessionId: `test-${i}`, pinned: true, target })),
  })
  await page.reload(); await page.locator('aside').getByText(/^escritorio$/i).waitFor()
  await waitFor(async () => (await invoke('native:status')).filter(h => h.status === 'recording').length === 2, 'Auto-start did not arm both displays')
  const initial = await invoke('native:status')
  assert.deepEqual(initial.map(h => h.source.width).sort(), expected.map(s => s.width).sort())
  console.log('PASS hidden auto-start selects both physical monitors')
  await invoke('test:kill-native', 'test-0')
  await waitFor(async () => (await invoke('native:status')).find(h => h.sessionId === 'test-0')?.status === 'recovering', 'Failure was not detected', 5000)
  assert.equal((await invoke('native:status')).find(h => h.sessionId === 'test-0').bufferedSeconds, 0)
  await waitFor(async () => page.locator('[data-capture-recovering]').isVisible(), 'UI still claims to record while disconnected', 5000)
  await waitFor(async () => {
    const h = (await invoke('native:status')).find(h => h.sessionId === 'test-0')
    return h?.status === 'recording' && h.generation > initial.find(h => h.sessionId === 'test-0').generation
  }, 'Recorder did not recover automatically')
  assert.equal((await invoke('native:status')).find(h => h.sessionId === 'test-0').source.devicePath, expected[0].devicePath)
  console.log('PASS real ffmpeg termination, zero buffer, truthful UI and automatic recovery on the same monitor')
  await pause(2500)
  // Exercise the same renderer handler as the real global keys without stealing
  // F8/F9 from a running user instance.
  await invoke('test:hotkey', 'F8'); await invoke('test:hotkey', 'F9')
  await waitFor(async () => (await invoke('clips:list')).length === 2, 'Pinned hotkeys did not save both clips')
  const clips = await invoke('clips:list')
  const sizes = clips.map(clip => {
    try { execFileSync(require('ffmpeg-static'), ['-hide_banner', '-i', path.join(clipsDir, clip.fileName)], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch (e) { const size = /Video:.*?\b(\d{3,5})x(\d{3,5})\b/.exec(String(e.stderr)); assert.ok(size); return Number(size[1]) }
  })
  assert.deepEqual(sizes.sort(), expected.map(s => s.width).sort())
  assert.notEqual(clips[0].fileName, clips[1].fileName)
  console.log('PASS simultaneous pinned F8/F9 save distinct videos with the expected resolutions')
  await page.getByRole('button', { name: 'Atajos y ajustes', exact: true }).click()
  await page.locator('[data-hotkey="F8"] button[aria-pressed="true"]').waitFor()
  await page.screenshot({ path: path.join(root, '.test-artifacts/pinned-hotkeys.png') })
  const pinned = (await invoke('settings:get')).hotkeys.filter(h => h.action === 'clip')
  await shutdown(); await launch()
  const restored = (await invoke('settings:get')).hotkeys.filter(h => h.action === 'clip')
  assert.deepEqual(restored.map(h => [h.accelerator, h.durationSec, h.target.devicePath]), pinned.map(h => [h.accelerator, h.durationSec, h.target.devicePath]))
  console.log('PASS pin controls and exact key/duration/physical target persistence across a full app restart')
}
main().catch(error => { console.error(error); console.error(log.slice(-5000)); process.exitCode = 1 }).finally(async () => { await shutdown(); console.log('Isolated profile:', profile) })
