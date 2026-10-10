export type SourceType = 'screen' | 'window'

export interface CaptureSource {
  id: string
  name: string
  type: SourceType
  thumbnail?: string | null
  appIcon?: string | null
  /** Stable across reboots and display hot-plug; only present for screens. */
  displayId?: string | null
  width?: number | null
  height?: number | null
}

/**
 * A persisted pointer to a capture source. `id` goes stale whenever Windows
 * renumbers displays (adding a monitor, a virtual display driver waking up), so
 * matching falls back to displayId, then name + resolution. See resolveSource.
 */
export interface SourceRef {
  id: string
  name: string
  type: SourceType
  displayId?: string | null
  width?: number | null
  height?: number | null
}

export interface SessionConfig {
  id: string
  name: string
  source: SourceRef | null
  /** Arm this session automatically when the app starts. */
  autoArm: boolean
}

/**
 * What a key does. 'shot' writes a PNG (and copies it when configured);
 * 'shot-copy' never touches the disk, it only fills the clipboard.
 */
export type HotkeyAction = 'clip' | 'shot' | 'shot-copy'

export interface Hotkey {
  id: string
  accelerator: string
  action: HotkeyAction
  /** Only meaningful for 'clip'. */
  durationSec: number
  /** Which session the action applies to; null means every one at once. */
  sessionId: string | null
  isDefault?: boolean
  /** Wall-clock ms the key was pressed, stamped by the main process. */
  pressedAt?: number
}

export type Language = 'auto' | 'es' | 'en'
export type Codec = 'auto' | 'h264' | 'vp9'
export type ClipFormat = 'mp4' | 'webm'

export interface Settings {
  hotkeys: Hotkey[]
  sessions: SessionConfig[]
  clipsDir: string | null
  fps: 30 | 60
  videoBitrateMbps: number
  codec: Codec
  captureSystemAudio: boolean
  captureMic: boolean
  /** Empty means the system default input. */
  micDeviceId: string | null

  language: Language
  launchOnStartup: boolean
  startMinimized: boolean

  soundCue: boolean
  soundCueVolume: number
  /** Hover previews in the library play with sound. */
  previewSound: boolean

  /** Shutter sound when a screenshot is taken. */
  screenshotSound: boolean
  /** Screenshots also land on the clipboard, ready to paste. */
  screenshotCopy: boolean
  /**
   * File names inside the app's sounds folder. Null falls back to the built-in
   * tone; the chosen file is copied in, so moving the original never breaks it.
   */
  clipSoundFile: string | null
  screenshotSoundFile: string | null

  /** Delete the oldest clips once the folder exceeds this. 0 disables the cap. */
  diskLimitGB: number

  /** False until the first-run screen has been answered. */
  setupDone: boolean
  /** 'single' hides everything about recording more than one screen at once. */
  monitorSetup: 'single' | 'multi'
}

export interface ClipSource {
  type: SourceType
  name: string
  app?: string | null
  sessionName?: string | null
}

/** Per-layer playback levels, remembered with the clip. */
export interface AudioMix {
  game: number
  mic: number
  gameMuted: boolean
  micMuted: boolean
}

export const DEFAULT_MIX: AudioMix = { game: 1, mic: 1, gameMuted: false, micMuted: false }

export interface ClipMeta {
  id: string
  fileName: string
  title: string
  createdAt: string
  durationSec: number
  source: ClipSource
  sizeBytes: number
  thumbnail?: string | null
  format?: ClipFormat
  /** Clean name without the date, used to build file names for trims. */
  displayName?: string
  /** Sidecar file holding the microphone as its own editable layer. */
  micFile?: string | null
  mix?: AudioMix
}

export interface SaveClipPayload {
  parts: ArrayBuffer[]
  mimeType: string
  /** Container the browser recorded into — decides the temp file extension. */
  container: 'webm' | 'mkv'
  trimStartSec: number
  durationSec: number
  /** Parts are slices of one stream and must be glued byte for byte. */
  continuous: boolean
  source: ClipSource
  title: string
  /** Microphone recorded in parallel, kept as a separate layer rather than mixed in. */
  mic?: AudioLayer | null
  /** When the key was pressed; lets the main process cut the mic on the same clock. */
  endWall?: number
}

