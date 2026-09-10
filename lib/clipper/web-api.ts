import type { ClipperAPI } from './api'
import { eventMatchesAccelerator } from './hotkeys'
import { DEFAULT_SETTINGS, type ClipMeta, type Hotkey, type Settings } from './types'

/**
 * Browser fallback used when the UI runs outside Electron (e.g. the v0 preview).
 * Clips live in IndexedDB, hotkeys only fire while the tab is focused, and trimming
 * re-records the selected range in real time since there is no ffmpeg available.
 */

const DB_NAME = 'clipper-web'
const STORE_CLIPS = 'clips'
const STORE_BLOBS = 'blobs'
const SETTINGS_KEY = 'clipper-web-settings'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_CLIPS)) db.createObjectStore(STORE_CLIPS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function readBlob(id: string): Promise<Blob | undefined> {
  return tx<Blob | undefined>(STORE_BLOBS, 'readonly', (s) => s.get(id))
}

async function writeClip(meta: ClipMeta, blob: Blob) {
  await tx(STORE_BLOBS, 'readwrite', (s) => s.put(blob, meta.id))
  await tx(STORE_CLIPS, 'readwrite', (s) => s.put(meta))
}

async function makeThumbnail(blob: Blob): Promise<string | null> {
  try {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    await new Promise<void>((res, rej) => {
      video.onloadeddata = () => res()
      video.onerror = () => rej(new Error('thumb load failed'))
    })
    video.currentTime = Math.min(1, (video.duration || 2) / 2)
    await new Promise<void>((res) => {
      video.onseeked = () => res()
    })
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = Math.round((480 * video.videoHeight) / video.videoWidth) || 270
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    return null
  }
}

async function reRecordRange(blob: Blob, startSec: number, endSec: number): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.src = url
  video.muted = false
  video.volume = 0
  await new Promise<void>((res) => (video.onloadedmetadata = () => res()))
  video.currentTime = startSec
  await new Promise<void>((res) => (video.onseeked = () => res()))

  const stream = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream()
  const recorder = new MediaRecorder(stream, { mimeType: blob.type || 'video/webm' })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<Blob>((res) => (recorder.onstop = () => res(new Blob(chunks, { type: recorder.mimeType }))))

  recorder.start()
  await video.play()
  await new Promise<void>((res) => {
    const check = () => {
      if (video.currentTime >= endSec || video.ended) res()
      else requestAnimationFrame(check)
    }
    check()
  })
  video.pause()
  recorder.stop()
  const out = await done
  URL.revokeObjectURL(url)
  return out
}

export function createWebAPI(): ClipperAPI {
  let hotkeys: Hotkey[] = []
  const listeners = new Set<(h: Hotkey) => void>()

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      const hit = hotkeys.find((h) => eventMatchesAccelerator(e, h.accelerator))
      if (hit) {
        e.preventDefault()
        listeners.forEach((cb) => cb(hit))
      }
    })
  }

  return {
    isDesktop: false,
    platform: 'web',

    async getSettings() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY)
        return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Settings) } : DEFAULT_SETTINGS
      } catch {
        return DEFAULT_SETTINGS
      }
    },
    async saveSettings(settings) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      return settings
    },

    async getSources() {
      return []
    },
    async selectSource() {},
    async getForegroundWindow() {
      return null
    },

    async listClips() {
      const clips = await tx<ClipMeta[]>(STORE_CLIPS, 'readonly', (s) => s.getAll())
      return clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async saveClip(payload) {
      const blob = new Blob(payload.parts, { type: payload.mimeType })
      const id = crypto.randomUUID()
      const createdAt = new Date().toISOString()
      const meta: ClipMeta = {
        id,
        fileName: `${id}.webm`,
        title: payload.title,
        createdAt,
        durationSec: payload.durationSec,
        source: payload.source,
        sizeBytes: blob.size,
        thumbnail: await makeThumbnail(blob),
      }
      await writeClip(meta, blob)
      return meta
    },

    async deleteClip(id) {
      await tx(STORE_BLOBS, 'readwrite', (s) => s.delete(id))
      await tx(STORE_CLIPS, 'readwrite', (s) => s.delete(id))
    },

    async renameClip(id, title) {
      const clip = await tx<ClipMeta>(STORE_CLIPS, 'readonly', (s) => s.get(id))
      const updated = { ...clip, title }
      await tx(STORE_CLIPS, 'readwrite', (s) => s.put(updated))
      return updated
    },

    async trimClip({ id, startSec, endSec, mode }) {
      const clip = await tx<ClipMeta>(STORE_CLIPS, 'readonly', (s) => s.get(id))
      const blob = await readBlob(id)
      if (!clip || !blob) throw new Error('Clip not found')
      const trimmed = await reRecordRange(blob, startSec, endSec)
      const durationSec = Math.round((endSec - startSec) * 10) / 10
      const thumbnail = await makeThumbnail(trimmed)

      if (mode === 'overwrite') {
        const updated: ClipMeta = { ...clip, durationSec, sizeBytes: trimmed.size, thumbnail }
        await writeClip(updated, trimmed)
        return updated
      }
      const newId = crypto.randomUUID()
      const meta: ClipMeta = {
        ...clip,
        id: newId,
        fileName: `${newId}.webm`,
        title: `${clip.title} (trim)`,
        createdAt: new Date().toISOString(),
        durationSec,
        sizeBytes: trimmed.size,
        thumbnail,
      }
      await writeClip(meta, trimmed)
      return meta
    },

    async getClipUrl(clip) {
      const blob = await readBlob(clip.id)
      if (!blob) throw new Error('Clip data missing')
      return URL.createObjectURL(blob)
    },
    releaseClipUrl(url) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    },
    getThumbnailUrl: (clip) => clip.thumbnail ?? null,

    async chooseClipsDir() {
      return null
    },
    async openClipsDir() {},
    async showClipInFolder() {},
    async exportClip(id) {
      const clip = await tx<ClipMeta>(STORE_CLIPS, 'readonly', (s) => s.get(id))
      const blob = await readBlob(id)
      if (!clip || !blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${clip.title.replace(/[^\w\- ]+/g, '')}.webm`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    },

    async registerHotkeys(next) {
      hotkeys = next
      return { failed: [] }
    },
    onHotkey(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}
