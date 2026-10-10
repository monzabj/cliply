const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  screen,
  session,
  protocol,
  net,
  dialog,
  shell,
  clipboard,
  ClipboardItem,
  Tray,
  Menu,
  nativeImage,
} = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs/promises')
const { execFile } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { createReadStream, existsSync: _existsSync } = require('node:fs')
const fs_sync = { existsSync: _existsSync }
const { Readable } = require('node:stream')
const log = require('./log')
const store = require('./store')
const medal = require('./medal-import')
const { autoUpdater } = require('electron-updater')
const ffmpeg = require('./ffmpeg')
const native = require('./native-recorder')
const { getForegroundWindow, shutdown: shutdownForeground } = require('./foreground')

const DEV_URL = process.env.ELECTRON_RENDERER_URL
const isDev = Boolean(DEV_URL)

// Fallback capture path (windows, or machines where the native recorder cannot
// start): Windows Graphics Capture reads the screen on the GPU. Chromium's
// default falls back to GDI whenever DXGI duplication fails — measured ~31 fps
// against ~40 with WGC on a 60 fps setting.
app.commandLine.appendSwitch('enable-features', 'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'clip', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
])

/** @type {BrowserWindow | null} */
let win = null
/** @type {Tray | null} */
let tray = null
/** @type {{ id: string, name: string, type: string } | null} */
let selectedSource = null
let quitting = false

// Minimal main-process strings; the renderer owns the rest of the translations.
const TRAY_TEXT = {
  en: { open: 'Open Clipper', quit: 'Quit' },
  es: { open: 'Abrir Clipper', quit: 'Salir' },
}

// The context menu is built in the main process, so it uses native labels.
const MENU_TEXT = {
  reveal: 'Abrir ubicación del archivo',
  play: 'Reproducir con el reproductor del sistema',
  copyName: 'Copiar nombre del archivo',
  delete: 'Borrar clip',
}

function trayLang(settings) {
  const lang = settings?.language === 'auto' || !settings?.language ? app.getLocale() : settings.language
  return String(lang).toLowerCase().startsWith('es') ? 'es' : 'en'
}

/**
 * Brings the window up the way the user expects to find it: filling the screen,
 * never behind another window. Maximizing a hidden window would show it, so the
 * hidden case waits and maximizes on the way out of the tray.
 */
function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isMaximized()) win.maximize()
  win.show()
  win.focus()
}

async function createWindow() {
  const settings = await store.getSettings()
  // "Start minimised" is about logon: the autostart entry carries --hidden
  // (see applyLoginItem). Opening Clipper by hand should always show it —
  // otherwise a double-click on the shortcut appears to do nothing.
  const startHidden = process.argv.includes('--hidden')
  log.write('inicio', `ventana ${startHidden ? 'oculta (bandeja)' : 'visible'} | minimizada=${settings.startMinimized}`)

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#15161a',
    title: 'Clipper',
    autoHideMenuBar: true,
    show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The rolling buffer lives in the renderer. Without this, Chromium throttles
      // timers and media once the window is hidden or minimised, which would stall
      // recording exactly when the app is sitting in the tray during a game.
      backgroundThrottling: false,
    },
  })

  // A window that fills the screen, but still a window: the library and the
  // trim bar both want the width, and a maximized frame can still be restored.
  if (!startHidden) win.maximize()

  if (isDev) win.loadURL(DEV_URL)
  else win.loadURL('app://renderer/index.html')

  // Closing the window keeps the rolling buffer alive in the tray; quit from the tray menu.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
}

function trayIcon(recording) {
  const name = recording ? 'tray-rec' : 'tray-idle'
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'public', `${name}-32.png`))
  if (img.isEmpty()) return nativeImage.createEmpty()
  // Windows draws the tray at 16px; handing it the 32px asset keeps it sharp on
  // scaled displays without shipping a separate file per DPI.
  img.setTemplateImage(false)
  return img.resize({ width: 16, height: 16, quality: 'best' })
}

async function createTray() {
  const settings = await store.getSettings()
  const text = TRAY_TEXT[trayLang(settings)]
  tray = new Tray(trayIcon(false))
  tray.setToolTip('Clipper')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: text.open, click: () => showWindow() },
      { type: 'separator' },
      {
        label: text.quit,
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', () => showWindow())
  tray.on('double-click', () => showWindow())
}

/** The renderer owns the recording state, so it tells the tray what to show. */
function setTrayState(recording, label) {
  if (!tray) return
  try {
    tray.setImage(trayIcon(recording))
    tray.setToolTip(recording ? `Clipper — ${label || 'grabando'}` : 'Clipper')
  } catch {
    /* tray may be gone during shutdown */
  }
}

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

/**
 * Serves a file with byte-range support.
 *
 * Without this a <video> reports an empty `seekable` range and silently refuses
 * every currentTime assignment — clicking the timeline, dragging the trim
 * handles and the loop-inside-selection all did nothing.
 */
async function serveFile(filePath, request) {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const type = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
  const size = stat.size
  const range = request.headers.get('Range')

  const body = (start, end) => Readable.toWeb(createReadStream(filePath, { start, end }))

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      let start = m[1] ? Number(m[1]) : 0
      let end = m[2] ? Number(m[2]) : size - 1
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      end = Math.min(end, size - 1)
      return new Response(body(start, end), {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
      })
    }
  }

  return new Response(body(0, size - 1), {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    },
  })
}

function registerProtocols() {
  const outDir = path.join(__dirname, '..', 'out')
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const filePath = path.join(outDir, rel)
    return net.fetch(pathToFileURL(filePath).toString())
  })

  protocol.handle('clip', async (request) => {
    const url = new URL(request.url)
    const clipsDir = await store.getClipsDir()
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const base =
      url.host === 'thumbs'
        ? path.join(clipsDir, '.thumbs')
        : url.host === 'sound'
          ? path.join(app.getPath('userData'), 'sounds')
          : url.host === 'shots'
            ? path.join(clipsDir, 'Capturas')
            : clipsDir
    const filePath = path.join(base, name)
    if (!filePath.startsWith(base)) return new Response('Forbidden', { status: 403 })
    return serveFile(filePath, request)
  })
}


// --- clip naming -------------------------------------------------------------

/**
 * Shells and system windows make useless clip names ("Explorador de Windows"),
 * so when the foreground app is one of these we fall back to the screen.
 */
const SYSTEM_APPS = [
  /explorador de windows/i,
  /windows explorer/i,
  /^explorer$/i,
  /powershell/i,
  /^pwsh$/i,
  /^cmd$/i,
  /simbolo del sistema/i,
  /s\u00edmbolo del sistema/i,
  /command prompt/i,
  /windows terminal/i,
  /^terminal$/i,
  /administrador de tareas/i,
  /task manager/i,
  /^configuracion/i,
  /^configuraci\u00f3n/i,
  /^settings$/i,
  /^escritorio$/i,
  /^desktop window manager$/i,
  /^shell/i,
  /^aplicacion/i,
  /^aplicaci\u00f3n/i,
]

function isSystemApp(name) {
  if (!name) return true
  return SYSTEM_APPS.some((re) => re.test(name.trim()))
}

