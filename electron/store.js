const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

const DEFAULT_SETTINGS = {
  hotkeys: [{ id: 'default-30', accelerator: 'F8', durationSec: 30, isDefault: true }],
  clipsDir: null,
  fps: 60,
  videoBitrateMbps: 12,
  captureSystemAudio: true,
  captureMic: false,
  lastSourceId: null,
  autoArmOnLaunch: false,
}

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const defaultClipsDir = () => path.join(app.getPath('videos'), 'Clipper')

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2))
  await fs.rename(tmp, file)
}

async function getSettings() {
  const saved = await readJson(settingsPath(), {})
  return { ...DEFAULT_SETTINGS, ...saved, clipsDir: saved.clipsDir || defaultClipsDir() }
}

async function saveSettings(settings) {
  await writeJson(settingsPath(), settings)
  await ensureDirs()
  return settings
}

async function getClipsDir() {
  const { clipsDir } = await getSettings()
  return clipsDir
}

async function ensureDirs() {
  const dir = await getClipsDir()
  await fs.mkdir(path.join(dir, '.thumbs'), { recursive: true })
}

const indexPath = async () => path.join(await getClipsDir(), 'index.json')

async function listClips() {
  const clips = await readJson(await indexPath(), [])
  return clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function getClip(id) {
  return (await listClips()).find((c) => c.id === id) || null
}

async function upsertClip(meta) {
  const clips = await listClips()
  const idx = clips.findIndex((c) => c.id === meta.id)
  if (idx >= 0) clips[idx] = meta
  else clips.push(meta)
  await writeJson(await indexPath(), clips)
}

async function removeClip(id) {
  const clips = (await listClips()).filter((c) => c.id !== id)
  await writeJson(await indexPath(), clips)
}

module.exports = { getSettings, saveSettings, getClipsDir, ensureDirs, listClips, getClip, upsertClip, removeClip }
