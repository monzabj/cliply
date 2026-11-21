const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { runBatch } = require('../electron/clip-batch')

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clipper-batch-'))
  const library = path.join(root, 'library'), destination = path.join(root, 'export')
  await fs.mkdir(library); await fs.mkdir(destination)
  const clips = [{ id: 'one', title: 'One', fileName: 'game.mp4', micFile: 'game.mic.m4a', inputsFile: 'game.inputs.json', audioApps: [{ file: 'game.app.m4a' }] }]
  for (const name of ['game.mp4', 'game.mic.m4a', 'game.inputs.json', 'game.app.m4a']) await fs.writeFile(path.join(library, name), name)
  const removed = [], store = { removeClip: async id => { removed.push(id) } }
  return { root, library, destination, clips, store, removed }
}

test('copy keeps originals and index, preserves all sidecars and never overwrites collisions', async () => {
  const f = await fixture()
  try {
    await fs.writeFile(path.join(f.destination, 'game.mp4'), 'existing')
    const result = await runBatch({ ...f, action: 'copy' })
    assert.deepEqual(result.completed, ['one']); assert.deepEqual(f.removed, [])
    assert.equal(await fs.readFile(path.join(f.destination, 'game.mp4'), 'utf8'), 'existing')
    assert.equal(await fs.readFile(path.join(f.destination, 'game (1).mp4'), 'utf8'), 'game.mp4')
    assert.equal((await fs.readdir(f.destination)).length, 5)
    assert.equal((await fs.readdir(f.library)).length, 4)
  } finally { await fs.rm(f.root, { recursive: true, force: true }) }
})

test('move handles external storage, edit originals and sidecars before removing the index entry', async () => {
  const f = await fixture()
  try {
    const storage = path.join(f.root, 'continuous'); await fs.mkdir(storage)
    f.clips[0].storageDir = storage
    for (const file of await fs.readdir(f.library)) await fs.rename(path.join(f.library, file), path.join(storage, file))
    await fs.mkdir(path.join(storage, '.originals'))
    await fs.writeFile(path.join(storage, '.originals/one.mp4'), 'unedited')
    f.clips[0].savedEdit = { originalSize: 8 }
    const result = await runBatch({ ...f, action: 'move' })
    assert.deepEqual(result.completed, ['one']); assert.deepEqual(f.removed, ['one'])
    assert.equal((await fs.readdir(f.destination)).length, 5)
    assert.equal(await fs.readFile(path.join(f.destination, 'game.clipper-original.mp4'), 'utf8'), 'unedited')
    await assert.rejects(fs.stat(path.join(storage, 'game.mp4')), { code: 'ENOENT' })
  } finally { await fs.rm(f.root, { recursive: true, force: true }) }
})

test('failed move restores removed originals and retains destination backups', async () => {
  const f = await fixture(), unlink = fs.unlink
  try {
    fs.unlink = async file => { if (file === path.join(f.library, 'game.mp4')) throw Object.assign(Error('locked'), { code: 'EPERM' }); return unlink(file) }
    const result = await runBatch({ ...f, action: 'move' })
    assert.equal(result.failed.length, 1); assert.deepEqual(f.removed, [])
    assert.equal((await fs.readdir(f.library)).length, 4)
    assert.equal((await fs.readdir(f.destination)).length, 4)
  } finally { fs.unlink = unlink; await fs.rm(f.root, { recursive: true, force: true }) }
})

test('refuses destinations inside the library, traversal and recordings without altering files', async () => {
  const f = await fixture()
  try {
    const nested = path.join(f.library, 'nested'); await fs.mkdir(nested)
    await assert.rejects(runBatch({ ...f, destination: nested, action: 'move' }), /outside/)
    f.clips[0].fileName = '../outside.mp4'
    assert.equal((await runBatch({ ...f, action: 'copy' })).failed.length, 1)
    f.clips[0].fileName = 'game.mp4'; f.clips[0].recording = true
    assert.equal((await runBatch({ ...f, action: 'copy' })).failed.length, 1)
    assert.deepEqual(f.removed, []); assert.equal((await fs.readdir(f.destination)).length, 0)
  } finally { await fs.rm(f.root, { recursive: true, force: true }) }
})

test('trash failures never fall back to permanent deletion, and later clips still process', async () => {
  const f = await fixture()
  try {
    f.clips.push({ id: 'two', title: 'Two', fileName: 'second.mp4' })
    await fs.writeFile(path.join(f.library, 'second.mp4'), 'second')
    const result = await runBatch({ ...f, action: 'delete', trashItem: async file => {
      if (file.endsWith('game.mic.m4a')) throw Error('Recycle Bin unavailable')
      await fs.unlink(file)
    } })
    assert.equal(result.failed.length, 1); assert.deepEqual(result.completed, ['two'])
    assert.deepEqual(f.removed, ['two'])
    assert.equal(await fs.readFile(path.join(f.library, 'game.mp4'), 'utf8'), 'game.mp4')
    assert.equal(await fs.readFile(path.join(f.library, 'game.mic.m4a'), 'utf8'), 'game.mic.m4a')
  } finally { await fs.rm(f.root, { recursive: true, force: true }) }
})