/** The name a clip should carry: the game if it is one, else the screen. */
function clipDisplayName(source) {
  const app = source && source.app
  if (app && !isSystemApp(app)) return app.trim()
  return (source && (source.sessionName || source.name)) || 'Clip'
}

/**
 * Cleans a name the user typed. Unlike the generated names this keeps spaces —
 * they are legal on Windows and it is what someone types — and only strips the
 * characters the filesystem refuses.
 */
function sanitizeUserFileName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120)
}

/** Windows-safe, trimmed, spaces collapsed to a single separator. */
function sanitizeName(name) {
  return (
    String(name)
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/[\u0000-\u001f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 60) || 'Clip'
  )
}

/**
 * Human-facing title: "League of Legends - 11/09/2026 - 02:21". Deliberately a
 * different shape from the file name, which is built for sorting.
 */
function clipTitle(displayName, date) {
  const p = (n) => String(n).padStart(2, '0')
  const fecha = `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()}`
  const hora = `${p(date.getHours())}:${p(date.getMinutes())}`
  return `${displayName} - ${fecha} - ${hora}`
}

/** DD_MM_YYYY_HH_MM_SS in local time, so the file sorts and reads naturally. */
function timeStamp(date) {
  const p = (n) => String(n).padStart(2, '0')
  return [
    p(date.getDate()),
    p(date.getMonth() + 1),
    date.getFullYear(),
    p(date.getHours()),
    p(date.getMinutes()),
    p(date.getSeconds()),
  ].join('_')
}

/**
 * Builds a unique file name. Two monitors clipped on the same keypress land in
 * the same second, so collisions are normal and get a numeric suffix.
 */
function uniqueClipName(dir, displayName, date, ext) {
  const base = `${sanitizeName(displayName)}_${timeStamp(date)}`
  let candidate = `${base}.${ext}`
  let n = 2
  while (require('node:fs').existsSync(path.join(dir, candidate))) {
    candidate = `${base}_${n}.${ext}`
    n++
  }
  return candidate
}

// --- capture sources ---------------------------------------------------------

function displaySizeFor(displayId) {
  const match = screen.getAllDisplays().find((d) => String(d.id) === String(displayId))
  if (!match) return { width: null, height: null }
  return {
    width: Math.round(match.size.width * match.scaleFactor),
    height: Math.round(match.size.height * match.scaleFactor),
  }
}

function toCaptureSource(s, withThumb) {
  const type = s.id.startsWith('screen') ? 'screen' : 'window'
  const size = type === 'screen' ? displaySizeFor(s.display_id) : { width: null, height: null }
  return {
    id: s.id,
    name: s.name,
    type,
    displayId: s.display_id || null,
    width: size.width,
    height: size.height,
    thumbnail: withThumb && s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
    appIcon: withThumb && s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
  }
}

/**
 * Windows renumbers desktopCapturer ids whenever the display set changes — adding
 * a monitor, or a virtual display driver (Parsec, OBS, a VR headset) waking up.
 * A saved id therefore goes stale routinely, so match on the stable display id
 * first and only fall back to the raw id. Returning null is deliberate: the
 * caller must tell the user rather than capture a different screen silently.
 */
function matchSource(sources, ref) {
  if (ref.displayId) {
    const byDisplay = sources.find((s) => s.display_id && String(s.display_id) === String(ref.displayId))
    if (byDisplay) return byDisplay
  }

  const byId = sources.find((s) => s.id === ref.id)
  if (byId) return byId

  const wantScreen = ref.type === 'screen'
  const sameKind = sources.filter((s) => s.id.startsWith('screen') === wantScreen)

  const byName = sameKind.filter((s) => s.name === ref.name)
  if (byName.length === 1) return byName[0]

  // Last resort for screens: a single display of the same resolution.
  if (wantScreen && ref.width && ref.height) {
    const bySize = sameKind.filter((s) => {
      const size = displaySizeFor(s.display_id)
      return size.width === ref.width && size.height === ref.height
    })
    if (bySize.length === 1) return bySize[0]
  }

  return null
}

/**
 * Grabs a still of one source at its native resolution. Uses desktopCapturer
 * rather than the renderer so a screenshot works even while the window is
 * hidden in the tray, and never disturbs the rolling buffers.
 */
async function captureStill(sessionSource) {
  const types = sessionSource && sessionSource.type === 'window' ? ['window'] : ['screen']
  const size =
    sessionSource && sessionSource.width && sessionSource.height
      ? { width: sessionSource.width, height: sessionSource.height }
      : { width: 3840, height: 2160 }

  const sources = await desktopCapturer.getSources({ types, thumbnailSize: size })
  const match = sessionSource ? matchSource(sources, sessionSource) : sources[0]
  const picked = match || sources[0]
  if (!picked || picked.thumbnail.isEmpty()) return null
  return { image: picked.thumbnail, name: picked.name }
}

/**
 * @param {'shot'|'shot-copy'} action  'shot-copy' never writes a file.
 */
async function takeScreenshot(action, sessionId) {
  const settings = await store.getSettings()
  const session =
    settings.sessions.find((x) => x.id === sessionId) || settings.sessions.find((x) => x.source) || settings.sessions[0]

  const still = await captureStill(session && session.source)
  if (!still) {
    log.write('captura', 'no se pudo capturar: fuente no disponible')
    return { ok: false, reason: 'source' }
  }

  const copyOnly = action === 'shot-copy'
  if (copyOnly || settings.screenshotCopy) {
    // Electron 44's main-process clipboard mirrors the async web API: no
    // writeImage, and write() wants ClipboardItems.
    try {
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([still.image.toPNG()], { type: 'image/png' }) }),
      ])
    } catch (err) {
      log.write('captura', `no se pudo copiar al portapapeles: ${err && err.message}`)
    }
  }

  if (copyOnly) {
    log.write('captura', 'copiada al portapapeles (sin guardar)')
    return { ok: true, copied: true, saved: false }
  }

  const clipsDir = await store.getClipsDir()
  const shotsDir = path.join(clipsDir, 'Capturas')
  await fs.mkdir(shotsDir, { recursive: true })

  const foreground = await getForegroundWindow()
  const displayName = clipDisplayName({
    app: foreground,
    name: still.name,
    sessionName: session ? session.name : null,
  })
  const now = new Date()
  const fileName = uniqueClipName(shotsDir, displayName, now, 'png')
  const full = path.join(shotsDir, fileName)
  await fs.writeFile(full, still.image.toPNG())

  const size = still.image.getSize()
  const stat = await fs.stat(full)
  const thumbName = fileName.replace(/\.png$/i, '') + '.jpg'
  const thumbOk = await ffmpeg
    .imageThumbnail(full, path.join(clipsDir, '.thumbs', thumbName))
    .then(() => true)
    .catch(() => false)
  const meta = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    fileName,
    displayName,
    title: clipTitle(displayName, now),
    createdAt: now.toISOString(),
    sizeBytes: stat.size,
    width: size.width,
    height: size.height,
    thumbnail: thumbOk ? thumbName : null,
    source: {
      name: still.name,
      sessionName: session ? session.name : null,
      app: foreground,
    },
  }
  await store.upsertShot(meta)

  log.write('captura', `guardada ${fileName} (${size.width}x${size.height})`)
  return {
    ok: true,
    copied: copyOnly || settings.screenshotCopy,
    saved: true,
    fileName,
    path: full,
    width: size.width,
    height: size.height,
    meta,
  }
}

