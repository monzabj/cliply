const { test } = require('node:test')
const assert = require('node:assert/strict')
const { matchSourceIdentity, sourceRef, pinHotkeys, samePhysicalSource, configureScreens } = require('../electron/source-identity')
const hd = { id: 'screen:1:0', name: 'Pantalla 1', type: 'screen', displayId: 'old-hd', width: 1920, height: 1080 }
const small = { id: 'screen:0:0', name: 'Pantalla 2', type: 'screen', displayId: 'old-small', width: 1366, height: 768 }
test('a reused raw screen ID and numbered name cannot override resolution', () => {
  const live = [{ ...small, id: hd.id, name: hd.name, displayId: hd.displayId }, { ...hd, id: small.id, name: small.name, displayId: 'new-hd' }]
  assert.equal(matchSourceIdentity(live, hd), live[1])
  assert.equal(matchSourceIdentity(live, small), live[0])
})
test('a physical device path wins after resolution and display number change', () => {
  const ref = { ...hd, devicePath: 'monitor-HD' }
  const live = [{ ...hd, devicePath: 'other' }, { ...small, devicePath: 'MONITOR-hd' }]
  assert.equal(matchSourceIdentity(live, ref), live[1])
})
test('a disconnected physical display never becomes a different one of the same size', () => {
  assert.equal(matchSourceIdentity([{ ...hd, devicePath: 'other' }], { ...hd, devicePath: 'missing' }), null)
})
test('ambiguous identical monitors without durable evidence require selection', () => {
  assert.equal(matchSourceIdentity([{ ...hd, displayId: 'new-1' }, { ...hd, id: 'screen:9:0', displayId: 'new-2' }], hd), null)
})
test('a missing 1920 screen cannot fall back to an available 1366 screen', () => {
  assert.equal(matchSourceIdentity([small], hd), null)
  assert.equal(samePhysicalSource(hd, { ...small, id: hd.id, displayId: hd.displayId }), false)
})
test('pins preserve their own target even when their session is reassigned', () => {
  const old = { id: 'f8', accelerator: 'F8', durationSec: 30, sessionId: 'a', pinned: true, target: sourceRef(hd) }
  const settings = { sessions: [{ id: 'a', source: small }], hotkeys: [old] }
  assert.deepEqual(pinHotkeys(settings)[0].target, sourceRef(hd))
})
test('existing screen hotkeys migrate to independent pins; explicit unpin persists', () => {
  const settings = { sessions: [{ id: 'a', source: hd }], hotkeys: [{ id: 'f8', sessionId: 'a' }, { id: 'f9', sessionId: 'a', pinned: false }] }
  assert.equal(pinHotkeys(settings)[0].pinned, true)
  assert.deepEqual(pinHotkeys(settings)[0].target, sourceRef(hd))
  assert.equal(pinHotkeys(settings)[1].pinned, false)
})
test('redoing screen setup preserves custom keys, durations and physical targets', () => {
  const settings = { sessions: [{ id: 'hd', source: hd }, { id: 'small', source: small }], hotkeys: [
    { id: 'f8', action: 'clip', accelerator: 'F8', durationSec: 30, sessionId: 'hd', pinned: true, target: hd },
    { id: 'custom', action: 'clip', accelerator: 'Ctrl+F10', durationSec: 90, sessionId: 'small', pinned: true, target: small },
  ] }
  const result = configureScreens(settings, [small, hd])
  assert.deepEqual(result.hotkeys, settings.hotkeys)
  assert.equal(result.sessions.find(s => s.source.width === 1920).id, 'hd')
  assert.equal(configureScreens(settings, [hd]).sessions.find(s => s.id === 'small').autoArm, false)
})
test('adding a third screen never reuses the screenshot key', () => {
  const settings = { sessions: [{ id: 'main', source: null }], hotkeys: [
    { id: 'f8', action: 'clip', accelerator: 'F8', durationSec: 30, sessionId: 'main' },
    { id: 'shot', action: 'shot', accelerator: 'F7', durationSec: 0, sessionId: 'main' },
  ] }
  const result = configureScreens(settings, [hd, small, { ...hd, id: 'third', displayId: 'third', width: 2560 }])
  assert.equal(new Set(result.hotkeys.map(h => h.accelerator)).size, result.hotkeys.length)
  assert.deepEqual(result.hotkeys.filter(h => h.action === 'clip').map(h => h.accelerator), ['F8', 'F9', 'F6'])
})
