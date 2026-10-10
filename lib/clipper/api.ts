import type {
  AudioMix,
  CaptureSource,
  ClipFormat,
  ClipMeta,
  Hotkey,
  MedalProgress,
  MedalResult,
  MedalScan,
  NativeSavePayload,
  NativeStartOptions,
  SaveClipPayload,
  Settings,
  ShotMeta,
  SourceRef,
  TrimPayload,
  UpdateState,
} from './types'

export interface ShotResult {
  ok: boolean
  copied?: boolean
  saved?: boolean
  fileName?: string
  path?: string
  width?: number
  height?: number
  reason?: string
}

export interface ClipperAPI {
  readonly isDesktop: boolean
  readonly platform: string

  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>

  getSources(): Promise<CaptureSource[]>
  /**
   * Re-finds a persisted source. Returns null when it is genuinely gone, so the
   * caller can tell the user instead of quietly capturing a different screen.
   */
  resolveSource(ref: SourceRef): Promise<CaptureSource | null>
  selectSource(source: CaptureSource | null): Promise<void>
  getForegroundWindow(): Promise<string | null>

  listClips(): Promise<ClipMeta[]>
  saveClip(payload: SaveClipPayload): Promise<ClipMeta>
  deleteClip(id: string): Promise<void>
  renameClip(id: string, title: string): Promise<ClipMeta>
  /** Renames the file on disk. The extension is not the caller's to change. */
  renameClipFile(id: string, baseName: string): Promise<ClipMeta>
  trimClip(payload: TrimPayload): Promise<ClipMeta>
  /** Remembers the per-layer levels so they survive reopening the clip. */
  setMix(id: string, mix: AudioMix): Promise<ClipMeta | null>
  /** Playable URL for the separate microphone layer, when the clip has one. */
  getMicUrl(clip: ClipMeta): string | null
  getClipUrl(clip: ClipMeta): Promise<string>
  releaseClipUrl(url: string): void
  getThumbnailUrl(clip: ClipMeta): string | null

  chooseClipsDir(): Promise<string | null>
  openClipsDir(): Promise<void>
  showClipInFolder(id: string): Promise<void>
  exportClip(id: string, format?: ClipFormat): Promise<void>
  /** Puts the file itself on the clipboard, ready to paste into Discord. */
  copyClipFile(id: string): Promise<boolean>
  getDiskUsage(): Promise<number>

  registerHotkeys(hotkeys: Hotkey[]): Promise<{ failed: string[] }>
  onHotkey(cb: (hotkey: Hotkey) => void): () => void

  /** Fires the instant a screenshot key is pressed, before the capture runs. */
  onShotStarted(cb: (hotkey: Hotkey) => void): () => void
  onShotDone(cb: (result: ShotResult) => void): () => void
  takeShot(action: 'shot' | 'shot-copy', sessionId?: string | null): Promise<ShotResult>
  openShotsDir(): Promise<void>

  listShots(): Promise<ShotMeta[]>
  deleteShot(id: string): Promise<void>
  renameShot(id: string, title: string): Promise<ShotMeta>
  renameShotFile(id: string, baseName: string): Promise<ShotMeta>
  showShotInFolder(id: string): Promise<void>
  copyShotFile(id: string): Promise<boolean>
  exportShot(id: string): Promise<void>
  getShotUrl(shot: ShotMeta): string
  getShotThumbUrl(shot: ShotMeta): string | null

  /** Copies a chosen audio file into the app; returns the stored name. */
  pickSound(): Promise<{ file: string; original: string } | null>
  clearSound(file: string | null): Promise<void>
  soundUrl(file: string | null, fallback: string): string
  createClipsDir(folderName?: string): Promise<string | null>

  /** Appends a line to the on-disk log, for diagnosing things you cannot see mid-game. */
  log(tag: string, message: string): void
  openLog(): Promise<void>

  /** Cached strip of evenly spaced frames used as the scrub timeline. */
  getFilmstrip(id: string, frames?: number): Promise<{ url: string; frames: number } | null>
  /** Native right-click menu for a clip. Resolves with the action the user picked. */
  clipMenu(id: string): Promise<'reveal' | 'play' | 'copy' | 'delete' | null>
  setTrayState(recording: boolean, label?: string): void

  /**
   * Small cached copy for hover previews. Falls back to the clip itself until
   * the copy has been built.
   */
  getPreviewUrl(clip: ClipMeta): Promise<string | null>

  // --- native screen recording (ffmpeg, outside Chromium) ---
  nativeAvailable(): Promise<boolean>
  nativeStart(
    sessionId: string,
    opts: NativeStartOptions,
  ): Promise<{ ok: true; encoder: string; outputIdx: number } | { ok: false; error: string }>
  nativeStop(sessionId: string): Promise<void>
  nativeSave(payload: NativeSavePayload): Promise<ClipMeta>

  // --- updates ---
  checkForUpdate(): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  installUpdate(): Promise<void>
  getUpdateState(): Promise<UpdateState>
  onUpdateState(cb: (state: UpdateState) => void): () => void

  // --- Medal import ---
  pickMedalFolders(): Promise<string[]>
  scanMedal(roots: string[]): Promise<MedalScan>
  importMedal(opts: { mode: 'copy' | 'move'; kinds: ('clip' | 'shot')[] }): Promise<MedalResult>
  cancelMedalImport(): Promise<void>
  resetMedalImport(): Promise<void>
  onMedalProgress(cb: (p: MedalProgress) => void): () => void
  /** Names the game of several clips at once (or clears it with null). */
  setClipsGame(ids: string[], game: string | null): Promise<ClipMeta[]>
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
