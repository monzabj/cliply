export type SourceType = 'screen' | 'window'

export interface CaptureSource {
  id: string
  name: string
  type: SourceType
  thumbnail?: string | null
  appIcon?: string | null
}

export interface Hotkey {
  id: string
  accelerator: string
  durationSec: number
  isDefault?: boolean
}

export interface Settings {
  hotkeys: Hotkey[]
  clipsDir: string | null
  fps: 30 | 60
  videoBitrateMbps: number
  captureSystemAudio: boolean
  captureMic: boolean
  lastSourceId: string | null
  autoArmOnLaunch: boolean
}

export interface ClipSource {
  type: SourceType
  name: string
  app?: string | null
}

export interface ClipMeta {
  id: string
  fileName: string
  title: string
  createdAt: string
  durationSec: number
  source: ClipSource
  sizeBytes: number
  thumbnail?: string | null
}

export interface SaveClipPayload {
  parts: ArrayBuffer[]
  mimeType: string
  trimStartSec: number
  durationSec: number
  source: ClipSource
  title: string
}

export type TrimMode = 'overwrite' | 'new'

export interface TrimPayload {
  id: string
  startSec: number
  endSec: number
  mode: TrimMode
}

export const DEFAULT_HOTKEY: Hotkey = {
  id: 'default-30',
  accelerator: 'F8',
  durationSec: 30,
  isDefault: true,
}

export const DEFAULT_SETTINGS: Settings = {
  hotkeys: [DEFAULT_HOTKEY],
  clipsDir: null,
  fps: 60,
  videoBitrateMbps: 12,
  captureSystemAudio: true,
  captureMic: false,
  lastSourceId: null,
  autoArmOnLaunch: false,
}

export const DURATION_OPTIONS = [10, 15, 30, 45, 60, 90, 120, 180, 300]

export const SEGMENT_SEC = 5