const CLIP_EXTS = new Set(['.mp4', '.webm', '.mkv'])
const SHOT_EXTS = new Set(['.png', '.jpg', '.jpeg'])

/** Pulls the readable name back out of "<Name>_DD_MM_YYYY_HH_MM_SS.ext". */
function parseFileName(fileName) {
  const base = path.basename(fileName, path.extname(fileName))
  const m = /^(.*)_(\d{2})_(\d{2})_(\d{4})_(\d{2})_(\d{2})_(\d{2})(?:_\d+)?$/.exec(base)
  if (!m) return { displayName: base.replace(/-/g, ' '), date: null }
  const [, name, dd, mm, yyyy, hh, mi, ss] = m
  return {
    displayName: name.replace(/-/g, ' '),
    date: new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)),
  }
}

/**
 * Takes ownership of media sitting in the folders that the index does not know
 * about — a file restored from the Recycle Bin, copied in by hand, or left over
 * from a version that kept no index. Without this they are invisible forever.
 */
let adoptInFlight = null

/** Serialised so two callers cannot adopt the same file twice. */
function adoptOrphans() {
  if (!adoptInFlight) {
    adoptInFlight = adoptOrphansOnce().finally(() => {
      adoptInFlight = null
    })
  }
  return adoptInFlight
}

/** Runs `fn` with a private temp folder that is removed afterwards, whatever happens. */
async function withTemp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipper-save-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Files being written by a save right now. Without this the library listing
 * raced the save: it found the half-written file, "adopted" it as an orphan
 * with its own id, and the save then had to fight it for the index entry.
 */
const savingFiles = new Set()

async function adoptOrphansOnce() {
  const clipsDir = await store.getClipsDir()

  // ---- clips ----
  const known = new Set((await store.listClips()).map((c) => c.fileName))
  const entries = await fs.readdir(clipsDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!CLIP_EXTS.has(ext) || known.has(entry.name)) continue
    if (entry.name.endsWith('.mic.m4a')) continue
    if (savingFiles.has(entry.name)) continue

    const full = path.join(clipsDir, entry.name)
    const stat = await fs.stat(full)
    // Belt and braces: anything touched in the last few seconds may still be
    // in someone's hands (ours or a copy in progress). It will still be there later.
    if (Date.now() - stat.mtimeMs < 10000) continue
    const { displayName, date } = parseFileName(entry.name)
    const when = date ?? stat.mtime
    const id = `adopt-${stat.mtimeMs.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const duration = await ffmpeg.probeDuration(full).catch(() => null)
    const thumb = await ffmpeg
      .thumbnail(full, path.join(clipsDir, '.thumbs', `${id}.jpg`))
      .then(() => `${id}.jpg`)
      .catch(() => null)

    const micName = entry.name.replace(/\.[^.]+$/, '') + '.mic.m4a'
    const hasMic = await fs
      .stat(path.join(clipsDir, micName))
      .then(() => true)
      .catch(() => false)

    await store.upsertClip({
      id,
      fileName: entry.name,
      displayName,
      title: clipTitle(displayName, when),
      createdAt: when.toISOString(),
      durationSec: duration ? Math.round(duration) : 0,
      source: { type: 'screen', name: displayName, sessionName: null, app: null },
      sizeBytes: stat.size,
      thumbnail: thumb,
      format: ext === '.mp4' ? 'mp4' : 'webm',
      micFile: hasMic ? micName : null,
      mix: { game: 1, mic: 1, gameMuted: false, micMuted: false },
    })
    log.write('biblioteca', `clip adoptado: ${entry.name}`)
  }

  // ---- screenshots ----
  const shotsFolder = path.join(clipsDir, 'Capturas')
  const knownShots = new Set((await store.listShots()).map((s) => s.fileName))
  const shotEntries = await fs.readdir(shotsFolder, { withFileTypes: true }).catch(() => [])
  for (const entry of shotEntries) {
    if (!entry.isFile()) continue
    if (!SHOT_EXTS.has(path.extname(entry.name).toLowerCase()) || knownShots.has(entry.name)) continue

    const full = path.join(shotsFolder, entry.name)
    const stat = await fs.stat(full)
    const { displayName, date } = parseFileName(entry.name)
    const when = date ?? stat.mtime
    const id = `adopt-${stat.mtimeMs.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const size = (await ffmpeg.probeSize(full).catch(() => null)) || { width: 0, height: 0 }
    const thumbName = `${id}.jpg`
    const thumbOk = await ffmpeg
      .imageThumbnail(full, path.join(clipsDir, '.thumbs', thumbName))
      .then(() => true)
      .catch(() => false)

    await store.upsertShot({
      id,
      fileName: entry.name,
      displayName,
      title: clipTitle(displayName, when),
      createdAt: when.toISOString(),
      sizeBytes: stat.size,
      width: size.width,
      height: size.height,
      thumbnail: thumbOk ? thumbName : null,
      source: { name: displayName, sessionName: null, app: null },
    })
    log.write('biblioteca', `captura adoptada: ${entry.name}`)
  }
}

// --- hover previews ----------------------------------------------------------

const previewName = (id) => `${id}-preview.mp4`

/** Whether the cached preview exists and is newer than the clip it copies. */
async function previewState(clip, clipsDir) {
  const name = previewName(clip.id)
  const [prev, src] = await Promise.all([
    fs.stat(path.join(clipsDir, '.thumbs', name)).catch(() => null),
    fs.stat(path.join(clipsDir, clip.fileName)).catch(() => null),
  ])
  const fresh = Boolean(prev && src && prev.mtimeMs >= src.mtimeMs)
  return { name, fresh, version: prev ? Math.round(prev.mtimeMs) : 0 }
}

// One ffmpeg at a time: hovering across a whole row must not start twenty.
const previewQueue = []
const previewQueued = new Set()
let previewBusy = false

function queuePreview(id) {
  if (previewQueued.has(id)) return
  previewQueued.add(id)
  previewQueue.push(id)
  void drainPreviews()
}

async function drainPreviews() {
  if (previewBusy) return
  previewBusy = true
  try {
    while (previewQueue.length) {
      const id = previewQueue.shift()
      try {
        const clip = await store.getClip(id)
        if (!clip) continue
        const clipsDir = await store.getClipsDir()
        if ((await previewState(clip, clipsDir)).fresh) continue
        const started = Date.now()
        await ffmpeg.previewProxy(
          path.join(clipsDir, clip.fileName),
          clip.micFile ? path.join(clipsDir, clip.micFile) : null,
          clip.mix,
          path.join(clipsDir, '.thumbs', previewName(clip.id)),
        )
        log.write('preview', `lista ${clip.fileName} (${Date.now() - started}ms)`)
      } catch (err) {
        log.write('preview', `fallo ${id}: ${err && err.message}`)
      } finally {
        previewQueued.delete(id)
      }
    }
  } finally {
    previewBusy = false
  }
}

