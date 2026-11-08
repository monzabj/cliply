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
