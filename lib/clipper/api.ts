import type {
  CaptureSource,
  ClipMeta,
  Hotkey,
  SaveClipPayload,
  Settings,
  TrimPayload,
} from './types'

export interface ClipperAPI {
  readonly isDesktop: boolean
  readonly platform: string

  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>

  getSources(): Promise<CaptureSource[]>
  selectSource(source: CaptureSource | null): Promise<void>
  getForegroundWindow(): Promise<string | null>

  listClips(): Promise<ClipMeta[]>
  saveClip(payload: SaveClipPayload): Promise<ClipMeta>
  deleteClip(id: string): Promise<void>
  renameClip(id: string, title: string): Promise<ClipMeta>
  trimClip(payload: TrimPayload): Promise<ClipMeta>
  getClipUrl(clip: ClipMeta): Promise<string>
  releaseClipUrl(url: string): void
  getThumbnailUrl(clip: ClipMeta): string | null

  chooseClipsDir(): Promise<string | null>
  openClipsDir(): Promise<void>
  showClipInFolder(id: string): Promise<void>
  exportClip(id: string): Promise<void>

  registerHotkeys(hotkeys: Hotkey[]): Promise<{ failed: string[] }>
  onHotkey(cb: (hotkey: Hotkey) => void): () => void
}

/** Shape exposed on `window.clipper` by the Electron preload script. */
export interface DesktopBridge {
  platform: string
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  on(channel: string, cb: (...args: unknown[]) => void): () => void
}

declare global {
  interface Window {
    clipper?: DesktopBridge
  }
}

let cached: ClipperAPI | null = null

export async function getClipper(): Promise<ClipperAPI> {
  if (cached) return cached
  if (typeof window !== 'undefined' && window.clipper) {
    const { createDesktopAPI } = await import('./desktop-api')
    cached = createDesktopAPI(window.clipper)
  } else {
    const { createWebAPI } = await import('./web-api')
    cached = createWebAPI()
  }
  return cached
}
