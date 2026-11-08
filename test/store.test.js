const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const syncFs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const os = require('node:os')
async function fixture(settings = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipper-store-test-'))
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ clipsDir: path.join(dir, 'clips'), ...settings }))
  await fs.writeFile(path.join(dir, 'migrations.json'), '["mic-on-1.3"]')
  const context = { module: { exports: {} }, require: name => name === 'electron' ? { app: { getPath: () => dir } }
    : name === './source-identity' ? require('../electron/source-identity') : require(name) }
  vm.runInNewContext(syncFs.readFileSync(path.join(__dirname, '../electron/store.js'), 'utf8'), context)
  const store = context.module.exports
  await store.ensureDirs()
  return { store, dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}
test('simultaneous clips and screenshots do not overwrite each other in their indexes', async () => {
  const f = await fixture()
  try {
    const meta = i => ({ id: `id-${i}`, fileName: `file-${i}.mp4`, createdAt: new Date().toISOString() })
    await Promise.all(Array.from({ length: 30 }, (_, i) => f.store.upsertClip(meta(i))))
    await Promise.all(Array.from({ length: 20 }, (_, i) => f.store.upsertShot(meta(i))))
    assert.equal((await f.store.listClips()).length, 30)
    assert.equal((await f.store.listShots()).length, 20)
  } finally { await f.cleanup() }
})
test('a pinned hotkey retains and restores its screen after its old session disappears', async () => {
  const target = { id: 'screen:9', type: 'screen', name: 'Pantalla 1', width: 1920, height: 1080, devicePath: 'monitor-hd' }
  const f = await fixture({ hotkeys: [{ id: 'f8', accelerator: 'F8', sessionId: 'missing', pinned: true, target, durationSec: 30 }] })
  try {
    const settings = await f.store.getSettings()
    const hotkey = settings.hotkeys.find(h => h.id === 'f8')
    assert.equal(hotkey.sessionId, 'missing')
    assert.equal(settings.sessions.find(s => s.id === 'missing').source.devicePath, target.devicePath)
  } finally { await f.cleanup() }
})
test('concurrent preference saves are atomic and pins survive a restart', async () => {
  const f = await fixture()
  try {
    const original = await f.store.getSettings()
    const source = { id: 'screen:0', type: 'screen', name: 'Pantalla 1', width: 1920, height: 1080 }
    const settings = { ...original, sessions: [{ id: 'a', source }], hotkeys: [{ id: 'f8', accelerator: 'F8', action: 'clip', durationSec: 30, sessionId: 'a' }] }
    await Promise.all([f.store.saveSettings(settings), f.store.saveSettings({ ...settings, fps: 30 })])
    const persisted = JSON.parse(await fs.readFile(path.join(f.dir, 'settings.json'), 'utf8'))
    assert.equal(persisted.fps, 30)
    assert.equal(persisted.hotkeys[0].pinned, true)
    assert.equal(persisted.hotkeys[0].target.width, 1920)
    await fs.writeFile(path.join(f.dir, 'settings.json'), '{broken')
    const recovered = await f.store.getSettings()
    assert.equal(recovered.hotkeys[0].accelerator, 'F8')
    assert.equal(recovered.hotkeys[0].target.width, 1920)
  } finally { await f.cleanup() }
})

test('continuous shortcuts default to unassigned and equal basenames in separate folders retain distinct index entries', async () => {
  const f = await fixture()
  try {
    const defaults = await f.store.getSettings()
    assert.equal(defaults.continuousToggleKey, '')
    assert.equal(defaults.continuousMarkerKey, '')
    const base = { fileName: 'session.mp4', createdAt: new Date().toISOString() }
    await f.store.upsertClip({ ...base, id: 'local' })
    await f.store.upsertClip({ ...base, id: 'external', storageDir: path.join(f.dir, 'elsewhere'), recording: true })
    assert.equal((await f.store.listClips()).length, 2)
  } finally { await f.cleanup() }
})
test('automatic cleanup excludes continuous recordings and their size from the clip budget', async () => {
  const f = await fixture({ diskLimitGB: 1 })
  try {
    const base = { createdAt: new Date().toISOString() }
    await f.store.upsertClip({ ...base, id: 'long', fileName: 'long.mp4', recording: true, sizeBytes: 10 * 1024 ** 3 })
    await f.store.upsertClip({ ...base, id: 'clip', fileName: 'short.mp4', sizeBytes: 1024 ** 2 })
    assert.equal(await f.store.enforceDiskLimit(), 0)
    assert.equal((await f.store.listClips()).length, 2)
  } finally { await f.cleanup() }
})

test('two pinned keys for one physical display share a surviving session without losing either key or duration', async () => {
  const target = { id: 'screen:0', type: 'screen', name: 'HD', devicePath: 'physical-hd', width: 1920, height: 1080 }
  const f = await fixture({ sessions: [{ id: 'one', source: target, autoArm: true }, { id: 'duplicate', source: target, autoArm: true }], hotkeys: [
    { id: 'a', accelerator: 'F8', action: 'clip', durationSec: 30, sessionId: 'one', pinned: true, target },
    { id: 'b', accelerator: 'F6', action: 'clip', durationSec: 60, sessionId: 'duplicate', pinned: true, target },
  ] })
  try {
    const settings = await f.store.getSettings()
    assert.equal(settings.sessions.length, 1)
    assert.deepEqual(JSON.parse(JSON.stringify(settings.hotkeys.filter(h => h.action === 'clip').map(h => [h.accelerator, h.durationSec, h.sessionId]))), [['F8', 30, 'one'], ['F6', 60, 'one']])
    await f.store.saveSettings(settings)
    assert.equal((await f.store.getSettings()).sessions.length, 1)
  } finally { await f.cleanup() }
})