function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })

      // With a source chosen, capture that one or nothing at all. The old
      // behaviour fell back to sources[0] and silently recorded the wrong screen.
      const match = selectedSource ? sources.find((s) => s.id === selectedSource.id) : sources[0]
      if (!match) return callback({})

      // 'loopback' captures system audio (Windows). Other platforms fall back to no audio.
      callback({ video: match, audio: process.platform === 'win32' ? 'loopback' : undefined })
    },
    { useSystemPicker: false },
  )
}

function send(channel, payload) {
  win?.webContents.send(channel, payload)
}

/** Last set we were asked to bind, so a lost key can be re-bound. */
let currentHotkeys = []

// Holding a key a fraction too long makes Windows auto-repeat it, and every
// repeat used to save another, near-identical clip or screenshot.
const HOTKEY_REPEAT_MS = 1500
const lastFired = new Map()

async function registerHotkeys(hotkeys) {
  globalShortcut.unregisterAll()
  currentHotkeys = Array.isArray(hotkeys) ? hotkeys : []

  const failed = []
  for (const hk of currentHotkeys) {
    if (!hk.accelerator) continue
    try {
      const bound = globalShortcut.register(hk.accelerator, () => {
        const now = Date.now()
        if (now - (lastFired.get(hk.accelerator) || 0) < HOTKEY_REPEAT_MS) {
          log.write('hotkey', `${hk.accelerator} repetida, ignorada`)
          return
        }
        lastFired.set(hk.accelerator, now)
        // Logged here, before anything else, so we can tell "Windows never gave
        // us the key" apart from "we got it but nothing was armed".
        log.write('hotkey', `${hk.accelerator} recibida (accion=${hk.action || 'clip'}, sesion=${hk.sessionId ?? 'todas'})`)

        if (hk.action === 'shot' || hk.action === 'shot-copy') {
          // Stills are handled here: no renderer round trip, and they work even
          // with the window hidden. The renderer only gets told to play the cue.
          send('shot:started', hk)
          takeScreenshot(hk.action, hk.sessionId)
            .then((res) => send('shot:done', res))
            .catch((err) => {
              log.write('captura', `fallo: ${err && err.message}`)
              send('shot:done', { ok: false })
            })
          return
        }

        // The press time travels with the key: the clip has to end at the moment
        // it was pressed, not when the renderer got round to handling it.
        send('hotkeys:pressed', { ...hk, pressedAt: now })
      })
      // register() can report success while the accelerator is not actually ours.
      const really = bound && globalShortcut.isRegistered(hk.accelerator)
      if (!really) failed.push(hk.accelerator)
      log.write('hotkey', `registrar ${hk.accelerator}: ${really ? 'OK' : 'FALLO'}`)
    } catch (err) {
      failed.push(hk.accelerator)
      log.write('hotkey', `registrar ${hk.accelerator}: EXCEPCION ${err && err.message}`)
    }
  }
  return { failed }
}

/**
 * Another app grabbing the same key silently takes it from us, and the user only
 * finds out when a clip does not happen. Re-claim anything we have lost.
 */
function watchHotkeys() {
  setInterval(() => {
    if (!currentHotkeys.length) return
    const lost = currentHotkeys.filter((h) => h.accelerator && !globalShortcut.isRegistered(h.accelerator))
    if (!lost.length) return
    log.write('hotkey', `perdidas: ${lost.map((h) => h.accelerator).join(', ')} — reintentando`)
    void registerHotkeys(currentHotkeys)
  }, 20000)
}

function applyLoginItem(settings) {
  if (process.platform === 'linux') return
  app.setLoginItemSettings({
    openAtLogin: Boolean(settings.launchOnStartup),
    openAsHidden: Boolean(settings.startMinimized),
    args: settings.startMinimized ? ['--hidden'] : [],
  })
}

