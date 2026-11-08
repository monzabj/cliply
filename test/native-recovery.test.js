const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
function loadRecorder() {
  let now = 10000
  const timers = []
  const context = {
    module: { exports: {} }, Buffer, process, Date: { now: () => now },
    setTimeout: (fn, delay) => { const timer = { fn, delay, active: true, unref() {} }; timers.push(timer); return timer },
    clearTimeout: timer => { if (timer) timer.active = false },
    setInterval: () => ({ unref() {} }), clearInterval() {},
    require: name => name === 'electron' ? { desktopCapturer: {} } : name === './log' ? { write() {} } : name === './ffmpeg' ? {} : require(name),
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/native-recorder.js'), 'utf8'), context)
  return { ...context.module.exports, timers, advance(ms) { now += ms }, async next() { const timer = timers.find(t => t.active); assert.ok(timer); timer.active = false; timer.fn(); await new Promise(setImmediate) } }
}
const opts = { maxSeconds: 30, bitrateMbps: 12 }
test('identical or uncertain native-output pictures never select the first monitor', () => {
  const api = loadRecorder()
  assert.equal(api.selectFingerprint([{ idx: 0, difference: 0 }, { idx: 1, difference: 0 }]), null)
  assert.equal(api.selectFingerprint([{ idx: 0, difference: 80 }, { idx: 1, difference: 90 }]), null)
  assert.equal(api.selectFingerprint([{ idx: 0, difference: 20 }, { idx: 1, difference: 2 }]), 1)
})
test('recovery keeps retrying when multiple launches fail, including after 20 tries', async () => {
  const api = loadRecorder(), ring = new api.Ring('monitor', opts)
  let attempts = 0
  ring.start = async () => { if (++attempts <= 25) throw Error('desktop locked') }
  ring.scheduleRestart()
  for (let i = 0; i < 26; i++) await api.next()
  assert.equal(attempts, 26)
  assert.equal(ring.stopping, false)
  assert.ok(api.timers.every(t => t.delay <= 10000))
  await ring.stop()
})
test('stop cancels a pending retry and never respawns a recorder', async () => {
  const api = loadRecorder(), ring = new api.Ring('monitor', opts)
  ring.start = async () => { throw Error('must not run') }
  ring.scheduleRestart(); await ring.stop()
  assert.equal(api.timers.filter(t => t.active).length, 0)
})
test('health and buffer reflect frames, then become unavailable when progress stalls', () => {
  const api = loadRecorder(), ring = new api.Ring('monitor', opts)
  ring.proc = {}; ring.offset = 5000; ring.lastOutTime = 4; ring.lastFrameAt = 10000
  assert.equal(ring.status().status, 'recording'); assert.equal(ring.status().bufferedSeconds, 4)
  api.advance(6000)
  assert.equal(ring.status().status, 'recovering'); assert.equal(ring.status().bufferedSeconds, 0)
})
test('a hotkey without a healthy buffer reports recovery instead of saving imaginary footage', async () => {
  const api = loadRecorder(), ring = new api.Ring('monitor', opts)
  await assert.rejects(ring.cut(10000, 30, 'unused.ts'), /CAPTURE_RECOVERING/)
  assert.ok(api.timers.some(t => t.active))
  await ring.stop()
})
test('a key pressed before a new buffer began cannot reset that healthy buffer', async () => {
  const api = loadRecorder(), ring = new api.Ring('monitor', opts)
  ring.proc = {}; ring.offset = 9500; ring.lastOutTime = .5; ring.lastFrameAt = 10000
  await assert.rejects(ring.cut(9400, 30, 'unused.ts'), /CAPTURE_RECOVERING/)
  assert.equal(ring.status().status, 'recording')
  assert.equal(api.timers.filter(t => t.active).length, 0)
})