/**
 * A complete audio recording (header included) that began at `startWall`. The
 * main process cuts whatever window it needs from it by wall-clock time.
 */
export interface AudioLayer {
  parts: ArrayBuffer[]
  container: 'webm' | 'mkv'
  startWall?: number
  trimStartSec?: number
  continuous?: boolean
}

/** A clip cut from a session recorded by the native (ffmpeg) recorder. */
export interface NativeSavePayload {
  sessionId: string
  durationSec: number
  endWall: number
  source: ClipSource
  audio: AudioLayer | null
  mic: AudioLayer | null
}

export interface NativeStartOptions {
  displayId: string
  width: number
  height: number
  fps: number
  bitrateMbps: number
  maxSeconds: number
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'ready' | 'error' | 'unsupported'

export interface UpdateState {
  status: UpdateStatus
  version: string | null
  percent: number
  error: string | null
  current?: string
}

// --- Medal import --------------------------------------------------------------

export interface MedalSummary {
  total: number
  byKind: Record<string, number>
  bytes: number
  withDate: number
  withoutDate: number
  withThumb: number
  noGame: number
  games: { name: string; count: number }[]
  range: { from: string; to: string } | null
}

export interface MedalScan {
  sections: { kind: string; dir: string }[]
  summary: MedalSummary
  alreadyDone: number
}

export interface MedalProgress {
  phase: 'scan' | 'import' | 'done'
  done?: number
  total?: number
  current?: string
  imported?: number
  skipped?: number
  failed?: number
  scanned?: number
}

export interface MedalResult {
  imported: number
  skipped: number
  failed: number
  backup: string | null
  stopped?: boolean
}

export interface ShotMeta {
  id: string
  fileName: string
  /** Clean name without the date. */
  displayName?: string
  title: string
  createdAt: string
  sizeBytes: number
  width: number
  height: number
  thumbnail?: string | null
  source: { name: string; sessionName?: string | null; app?: string | null }
}

/** One row of the library: a clip or a still, told apart by `kind`. */
export type LibraryItem = ({ kind: 'clip' } & ClipMeta) | ({ kind: 'shot' } & ShotMeta)

export type TrimMode = 'overwrite' | 'new'

export interface TrimPayload {
  id: string
  startSec: number
  endSec: number
  mode: TrimMode
}

/** Why a session could not be armed — surfaced to the user instead of silently falling back. */
export type ArmFailure =
  | { kind: 'source-missing'; sessionId: string; sourceName: string }
  | { kind: 'no-source'; sessionId: string }
  | { kind: 'denied'; sessionId: string; message: string }

export const DEFAULT_SESSION_ID = 'main'

export const DEFAULT_HOTKEY: Hotkey = {
  id: 'default-30',
  accelerator: 'F8',
  action: 'clip',
  durationSec: 30,
  sessionId: DEFAULT_SESSION_ID,
  isDefault: true,
}

export const DEFAULT_SCREENSHOT_HOTKEY: Hotkey = {
  id: 'default-shot',
  accelerator: 'F7',
  action: 'shot',
  durationSec: 0,
  sessionId: DEFAULT_SESSION_ID,
}

export const DEFAULT_SESSION: SessionConfig = {
  id: DEFAULT_SESSION_ID,
  name: 'Monitor 1',
  source: null,
  // On by default: a hotkey that does nothing because nobody pressed "Start"
  // is the single most confusing way for this app to fail.
  autoArm: true,
}

export const DEFAULT_SETTINGS: Settings = {
  hotkeys: [DEFAULT_HOTKEY, DEFAULT_SCREENSHOT_HOTKEY],
  sessions: [DEFAULT_SESSION],
  clipsDir: null,
  fps: 60,
  videoBitrateMbps: 12,
  codec: 'auto',
  captureSystemAudio: true,
  // On: without it a clip has a single audio layer and the editor cannot balance
  // your voice against the game. The mic is always kept as a separate file.
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

export const DURATION_OPTIONS = [10, 15, 30, 45, 60, 90, 120, 180, 300]

export const SEGMENT_SEC = 5

export const MAX_SESSIONS = 4