function registerIpc() {
  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:save', async (_e, settings) => {
    const saved = await store.saveSettings(settings)
    applyLoginItem(saved)
    return saved
  })

  ipcMain.handle('sources:list', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    })
    return sources.map((s) => toCaptureSource(s, true))
  })

  ipcMain.handle('sources:resolve', async (_e, ref) => {
    if (!ref) return null
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
    const match = matchSource(sources, ref)
    return match ? toCaptureSource(match, false) : null
  })

  ipcMain.handle('sources:select', (_e, source) => {
    selectedSource = source
  })
  ipcMain.handle('system:foreground-window', () => getForegroundWindow())

  // --- updates ---------------------------------------------------------------

  // Nothing downloads on its own: the app says a version is out and waits to be
  // told. A 200 MB download nobody asked for is not a courtesy.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = { info: (m) => log.write('update', String(m)), warn: (m) => log.write('update', String(m)), error: (m) => log.write('update', String(m)), debug: () => {} }

  let updateState = { status: 'idle', version: null, percent: 0, error: null }
  const setUpdateState = (patch) => {
    updateState = { ...updateState, ...patch }
    send('update:state', updateState)
  }

  autoUpdater.on('update-available', (info) => setUpdateState({ status: 'available', version: info.version, error: null }))
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'current', version: null, error: null }))
  autoUpdater.on('download-progress', (p) => setUpdateState({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => setUpdateState({ status: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', (err) => setUpdateState({ status: 'error', error: String((err && err.message) || err) }))

  /**
   * A build running from source has no release to compare itself against, and
   * electron-updater throws rather than saying so.
   */
  function canUpdate() {
    return app.isPackaged
  }

  ipcMain.handle('update:check', async () => {
    if (!canUpdate()) {
      setUpdateState({ status: 'unsupported' })
      return updateState
    }
    setUpdateState({ status: 'checking', error: null })
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      setUpdateState({ status: 'error', error: String((err && err.message) || err) })
    }
    return updateState
  })

  ipcMain.handle('update:download', async () => {
    if (!canUpdate()) return updateState
    setUpdateState({ status: 'downloading', percent: 0, error: null })
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      setUpdateState({ status: 'error', error: String((err && err.message) || err) })
    }
    return updateState
  })

  ipcMain.handle('update:install', () => {
    if (updateState.status !== 'ready') return
    quitting = true
    // The second argument tells the installer to start the app again afterwards.
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle('update:state', () => ({ ...updateState, current: app.getVersion() }))

  // A quiet look on startup, once the app has settled. It only ever sets the
  // badge — nothing is downloaded and nothing interrupts a game.
  if (canUpdate()) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => log.write('update', `chequeo fallo: ${err && err.message}`))
    }, 20000)
  }

  // --- importing an old Medal library ---------------------------------------

  // The scan is kept in the main process between the preview and the import, so
  // that saying yes does not mean walking 50 GB of folders a second time.
  let medalScan = []
  let medalCancel = false

  ipcMain.handle('medal:pick', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('medal:scan', async (_e, roots) => {
    const { items, sections } = await medal.scanMedalLibrary(roots)
    medalScan = items
    const clipsDir = await store.getClipsDir()
    const done = await medal.readJournal(clipsDir)
    log.write('importacion', `escaneo: ${items.length} archivos en ${roots.join(', ')}`)
    return {
      sections,
      summary: medal.summarize(items),
      // A previous run that was interrupted leaves these already handled.
      alreadyDone: items.filter((i) => done.has(i.path)).length,
    }
  })

  ipcMain.handle('medal:import', async (_e, options) => {
    const { mode = 'copy', kinds = ['clip'] } = options || {}
    if (!medalScan.length) throw new Error('nothing-scanned')

    const clipsDir = await store.getClipsDir()
    const chosen = medalScan.filter((i) => kinds.includes(i.kind))
    medalCancel = false

    let last = 0
    const result = await medal.importMedal(chosen, {
      clipsDir,
      mode,
      store,
      ffmpeg,
      log: (tag, msg) => log.write(tag, msg),
      clipTitle,
      uniqueName: uniqueClipName,
      shouldStop: () => medalCancel,
      onProgress: (p) => {
        // One message per file would be 1,500 round trips; the bar does not need
        // that and the renderer has better things to do.
        const now = Date.now()
        if (p.phase !== 'done' && now - last < 200) return
        last = now
        send('medal:progress', p)
      },
    })

    log.write(
      'importacion',
      `${mode}: ${result.imported} importados, ${result.skipped} salteados, ${result.failed} fallados`,
    )
    return result
  })

  ipcMain.handle('medal:cancel', () => {
    medalCancel = true
  })

  /** Throw away the journal so the next import starts from the beginning. */
  ipcMain.handle('medal:reset', async () => {
    await medal.clearJournal(await store.getClipsDir())
  })

  /**
   * Puts a game on clips that came in without one. Medal could not tell what was
   * being played for most of a library, so this is how those get a real name —
   * in bulk, since doing it one by one across a thousand clips is not a thing
   * anybody would finish.
   */
  ipcMain.handle('clips:set-game', async (_e, ids, game) => {
    const clean = game ? String(game).trim().slice(0, 60) : null
    const updated = []
    for (const id of ids) {
      const clip = await store.getClip(id)
      if (!clip) continue
      const displayName = clean || 'Medal'
      const next = {
        ...clip,
        displayName,
        title: clipTitle(displayName, new Date(clip.createdAt)),
        // Only the game changes; where the clip came from is not ours to rewrite.
        source: { ...clip.source, app: clean },
      }
      await store.upsertClip(next)
      updated.push(next)
    }
    log.write('biblioteca', `etiquetados ${updated.length} clips como ${clean ?? 'sin juego'}`)
    return updated
  })

  ipcMain.handle('clips:list', async () => {
    await adoptOrphans().catch((err) => log.write('biblioteca', `adopcion fallo: ${err && err.message}`))
    return store.listClips()
  })
  ipcMain.handle('clips:disk-usage', () => store.diskUsage())

  // Scrubbing strip for the player timeline. Built once per clip, then cached.
  ipcMain.handle('clips:filmstrip', async (_e, id, frames) => {
    const clip = await store.getClip(id)
    if (!clip) return null
    const clipsDir = await store.getClipsDir()
    const name = `${clip.id}-strip.jpg`
    const outPath = path.join(clipsDir, '.thumbs', name)
    const count = Math.max(4, Math.min(40, Number(frames) || 14))
    try {
      const stat = await fs.stat(outPath).catch(() => null)
      const clipStat = await fs.stat(path.join(clipsDir, clip.fileName))
      // Rebuild if missing or older than the clip (an in-place trim changes it).
      if (!stat || stat.mtimeMs < clipStat.mtimeMs) {
        await ffmpeg.filmstrip(path.join(clipsDir, clip.fileName), outPath, clip.durationSec, count)
      }
      return { url: `clip://thumbs/${encodeURIComponent(name)}?v=${clipStat.mtimeMs}`, frames: count }
    } catch (err) {
      log.write('filmstrip', `fallo para ${clip.fileName}: ${err && err.message}`)
      return null
    }
  })

  /**
   * Hover previews play a small cached copy (see ffmpeg.previewProxy). Until it
   * exists the original is returned so the tile still plays, and the copy is
   * queued; the next hover picks it up.
   */
  ipcMain.handle('clips:preview', async (_e, id) => {
    const clip = await store.getClip(id)
    if (!clip) return null
    const clipsDir = await store.getClipsDir()
    const original = `clip://local/${encodeURIComponent(clip.fileName)}`
    const state = await previewState(clip, clipsDir)
    if (state.fresh) return `clip://thumbs/${encodeURIComponent(state.name)}?v=${state.version}`
    queuePreview(clip.id)
    return original
  })

  /** Everything a freshly written clip needs before it shows up in the library. */
  async function registerSavedClip({ id, clipsDir, fileName, displayName, createdAt, durationSec, source, format, micFile, note }) {
    const outPath = path.join(clipsDir, fileName)
    const thumbnail = await ffmpeg.thumbnail(outPath, path.join(clipsDir, '.thumbs', `${id}.jpg`)).catch(() => null)
    const stat = await fs.stat(outPath)
    const meta = {
      id,
      fileName,
      title: clipTitle(displayName, createdAt),
      // Kept separate from `title` so trims can rebuild a name without stacking
      // one date on top of another.
      displayName,
      createdAt: createdAt.toISOString(),
      durationSec,
      source,
      sizeBytes: stat.size,
      thumbnail: thumbnail ? `${id}.jpg` : null,
      format,
      micFile,
      mix: { game: 1, mic: 1, gameMuted: false, micMuted: false },
    }
    await store.upsertClip(meta)

    const removed = await store.enforceDiskLimit().catch(() => 0)
    if (removed) send('clips:pruned', removed)

    // Build the hover preview now, in the background, so the first hover is smooth.
    queuePreview(id)

    log.write(
      'clip',
      `guardado ${fileName} (${durationSec}s, ${(stat.size / 1048576).toFixed(1)} MB${micFile ? ', con mic' : ''}${note ? `, ${note}` : ''})`,
    )
    return meta
  }

  const newClipId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  /** Writes a renderer-recorded audio layer to a temp file and returns its path. */
  async function writeLayer(dir, name, layer) {
    const ext = layer.container === 'mkv' ? 'mkv' : 'webm'
    const file = path.join(dir, `${name}.${ext}`)
    await fs.writeFile(file, Buffer.concat(layer.parts.map((p) => Buffer.from(p))))
    return file
  }

  // --- native (ffmpeg) screen recording --------------------------------------

  ipcMain.handle('native:available', () => native.available().catch(() => false))

  ipcMain.handle('native:start', async (_e, sessionId, opts) => {
    try {
      const info = await native.start(sessionId, opts)
      return { ok: true, ...info }
    } catch (err) {
      log.write('nativo', `${sessionId}: no arrancó (${err && err.message}); se usa la captura de Chromium`)
      return { ok: false, error: String((err && err.message) || err) }
    }
  })

  ipcMain.handle('native:stop', (_e, sessionId) => native.stop(sessionId))

  /**
   * Saves a clip from a native ring. `endWall` is the moment the key was pressed;
   * the system audio and the mic arrive as complete recordings that started at
   * `startWall`, so all three are cut on the same clock.
   */
  ipcMain.handle('native:save', async (_e, payload) => {
    const clipsDir = await store.getClipsDir()
    const id = newClipId()
    const createdAt = new Date(payload.endWall)
    const displayName = clipDisplayName(payload.source)
    const fileName = uniqueClipName(clipsDir, displayName, createdAt, 'mp4')
    const micName = fileName.replace(/\.[^.]+$/, '') + '.mic.m4a'
    savingFiles.add(fileName)
    try {
      return await withTemp(async (dir) => {
        const videoTs = path.join(dir, 'video.ts')
        const cut = await native.cut(payload.sessionId, payload.endWall, payload.durationSec, videoTs)

        let audio = null
        if (payload.audio && payload.audio.parts && payload.audio.parts.length) {
          const file = await writeLayer(dir, 'system', payload.audio)
          audio = { file, rel: (cut.startWall - payload.audio.startWall) / 1000 }
        }
        await ffmpeg.muxNative({ videoTs, vRel: cut.vRel, dur: cut.dur, audio, outPath: path.join(clipsDir, fileName) })

        let micFile = null
        if (payload.mic && payload.mic.parts && payload.mic.parts.length) {
          try {
            const file = await writeLayer(dir, 'mic', payload.mic)
            await ffmpeg.cutAudioLayer({
              file,
              rel: (cut.startWall - payload.mic.startWall) / 1000,
              dur: cut.dur,
              outPath: path.join(clipsDir, micName),
            })
            micFile = micName
          } catch (err) {
            log.write('clip', `no se pudo guardar la pista de microfono: ${err && err.message}`)
          }
        }

        return registerSavedClip({
          id,
          clipsDir,
          fileName,
          displayName,
          createdAt,
          durationSec: Math.round(cut.dur),
          source: payload.source,
          format: 'mp4',
          micFile,
          note: `nativo, ${Date.now() - payload.endWall}ms`,
        })
      })
    } finally {
      savingFiles.delete(fileName)
    }
  })

  ipcMain.handle('clips:save', async (_e, payload) => {
    const clipsDir = await store.getClipsDir()
    const id = newClipId()

    // H.264 arrives in Matroska and remuxes straight into MP4; VP9 stays WebM.
    const inputExt = payload.container === 'mkv' ? 'mkv' : 'webm'
    const format = payload.container === 'mkv' ? 'mp4' : 'webm'
    const createdAt = new Date()
    const displayName = clipDisplayName(payload.source)
    const fileName = uniqueClipName(clipsDir, displayName, createdAt, format)
    const outPath = path.join(clipsDir, fileName)
    savingFiles.add(fileName)

    try {
      if (payload.continuous) {
        await ffmpeg.concatRaw(payload.parts, payload.trimStartSec, outPath, inputExt)
      } else {
        await ffmpeg.concatAndTrim(payload.parts, payload.trimStartSec, outPath, inputExt)
      }

      // Microphone, if any, lands beside the clip as its own editable layer.
      let micFile = null
      if (payload.mic && payload.mic.parts && payload.mic.parts.length) {
        const micName = fileName.replace(/\.[^.]+$/, '') + '.mic.m4a'
        try {
          if (payload.mic.startWall && payload.endWall) {
            // Complete recording with a known start: cut on the clock.
            await withTemp(async (dir) => {
              const file = await writeLayer(dir, 'mic', payload.mic)
              const dur = payload.durationSec
              await ffmpeg.cutAudioLayer({
                file,
                rel: (payload.endWall - dur * 1000 - payload.mic.startWall) / 1000,
                dur,
                outPath: path.join(clipsDir, micName),
              })
            })
          } else {
            const micExt = payload.mic.container === 'mkv' ? 'mkv' : 'webm'
            if (payload.mic.continuous) {
              await ffmpeg.concatRaw(payload.mic.parts, payload.mic.trimStartSec, path.join(clipsDir, micName), micExt, true)
            } else {
              await ffmpeg.concatAudio(payload.mic.parts, payload.mic.trimStartSec, path.join(clipsDir, micName), micExt)
            }
            const delay = await ffmpeg.alignAudioToVideo(outPath, path.join(clipsDir, micName))
            if (delay) log.write('clip', `pista de microfono alineada +${delay}ms`)
          }
          micFile = micName
        } catch (err) {
          log.write('clip', `no se pudo guardar la pista de microfono: ${err && err.message}`)
        }
      }

      return await registerSavedClip({
        id,
        clipsDir,
        fileName,
        displayName,
        createdAt,
        durationSec: payload.durationSec,
        source: payload.source,
        format,
        micFile,
        note: 'chromium',
      })
    } finally {
      savingFiles.delete(fileName)
    }
  })

  ipcMain.handle('clips:delete', async (_e, id) => {
    const clipsDir = await store.getClipsDir()
    const clip = await store.getClip(id)
    if (clip) {
      // Recycle Bin rather than unlink: deleting a clip by accident should be undoable.
      const full = path.join(clipsDir, clip.fileName)
      await shell.trashItem(full).catch(() => fs.rm(full, { force: true }))
      if (clip.micFile) {
        const micPath = path.join(clipsDir, clip.micFile)
        await shell.trashItem(micPath).catch(() => fs.rm(micPath, { force: true }))
      }
      if (clip.thumbnail) await fs.rm(path.join(clipsDir, '.thumbs', clip.thumbnail), { force: true })
      await fs.rm(path.join(clipsDir, '.thumbs', `${clip.id}-strip.jpg`), { force: true })
      await fs.rm(path.join(clipsDir, '.thumbs', previewName(clip.id)), { force: true })
    }
    await store.removeClip(id)
  })

  ipcMain.handle('clips:set-mix', async (_e, id, mix) => {
    const clip = await store.getClip(id)
    if (!clip) return null
    const updated = { ...clip, mix }
    await store.upsertClip(updated)
    // The preview carries the mix, so it is stale now.
    await fs.rm(path.join(await store.getClipsDir(), '.thumbs', previewName(id)), { force: true }).catch(() => {})
    queuePreview(id)
    return updated
  })

  /**
   * Renames the file on disk, keeping its extension. The microphone sidecar is
   * named after the clip, so it has to move too or the second audio layer is lost.
   */
  ipcMain.handle('clips:rename-file', async (_e, id, baseName) => {
    const clip = await store.getClip(id)
    if (!clip) throw new Error('Clip not found')

    const clipsDir = await store.getClipsDir()
    const ext = path.extname(clip.fileName)
    const clean = sanitizeUserFileName(baseName)
    if (!clean) throw new Error('empty-name')
    if (clean + ext === clip.fileName) return clip

    let fileName = clean + ext
    let n = 2
    while (fs_sync.existsSync(path.join(clipsDir, fileName))) {
      fileName = `${clean} (${n})${ext}`
      n++
    }

    await fs.rename(path.join(clipsDir, clip.fileName), path.join(clipsDir, fileName))

    let micFile = clip.micFile
    if (micFile) {
      const newMic = fileName.replace(/\.[^.]+$/, '') + '.mic.m4a'
      await fs.rename(path.join(clipsDir, micFile), path.join(clipsDir, newMic)).catch(() => {})
      micFile = newMic
    }

    const updated = { ...clip, fileName, micFile }
    await store.upsertClip(updated)
    log.write('biblioteca', `renombrado ${clip.fileName} -> ${fileName}`)
    return updated
  })

  ipcMain.handle('shots:rename-file', async (_e, id, baseName) => {
    const shot = await store.getShot(id)
    if (!shot) throw new Error('Screenshot not found')

    const dir = path.join(await store.getClipsDir(), 'Capturas')
    const ext = path.extname(shot.fileName)
    const clean = sanitizeUserFileName(baseName)
    if (!clean) throw new Error('empty-name')
    if (clean + ext === shot.fileName) return shot

    let fileName = clean + ext
    let n = 2
    while (fs_sync.existsSync(path.join(dir, fileName))) {
      fileName = `${clean} (${n})${ext}`
      n++
    }

    await fs.rename(path.join(dir, shot.fileName), path.join(dir, fileName))
    const updated = { ...shot, fileName }
    await store.upsertShot(updated)
    log.write('biblioteca', `renombrado ${shot.fileName} -> ${fileName}`)
    return updated
  })

  ipcMain.handle('clips:rename', async (_e, id, title) => {
    const clip = await store.getClip(id)
    if (!clip) throw new Error('Clip not found')
    const updated = { ...clip, title }
    await store.upsertClip(updated)
    return updated
  })

  ipcMain.handle('clips:trim', async (_e, { id, startSec, endSec, mode }) => {
    const clipsDir = await store.getClipsDir()
    const clip = await store.getClip(id)
    if (!clip) throw new Error('Clip not found')
    const input = path.join(clipsDir, clip.fileName)
    const ext = path.extname(clip.fileName) || '.webm'
    const durationSec = Math.round((endSec - startSec) * 10) / 10

    const micPath = clip.micFile ? path.join(clipsDir, clip.micFile) : null
    const needsMix = Boolean(micPath) || !ffmpeg.isDefaultMix(clip.mix)
    const cut = async (out) => {
      // With a second layer (or non-default levels) the trim also renders the mix,
      // so what you hear in the editor is what the file ends up containing.
      if (needsMix) await ffmpeg.renderMix(input, micPath, clip.mix, out, { startSec, endSec, video: 'encode' })
      else await ffmpeg.trim(input, startSec, endSec, out)
    }

    if (mode === 'overwrite') {
      const tmp = path.join(clipsDir, `${clip.id}.trim${ext}`)
      await cut(tmp)
      await fs.rename(tmp, input)
      const thumbnail = await ffmpeg.thumbnail(input, path.join(clipsDir, '.thumbs', `${clip.id}.jpg`)).catch(() => null)
      const stat = await fs.stat(input)
      // Measure the result instead of trusting end-start: a range that runs past
      // the end of the source produces a shorter file than the arithmetic says.
      const realDur = await ffmpeg.probeDuration(input).catch(() => null)
      // The levels are now baked into the file, so the layers are gone.
      if (needsMix && clip.micFile) {
        const old = path.join(clipsDir, clip.micFile)
        await shell.trashItem(old).catch(() => fs.rm(old, { force: true }))
      }
      const updated = {
        ...clip,
        durationSec: realDur ? Math.round(realDur) : Math.round(durationSec),
        sizeBytes: stat.size,
        thumbnail: thumbnail ? `${clip.id}.jpg` : null,
        micFile: needsMix ? null : clip.micFile,
        mix: { game: 1, mic: 1, gameMuted: false, micMuted: false },
      }
      await store.upsertClip(updated)
      return updated
    }

    const newId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const newDate = new Date()
    // Base the name on the clean display name, never on the dated title.
    const baseName = clip.displayName || clipDisplayName(clip.source)
    const fileName = uniqueClipName(clipsDir, `${baseName}-recorte`, newDate, ext.replace('.', ''))
    const output = path.join(clipsDir, fileName)
    await cut(output)
    const thumbnail = await ffmpeg.thumbnail(output, path.join(clipsDir, '.thumbs', `${newId}.jpg`)).catch(() => null)
    const stat = await fs.stat(output)
    const realDurNew = await ffmpeg.probeDuration(output).catch(() => null)
    const meta = {
      ...clip,
      id: newId,
      fileName,
      displayName: `${baseName} (recorte)`,
      title: clipTitle(`${baseName} (recorte)`, newDate),
      createdAt: newDate.toISOString(),
      durationSec: realDurNew ? Math.round(realDurNew) : Math.round(durationSec),
      sizeBytes: stat.size,
      thumbnail: thumbnail ? `${newId}.jpg` : null,
      micFile: needsMix ? null : clip.micFile,
      mix: { game: 1, mic: 1, gameMuted: false, micMuted: false },
    }
    await store.upsertClip(meta)
    return meta
  })

  ipcMain.handle('clips:choose-dir', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const dir = result.filePaths[0]
    const settings = await store.getSettings()
    await store.saveSettings({ ...settings, clipsDir: dir })
    return dir
  })

  ipcMain.handle('clips:open-dir', async () => shell.openPath(await store.getClipsDir()))

  /**
   * Puts the real file on the clipboard (CF_HDROP), so it can be pasted straight
   * into Discord or a folder. Electron's clipboard cannot express that format,
   * hence the one-shot PowerShell call.
   */
  ipcMain.handle('clips:copy-file', async (_e, id) => {
    const clip = await store.getClip(id)
    if (!clip) return false
    const full = path.join(await store.getClipsDir(), clip.fileName)

    if (process.platform !== 'win32') {
      clipboard.writeText(full)
      return true
    }

    return new Promise((resolve) => {
      // -Command does not bind $args, so the path is embedded with PowerShell
      // quoting rules ('' escapes a single quote inside a literal string).
      const psPath = path.normalize(full).replace(/'/g, "''")
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath '${psPath}'`],
        { windowsHide: true, timeout: 8000 },
        (err) => {
          if (err) {
            log.write('clip', `copiar al portapapeles fallo: ${err.message}`)
            clipboard.writeText(full) // al menos que quede la ruta
            return resolve(false)
          }
          resolve(true)
        },
      )
    })
  })

  ipcMain.handle('clips:show', async (_e, id) => {
    const clip = await store.getClip(id)
    if (clip) shell.showItemInFolder(path.join(await store.getClipsDir(), clip.fileName))
  })

  ipcMain.handle('clips:export', async (_e, id, format) => {
    const clip = await store.getClip(id)
    if (!clip) return
    const clipsDir = await store.getClipsDir()
    const input = path.join(clipsDir, clip.fileName)
    const currentExt = (path.extname(clip.fileName) || '.webm').slice(1)
    const targetExt = format === 'mp4' ? 'mp4' : currentExt

    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${clip.title.replace(/[^\w\- ]+/g, '')}.${targetExt}`,
      filters: [
        targetExt === 'mp4'
          ? { name: 'MP4 video', extensions: ['mp4'] }
          : { name: 'WebM video', extensions: ['webm'] },
      ],
    })
    if (result.canceled || !result.filePath) return

    const micPath = clip.micFile ? path.join(clipsDir, clip.micFile) : null
    if (micPath || !ffmpeg.isDefaultMix(clip.mix)) {
      // Video is copied, only the audio is rendered, so this stays fast.
      await ffmpeg.renderMix(input, micPath, clip.mix, result.filePath, { video: 'copy' })
    } else if (targetExt === 'mp4' && currentExt !== 'mp4') {
      await ffmpeg.toMp4(input, result.filePath)
    } else {
      await fs.copyFile(input, result.filePath)
    }
  })

  ipcMain.handle('hotkeys:register', (_e, hotkeys) => registerHotkeys(hotkeys))

  ipcMain.handle('shots:take', async (_e, action, sessionId) => {
    const res = await takeScreenshot(action || 'shot', sessionId)
    send('shot:done', res)
    return res
  })
  ipcMain.handle('shots:list', async () => {
    await adoptOrphans().catch(() => {})
    return store.listShots()
  })

  ipcMain.handle('shots:delete', async (_e, id) => {
    const shot = await store.getShot(id)
    if (shot) {
      const clipsDir = await store.getClipsDir()
      const full = path.join(clipsDir, 'Capturas', shot.fileName)
      await shell.trashItem(full).catch(() => fs.rm(full, { force: true }))
      if (shot.thumbnail) await fs.rm(path.join(clipsDir, '.thumbs', shot.thumbnail), { force: true })
    }
    await store.removeShot(id)
  })

  ipcMain.handle('shots:rename', async (_e, id, title) => {
    const shot = await store.getShot(id)
    if (!shot) throw new Error('Screenshot not found')
    const updated = { ...shot, title }
    await store.upsertShot(updated)
    return updated
  })

  ipcMain.handle('shots:show', async (_e, id) => {
    const shot = await store.getShot(id)
    if (shot) shell.showItemInFolder(path.join(await store.getClipsDir(), 'Capturas', shot.fileName))
  })

  ipcMain.handle('shots:copy', async (_e, id) => {
    const shot = await store.getShot(id)
    if (!shot) return false
    const full = path.join(await store.getClipsDir(), 'Capturas', shot.fileName)
    try {
      const png = await fs.readFile(full)
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
      return true
    } catch (err) {
      log.write('captura', `no se pudo copiar: ${err && err.message}`)
      return false
    }
  })

  ipcMain.handle('shots:export', async (_e, id) => {
    const shot = await store.getShot(id)
    if (!shot) return
    const full = path.join(await store.getClipsDir(), 'Capturas', shot.fileName)
    const result = await dialog.showSaveDialog(win, {
      defaultPath: shot.fileName,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    if (!result.canceled && result.filePath) await fs.copyFile(full, result.filePath)
  })
  ipcMain.handle('shots:open-dir', async () => {
    const dir = path.join(await store.getClipsDir(), 'Capturas')
    await fs.mkdir(dir, { recursive: true })
    return shell.openPath(dir)
  })

  /** Copies a chosen audio file into the app so it cannot go missing later. */
  ipcMain.handle('sounds:pick', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null

    const source = result.filePaths[0]
    const soundsDir = path.join(app.getPath('userData'), 'sounds')
    await fs.mkdir(soundsDir, { recursive: true })
    const name = `${Date.now().toString(36)}${path.extname(source).toLowerCase()}`
    await fs.copyFile(source, path.join(soundsDir, name))
    return { file: name, original: path.basename(source) }
  })

  ipcMain.handle('sounds:clear', async (_e, file) => {
    if (!file) return
    const full = path.join(app.getPath('userData'), 'sounds', file)
    await fs.rm(full, { force: true }).catch(() => {})
  })

  /** Quick option: pick a parent folder and create the clips folder inside it. */
  ipcMain.handle('clips:create-dir', async (_e, folderName) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const dir = path.join(result.filePaths[0], folderName || 'Clipper')
    await fs.mkdir(dir, { recursive: true })
    const settings = await store.getSettings()
    await store.saveSettings({ ...settings, clipsDir: dir })
    return dir
  })
  ipcMain.handle('log:write', (_e, tag, message) => log.write(String(tag), String(message)))
  ipcMain.handle('log:path', () => log.logPath())
  ipcMain.handle('log:open', () => shell.showItemInFolder(log.logPath()))
  ipcMain.handle('tray:state', (_e, recording, label) => setTrayState(Boolean(recording), label))

  // Right-click actions on a clip card.
  ipcMain.handle('clips:menu', async (_e, id) => {
    const clip = await store.getClip(id)
    if (!clip) return null
    const clipsDir = await store.getClipsDir()
    const full = path.join(clipsDir, clip.fileName)
    return new Promise((resolve) => {
      const menu = Menu.buildFromTemplate([
        { label: MENU_TEXT.reveal, click: () => { shell.showItemInFolder(full); resolve('reveal') } },
        { label: MENU_TEXT.play, click: () => { shell.openPath(full); resolve('play') } },
        { type: 'separator' },
        { label: MENU_TEXT.copyName, click: () => { clipboard.writeText(clip.fileName); resolve('copy') } },
        { type: 'separator' },
        { label: MENU_TEXT.delete, click: () => resolve('delete') },
      ])
      menu.popup({ window: win, callback: () => resolve(null) })
    })
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // A second launch is normally the user asking for the window. One carrying
  // --hidden is another autostart entry firing at logon, and showing the window
  // for it is exactly how "start minimised" ended up opening the app anyway.
  app.on('second-instance', (_e, argv) => {
    if (Array.isArray(argv) && argv.includes('--hidden')) {
      log.write('inicio', 'segunda instancia con --hidden ignorada')
      return
    }
    showWindow()
  })

  app.whenReady().then(async () => {
    registerProtocols()
    setupDisplayMediaHandler()
    registerIpc()
    await store.ensureDirs()
    const startupSettings = await store.getSettings()
    applyLoginItem(startupSettings)
    log.write(
      'inicio',
      `Clipper ${app.getVersion()} | sesiones=${startupSettings.sessions.length} ` +
        `(autoArm: ${startupSettings.sessions.map((x) => `${x.name}=${x.autoArm}`).join(', ')}) ` +
        `| teclas=${startupSettings.hotkeys.map((h) => h.accelerator).join(', ')}`,
    )
    await createWindow()
    await createTray()
    watchHotkeys()

    void native.cleanStale()
    // A monitor plugged, unplugged or changing resolution reshuffles the DXGI
    // outputs; the next arm has to look them up again.
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, () => native.invalidateOutputs())
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })

  let nativeStopped = false
  app.on('before-quit', (e) => {
    quitting = true
    globalShortcut.unregisterAll()
    shutdownForeground()
    // ffmpeg has to be told to stop, or it keeps writing to the temp folder
    // after we are gone. Hold the quit until it has.
    if (!nativeStopped) {
      e.preventDefault()
      nativeStopped = true
      native.stopAll().finally(() => app.quit())
    }
  })

  app.on('window-all-closed', () => {
    // Keep running in the tray.
  })
}
