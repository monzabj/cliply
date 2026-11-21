// Real Electron pointer/keyboard regression, using only temporary generated clips.
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), { spawn, execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label) {
  for (let i = 0; i < 200; i++) { if (await fn()) return; await pause(100) }
  throw Error(label)
}
let child, ws, profile
async function main() {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'clipper-selection-'))
  const clipsDir = path.join(profile, 'clips'); await fs.mkdir(clipsDir)
  const sample = path.join(profile, 'sample.mp4')
  execFileSync(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=purple:s=320x180:r=30', '-t', '1', '-c:v', 'libx264', sample], { windowsHide: true })
  const clips = []
  for (let i = 0; i < 100; i++) {
    const fileName = `test-${i}.mp4`; await fs.copyFile(sample, path.join(clipsDir, fileName))
    clips.push({ id: `test-${i}`, fileName, title: `Test ${i}`, createdAt: new Date(Date.now() - i * 1000 - 60000).toISOString(), durationSec: 1, sizeBytes: 1024, source: { type: 'screen', name: 'Synthetic' }, format: 'mp4' })
  }
  await fs.writeFile(path.join(clipsDir, 'index.json'), JSON.stringify(clips))
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ setupDone: true, clipsDir, language: 'es', hotkeys: [], sessions: [{ id: 'none', source: null, autoArm: false }], launchOnStartup: false, captureMic: false, captureSystemAudio: false }))
  await fs.writeFile(path.join(profile, 'migrations.json'), '["mic-on-1.3"]')
  child = spawn(require('electron'), [root, '--disable-backgrounding-occluded-windows', '--remote-debugging-port=9437'], { env: { ...process.env, CLIPPER_TEST_DATA: profile }, windowsHide: true, stdio: 'ignore' })
  let page
  await until(async () => { try { page = (await (await fetch('http://localhost:9437/json')).json()).find(t => t.url.startsWith('app://')); return !!page } catch { return false } }, 'Electron did not open')
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(resolve => ws.onopen = resolve)
  let seq = 0; const pending = new Map()
  ws.onmessage = event => { const data = JSON.parse(event.data); if (data.id) { pending.get(data.id)?.(data); pending.delete(data.id) } }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, data => data.error ? reject(Error(JSON.stringify(data.error))) : resolve(data.result)); ws.send(JSON.stringify({ id, method, params }))
  })
  const ev = async expression => {
    const data = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (data.exceptionDetails) throw Error(data.exceptionDetails.text)
    return data.result.value
  }
  const rect = selector => ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  const mouse = (type, point, buttons = 0) => send('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 })
  const click = async selector => { const point = await rect(selector); await mouse('mousePressed', point, 1); await mouse('mouseReleased', point); await pause(150) }
  const count = () => ev('document.querySelectorAll("[data-clip-select][aria-pressed=true]").length')
  const escape = async () => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await pause(100) }
  await until(() => ev('document.querySelectorAll("[data-clip-id]").length===100'), 'Clips did not load')
  await click('[data-clip-id="test-0"] [data-clip-select]'); assert.equal(await count(), 1)
  await click('[data-clip-id="test-1"] p'); assert.equal(await count(), 2, 'Click anywhere selects instead of opening')
  await click('[data-clip-id="test-1"] p'); assert.equal(await count(), 1, 'Click toggles selection')
  const start = await rect('[data-clip-id="test-1"] button'), end = await rect('[data-clip-id="test-2"] button')
  await mouse('mousePressed', start, 1); await pause(80); await mouse('mouseMoved', end, 1); await pause(180); await mouse('mouseReleased', end); await pause(150)
  assert.equal(await count(), 3, 'Drag selects a contiguous range')
  await escape(); assert.equal(await count(), 0)
  await click('[data-clip-id="test-0"] button')
  await until(() => ev('!!document.querySelector("[role=dialog]")'), 'Escape must restore normal clip opening')
  await escape()
  await click('[data-clip-id="test-0"] [data-clip-select]')
  const next = await rect('[data-clip-id="test-1"] button')
  const bottom = await ev('(()=>{const r=document.querySelector(".scroll-y").getBoundingClientRect();return {x:r.left+100,y:r.bottom-3}})()')
  await mouse('mousePressed', next, 1); await pause(80); await mouse('mouseMoved', bottom, 1); await pause(1400); await mouse('mouseReleased', bottom)
  assert.ok(await ev('document.querySelector(".scroll-y").scrollTop') > 200, 'Holding near bottom scrolls')
  assert.ok(await count() > 4, 'Autoscroll extends selection')
  await ev('document.querySelector(".scroll-y").scrollTop=0'); await pause(150)
  const artifact = path.join(root, '.test-artifacts/selection.png'); await fs.mkdir(path.dirname(artifact), { recursive: true })
  const screenshot = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(artifact, Buffer.from(screenshot.data, 'base64'))
  await escape(); assert.equal(await count(), 0)
  await click('[data-clip-id="test-0"] [data-clip-select]')
  await ev('document.querySelector("[data-clip-id=test-1] [data-clip-select]").focus()')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await pause(100)
  assert.equal(await count(), 2, 'Keyboard toggles the selection circle')
  await escape(); await click('[data-clip-id="test-0"] [data-clip-select]')
  await ev('(()=>{const input=document.querySelector("input[placeholder]");input.focus();const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(input,"Test 99");input.dispatchEvent(new Event("input",{bubbles:true}))})()')
  await until(async () => await count() === 0, 'Filtering must clear hidden selections')
  assert.equal((await fs.readdir(clipsDir)).filter(f => f.endsWith('.mp4')).length, 100, 'UI tests never delete clips')
  console.log('PASS selection circle, whole-card toggles, range drag, autoscroll, Escape, keyboard and filter cleanup')
  console.log(`Screenshot: ${artifact}`)
  await ev('window.clipper.invoke("test:quit")')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  ws?.close(); child?.kill()
  if (profile) await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
})
