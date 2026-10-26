const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Timeline, neutral, sliceTrack } = require('../electron/input/timeline')
const held = (...keys) => ({ ...neutral(), keys })
test('a clip starts with held keys from before its first frame', () => {
  const t = new Timeline(); t.push(100, held(87)); t.push(500, held())
  assert.deepEqual(t.snapshot(300, 700).frames, [{ t: 0, state: held(87) }, { t: 200, state: held() }])
})
test('a press exactly at the cut boundary is included once', () => {
  const t = new Timeline(); t.push(100, held(65)); t.push(300, held())
  assert.deepEqual(t.snapshot(100, 300).frames.map(f => f.t), [0, 200])
})
test('capture enabled midway through a clip starts neutral', () => {
  const t = new Timeline(); t.push(500, held(68))
  assert.deepEqual(t.snapshot(100, 700).frames, [{ t: 0, state: neutral() }, { t: 400, state: held(68) }])
})
test('a clip made before capture has no invented track', () => {
  const t = new Timeline(); assert.equal(t.snapshot(0, 10), null)
  t.push(100, held(65)); assert.equal(t.snapshot(0, 10), null)
})
test('overlapping clips have independent relative timestamps', () => {
  const t = new Timeline(); t.push(0, held()); t.push(100, held(87)); t.push(400, held())
  assert.equal(t.snapshot(50, 500).frames[1].t, 50)
  assert.equal(t.snapshot(200, 500).frames[1].t, 200)
  assert.equal(t.frames[1].t, 100)
})
test('retention preserves a baseline preceding the retained interval', () => {
  const t = new Timeline(100)
  for (let i = 0; i < 256; i++) t.push(i * 10, held(87))
  assert.ok(t.frames.length <= 12)
  assert.deepEqual(t.snapshot(2460, 2550).frames[0].state.keys, [87])
})
test('trim rebases inputs and held mouse buttons', () => {
  const t = new Timeline(); const state = held(87); state.mouse.buttons = [0]; t.push(0, state); t.push(800, held())
  const original = t.snapshot(0, 1200), cut = sliceTrack(original, 500, 1000)
  assert.equal(cut.durationMs, 500); assert.equal(cut.frames[1].t, 300)
  assert.deepEqual(cut.frames[0].state.mouse.buttons, [0]); assert.equal(original.durationMs, 1200)
})
test('mouse motion and wheel do not get stuck at a new clip boundary', () => {
  const t = new Timeline(), state = neutral(); state.mouse = {buttons:[1],dx:50,dy:-20,wheel:120}; t.push(0,state)
  assert.deepEqual(t.snapshot(20, 200).frames[0].state.mouse, {buttons:[1],dx:0,dy:0,wheel:0})
})
test('trim clamps the end to actual duration and adjusts missing coverage', () => {
  const cut = sliceTrack({version:1,durationMs:1000,coverageStartMs:400,frames:[{t:0,state:neutral()}]},200,1500)
  assert.equal(cut.durationMs,800); assert.equal(cut.coverageStartMs,200)
})
test('controller values and disconnects survive a cut', () => {
  const t = new Timeline(), state = neutral();state.pads=[{id:0,buttons:4096,lt:200,rt:0,lx:.5,ly:-.2,rx:0,ry:0}]
  t.push(0,state);t.push(600,neutral())
  const cut = sliceTrack(t.snapshot(0,1000),200,800)
  assert.equal(cut.frames[0].state.pads[0].buttons,4096)
  assert.deepEqual(cut.frames[1],{t:400,state:neutral()})
})
