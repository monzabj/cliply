const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

const DEFAULT_SESSION_ID = 'main'

const DEFAULT_SETTINGS = {
  hotkeys: [
    { id: 'default-30', accelerator: 'F8', action: 'clip', durationSec: 30, sessionId: DEFAULT_SESSION_ID, isDefault: true },
    { id: 'default-shot', accelerator: 'F7', action: 'shot', durationSec: 0, sessionId: DEFAULT_SESSION_ID },
  ],
  sessions: [{ id: DEFAULT_SESSION_ID, name: 'Monitor 1', source: null, autoArm: true }],
  clipsDir: null,
  fps: 60,
  videoBitrateMbps: 12,
  codec: 'auto',
  captureSystemAudio: true,
  // On by default: without it a clip has one audio layer and the editor cannot
  // balance your voice against the game. The mic stays a separate file either way.
  captureMic: true,
  micDeviceId: null,
  language: 'auto',
  launchOnStartup: false,
  startMinimized: false,
  soundCue: true,
  soundCueVolume: 0.5,
  previewSound: true,
  screenshotSound: true,
  screenshotCopy: true,
  clipSoundFile: null,
  screenshotSoundFile: null,
  diskLimitGB: 0,
  setupDone: false,
  monitorSetup: 'single',
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

/**
 * Brings settings written by older versions up to the current shape:
 * a single implicit capture source becomes one named session, and every hotkey
 * gains the session it clips from.
 */
function migrate(saved) {
  const out = { ...DEFAULT_SETTINGS, ...saved }

  if (!Array.isArray(out.sessions) || !out.sessions.length) {
    out.sessions = [
      {
        id: DEFAULT_SESSION_ID,
        name: 'Monitor 1',
        source: saved.lastSourceId
          ? { id: saved.lastSourceId, name: 'Monitor 1', type: 'screen', displayId: null }
          : null,
        autoArm: Boolean(saved.autoArmOnLaunch),
      },
    ]
  }

  const firstSession = out.sessions[0]?.id ?? DEFAULT_SESSION_ID
  out.hotkeys = (Array.isArray(out.hotkeys) ? out.hotkeys : DEFAULT_SETTINGS.hotkeys).map((h) => ({
    ...h,
    sessionId: h.sessionId === undefined ? firstSession : h.sessionId,
    // Everything that existed before actions were a thing was a clip key.
    action: h.action || 'clip',
  }))

  // Give older installs the screenshot key they never had.
  if (!out.hotkeys.some((h) => h.action !== 'clip')) {
    const used = new Set(out.hotkeys.map((h) => h.accelerator))
    const free = ['F7', 'F6', 'F4', 'F2'].find((k) => !used.has(k))
    if (free) {
      out.hotkeys = [
        ...out.hotkeys,
        { id: 'default-shot', accelerator: free, action: 'shot', durationSec: 0, sessionId: firstSession },
      ]
    }
  }

  // Older setups named sessions "Monitor 1, 2…" by list order, which need not
  // match Windows' own numbering — "Monitor 1" could be recording "Pantalla 2".
  // Such placeholder names give way to the name of the screen actually recorded.
  out.sessions = out.sessions.map((sess) =>
    sess.source && sess.source.name && /^Monitor \d+$/.test(sess.name || '')
      ? { ...sess, name: sess.source.name }
      : sess,
  )

  // Two sessions on the same screen means that screen gets recorded twice. It
  // used to happen when an identifier drifted and the UI created a duplicate
  // instead of recognising the existing one; drop the extras on load.
  const seen = []
  out.sessions = out.sessions.filter((sess) => {
    const src = sess.source
    if (!src) return true
    const dup = seen.find(
      (x) =>
        (x.displayId && src.displayId && String(x.displayId) === String(src.displayId)) ||
        x.id === src.id ||
        (x.type === src.type && x.name && x.name === src.name),
    )
    if (dup) return false
    seen.push(src)
    return true
  })
  if (!out.sessions.length) out.sessions = [...DEFAULT_SETTINGS.sessions]

  // Hotkeys left pointing at a session that just went away.
  const alive = new Set(out.sessions.map((x) => x.id))
  out.hotkeys = out.hotkeys.map((h) =>
    h.sessionId && !alive.has(h.sessionId) ? { ...h, sessionId: out.sessions[0].id } : h,
  )

  delete out.lastSourceId
  delete out.autoArmOnLaunch
  return out
}

/**
 * One-time changes to a user's saved choices, applied once and then never again
 * — so switching something back off afterwards sticks. Tracked in their own
 * file because the renderer rewrites settings.json wholesale.
 */
const migrationsPath = () => path.join(app.getPath('userData'), 'migrations.json')

async function runOnceMigrations(saved) {
  const done = new Set(await readJson(migrationsPath(), []))
  let changed = false

  // 1.3: the mic layer defaulted to off, so most installs never recorded one.
  if (!done.has('mic-on-1.3')) {
    done.add('mic-on-1.3')
    if (saved && Object.keys(saved).length && saved.captureMic === false) {
      saved.captureMic = true
      changed = true
    }
  }

  if (changed) await writeJson(settingsPath(), saved)
  await writeJson(migrationsPath(), [...done])
}

// Shared by concurrent callers, so the migrations run exactly once per launch.
let migrationsRan = null

async function getSettings() {
  if (!migrationsRan) {
    migrationsRan = readJson(settingsPath(), {})
      .then(runOnceMigrations)
      .catch(() => {})
  }
  await migrationsRan
  const saved = await readJson(settingsPath(), {})
  const merged = migrate(saved)
  return { ...merged, clipsDir: merged.clipsDir || defaultClipsDir() }
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
  const idx = clips.findIndex((c) => c.id === meta.id || c.fileName === meta.fileName)
  if (idx >= 0) clips[idx] = meta
  else clips.push(meta)
  await writeJson(await indexPath(), clips)
}

async function removeClip(id) {
  const clips = (await listClips()).filter((c) => c.id !== id)
  await writeJson(await indexPath(), clips)
}

// --- screenshots -------------------------------------------------------------

const shotsDir = async () => path.join(await getClipsDir(), 'Capturas')
const shotsIndexPath = async () => path.join(await shotsDir(), 'index.json')

async function listShots() {
  const shots = await readJson(await shotsIndexPath(), [])
  return shots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function getShot(id) {
  return (await listShots()).find((s) => s.id === id) || null
}

async function upsertShot(meta) {
  const shots = await listShots()
  // Match on the file too: an adopted row gets a fresh id each time, so only the
  // file name can tell us it is the same screenshot.
  const idx = shots.findIndex((s) => s.id === meta.id || s.fileName === meta.fileName)
  if (idx >= 0) shots[idx] = meta
  else shots.push(meta)
  await writeJson(await shotsIndexPath(), shots)
}

async function removeShot(id) {
  const shots = (await listShots()).filter((s) => s.id !== id)
  await writeJson(await shotsIndexPath(), shots)
}

async function diskUsage() {
  const [clips, shots] = await Promise.all([listClips(), listShots()])
  return (
    clips.reduce((acc, c) => acc + (c.sizeBytes || 0), 0) +
    shots.reduce((acc, s) => acc + (s.sizeBytes || 0), 0)
  )
}

/**
 * Drops the oldest clips until the folder fits under the configured cap.
 * Returns how many were removed so the UI can say something.
 */
async function enforceDiskLimit() {
  const settings = await getSettings()
  const limitBytes = (settings.diskLimitGB || 0) * 1024 * 1024 * 1024
  if (!limitBytes) return 0

  const clipsDir = settings.clipsDir
  const clips = await listClips() // newest first
  let total = clips.reduce((acc, c) => acc + (c.sizeBytes || 0), 0)
  if (total <= limitBytes) return 0

  let removed = 0
  // Walk from the oldest end.
  for (let i = clips.length - 1; i >= 0 && total > limitBytes; i--) {
    const clip = clips[i]
    try {
      await fs.rm(path.join(clipsDir, clip.fileName), { force: true })
      if (clip.thumbnail) await fs.rm(path.join(clipsDir, '.thumbs', clip.thumbnail), { force: true })
      await fs.rm(path.join(clipsDir, '.thumbs', `${clip.id}-strip.jpg`), { force: true })
      await fs.rm(path.join(clipsDir, '.thumbs', `${clip.id}-preview.mp4`), { force: true })
      if (clip.micFile) await fs.rm(path.join(clipsDir, clip.micFile), { force: true })
    } catch {
      /* keep going; a locked file should not stall the cleanup */
    }
    total -= clip.sizeBytes || 0
    removed++
    await removeClip(clip.id)
  }
  return removed
}

module.exports = {
  listShots,
  getShot,
  upsertShot,
  removeShot,
  getSettings,
  saveSettings,
  getClipsDir,
  ensureDirs,
  listClips,
  getClip,
  upsertClip,
  removeClip,
  diskUsage,
  enforceDiskLimit,
  DEFAULT_SETTINGS,
}
