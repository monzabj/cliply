const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  session,
  protocol,
  net,
  dialog,
  shell,
  Notification,
  Tray,
  Menu,
  nativeImage,
} = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const store = require('./store')
const ffmpeg = require('./ffmpeg')
const { getForegroundWindow } = require('./foreground')

const DEV_URL = process.env.ELECTRON_RENDERER_URL
const isDev = Boolean(DEV_URL)

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

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#15161a',
    title: 'Clipper',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

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

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'public', 'icon-dark-32x32.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Clipper')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Clipper', click: () => win?.show() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', () => win?.show())
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
    const base = url.host === 'thumbs' ? path.join(clipsDir, '.thumbs') : clipsDir
    const filePath = path.join(base, name)
    if (!filePath.startsWith(base)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(filePath).toString(), { headers: request.headers })
  })
}

function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      const match = (selectedSource && sources.find((s) => s.id === selectedSource.id)) || sources[0]
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

async function registerHotkeys(hotkeys) {
  globalShortcut.unregisterAll()
  const failed = []
  for (const hk of hotkeys) {
    try {
      const ok = globalShortcut.register(hk.accelerator, () => send('hotkeys:pressed', hk))
      if (!ok) failed.push(hk.accelerator)
    } catch {
      failed.push(hk.accelerator)
    }
  }
  return { failed }
}

function registerIpc() {
  ipcMain.handle('settings:get', () => store.getSettings())
  ipcMain.handle('settings:save', (_e, settings) => store.saveSettings(settings))

  ipcMain.handle('sources:list', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith('screen') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }))
  })
  ipcMain.handle('sources:select', (_e, source) => {
    selectedSource = source
  })
  ipcMain.handle('system:foreground-window', () => getForegroundWindow())

  ipcMain.handle('clips:list', () => store.listClips())
  ipcMain.handle('clips:save', async (_e, payload) => {
    const clipsDir = await store.getClipsDir()
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const fileName = `${id}.webm`
    const outPath = path.join(clipsDir, fileName)
    await ffmpeg.concatAndTrim(payload.parts, payload.trimStartSec, outPath)
    const thumbnail = await ffmpeg.thumbnail(outPath, path.join(clipsDir, '.thumbs', `${id}.jpg`)).catch(() => null)
    const stat = await fs.stat(outPath)
    const meta = {
      id,
      fileName,
      title: payload.title,
      createdAt: new Date().toISOString(),
      durationSec: payload.durationSec,
      source: payload.source,
      sizeBytes: stat.size,
      thumbnail: thumbnail ? `${id}.jpg` : null,
    }
    await store.upsertClip(meta)
    if (Notification.isSupported()) {
      new Notification({ title: 'Clip saved', body: `${payload.durationSec}s · ${payload.title}`, silent: true }).show()
    }
    return meta
  })
  ipcMain.handle('clips:delete', async (_e, id) => {
    const clipsDir = await store.getClipsDir()
    const clip = await store.getClip(id)
    if (clip) {
      await fs.rm(path.join(clipsDir, clip.fileName), { force: true })
      if (clip.thumbnail) await fs.rm(path.join(clipsDir, '.thumbs', clip.thumbnail), { force: true })
    }
    await store.removeClip(id)
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
    const durationSec = Math.round((endSec - startSec) * 10) / 10

    if (mode === 'overwrite') {
      const tmp = path.join(clipsDir, `${clip.id}.trim.webm`)
      await ffmpeg.trim(input, startSec, endSec, tmp)
      await fs.rename(tmp, input)
      const thumbnail = await ffmpeg.thumbnail(input, path.join(clipsDir, '.thumbs', `${clip.id}.jpg`)).catch(() => null)
      const stat = await fs.stat(input)
      const updated = { ...clip, durationSec, sizeBytes: stat.size, thumbnail: thumbnail ? `${clip.id}.jpg` : null }
      await store.upsertClip(updated)
      return updated
    }

    const newId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const fileName = `${newId}.webm`
    const output = path.join(clipsDir, fileName)
    await ffmpeg.trim(input, startSec, endSec, output)
    const thumbnail = await ffmpeg.thumbnail(output, path.join(clipsDir, '.thumbs', `${newId}.jpg`)).catch(() => null)
    const stat = await fs.stat(output)
    const meta = {
      ...clip,
      id: newId,
      fileName,
      title: `${clip.title} (trim)`,
      createdAt: new Date().toISOString(),
      durationSec,
      sizeBytes: stat.size,
      thumbnail: thumbnail ? `${newId}.jpg` : null,
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
  ipcMain.handle('clips:show', async (_e, id) => {
    const clip = await store.getClip(id)
    if (clip) shell.showItemInFolder(path.join(await store.getClipsDir(), clip.fileName))
  })
  ipcMain.handle('clips:export', async (_e, id) => {
    const clip = await store.getClip(id)
    if (!clip) return
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${clip.title.replace(/[^\w\- ]+/g, '')}.webm`,
      filters: [{ name: 'WebM video', extensions: ['webm'] }],
    })
    if (!result.canceled && result.filePath) {
      await fs.copyFile(path.join(await store.getClipsDir(), clip.fileName), result.filePath)
    }
  })

  ipcMain.handle('hotkeys:register', (_e, hotkeys) => registerHotkeys(hotkeys))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => win?.show())

  app.whenReady().then(async () => {
    registerProtocols()
    setupDisplayMediaHandler()
    registerIpc()
    await store.ensureDirs()
    createWindow()
    createTray()
  })

  app.on('before-quit', () => {
    quitting = true
    globalShortcut.unregisterAll()
  })

  app.on('window-all-closed', () => {
    // Keep running in the tray.
  })
}
