import type { ClipperAPI, DesktopBridge, ShotResult } from './api'
import type {
  CaptureSource,
  ClipFormat,
  ClipMeta,
  Hotkey,
  MedalProgress,
  MedalResult,
  MedalScan,
  SaveClipPayload,
  Settings,
  ShotMeta,
  SourceRef,
  TrimPayload,
  UpdateState,
} from './types'

export function createDesktopAPI(bridge: DesktopBridge): ClipperAPI {
  return {
    isDesktop: true,
    platform: bridge.platform,

    getSettings: () => bridge.invoke<Settings>('settings:get'),
    saveSettings: (settings) => bridge.invoke<Settings>('settings:save', settings),

    getSources: () => bridge.invoke<CaptureSource[]>('sources:list'),
    resolveSource: (ref: SourceRef) => bridge.invoke<CaptureSource | null>('sources:resolve', ref),
    selectSource: (source: CaptureSource | null) => bridge.invoke('sources:select', source),
    getForegroundWindow: () => bridge.invoke<string | null>('system:foreground-window'),

    listClips: () => bridge.invoke<ClipMeta[]>('clips:list'),
    saveClip: (payload: SaveClipPayload) => bridge.invoke<ClipMeta>('clips:save', payload),
    deleteClip: (id) => bridge.invoke('clips:delete', id),
    renameClip: (id, title) => bridge.invoke<ClipMeta>('clips:rename', id, title),
    renameClipFile: (id, baseName) => bridge.invoke<ClipMeta>('clips:rename-file', id, baseName),
    trimClip: (payload: TrimPayload) => bridge.invoke<ClipMeta>('clips:trim', payload),
    setMix: (id, mix) => bridge.invoke<ClipMeta | null>('clips:set-mix', id, mix),
    getMicUrl: (clip) => (clip.micFile ? `clip://local/${encodeURIComponent(clip.micFile)}` : null),
    getClipUrl: async (clip) => `clip://local/${encodeURIComponent(clip.fileName)}`,
    releaseClipUrl: () => {},
    getThumbnailUrl: (clip) =>
      clip.thumbnail ? `clip://thumbs/${encodeURIComponent(clip.thumbnail)}?v=${clip.sizeBytes}` : null,

    chooseClipsDir: () => bridge.invoke<string | null>('clips:choose-dir'),
    openClipsDir: () => bridge.invoke('clips:open-dir'),
    showClipInFolder: (id) => bridge.invoke('clips:show', id),
    exportClip: (id, format?: ClipFormat) => bridge.invoke('clips:export', id, format),
    copyClipFile: (id) => bridge.invoke<boolean>('clips:copy-file', id),
    getDiskUsage: () => bridge.invoke<number>('clips:disk-usage'),

    registerHotkeys: (hotkeys: Hotkey[]) => bridge.invoke<{ failed: string[] }>('hotkeys:register', hotkeys),
    onHotkey: (cb) => bridge.on('hotkeys:pressed', (hotkey) => cb(hotkey as Hotkey)),
    onShotStarted: (cb) => bridge.on('shot:started', (hotkey) => cb(hotkey as Hotkey)),
    onShotDone: (cb) => bridge.on('shot:done', (res) => cb(res as ShotResult)),
    takeShot: (action, sessionId) => bridge.invoke<ShotResult>('shots:take', action, sessionId),
    openShotsDir: () => bridge.invoke('shots:open-dir'),

    listShots: () => bridge.invoke<ShotMeta[]>('shots:list'),
    deleteShot: (id) => bridge.invoke('shots:delete', id),
    renameShot: (id, title) => bridge.invoke<ShotMeta>('shots:rename', id, title),
    renameShotFile: (id, baseName) => bridge.invoke<ShotMeta>('shots:rename-file', id, baseName),
    showShotInFolder: (id) => bridge.invoke('shots:show', id),
    copyShotFile: (id) => bridge.invoke<boolean>('shots:copy', id),
    exportShot: (id) => bridge.invoke('shots:export', id),
    getShotUrl: (shot) => `clip://shots/${encodeURIComponent(shot.fileName)}`,
    getShotThumbUrl: (shot) =>
      shot.thumbnail ? `clip://thumbs/${encodeURIComponent(shot.thumbnail)}?v=${shot.sizeBytes}` : null,

    pickSound: () => bridge.invoke<{ file: string; original: string } | null>('sounds:pick'),
    clearSound: (file) => bridge.invoke('sounds:clear', file),
    soundUrl: (file, fallback) => (file ? `clip://sound/${encodeURIComponent(file)}` : fallback),
    createClipsDir: (folderName) => bridge.invoke<string | null>('clips:create-dir', folderName),

    log: (tag, message) => void bridge.invoke('log:write', tag, message),
    openLog: () => bridge.invoke('log:open'),
    getFilmstrip: (id, frames) =>
      bridge.invoke<{ url: string; frames: number } | null>('clips:filmstrip', id, frames),
    clipMenu: (id) => bridge.invoke<'reveal' | 'play' | 'copy' | 'delete' | null>('clips:menu', id),
    setTrayState: (recording, label) => void bridge.invoke('tray:state', recording, label),
    getPreviewUrl: (clip) => bridge.invoke<string | null>('clips:preview', clip.id),

    nativeAvailable: () => bridge.invoke<boolean>('native:available'),
    nativeStart: (sessionId, opts) => bridge.invoke('native:start', sessionId, opts),
    nativeStop: (sessionId) => bridge.invoke('native:stop', sessionId),
    nativeSave: (payload) => bridge.invoke<ClipMeta>('native:save', payload),

    checkForUpdate: () => bridge.invoke<UpdateState>('update:check'),
    downloadUpdate: () => bridge.invoke<UpdateState>('update:download'),
    installUpdate: () => bridge.invoke('update:install'),
    getUpdateState: () => bridge.invoke<UpdateState>('update:state'),
    onUpdateState: (cb) => bridge.on('update:state', (s) => cb(s as UpdateState)),

    pickMedalFolders: () => bridge.invoke<string[]>('medal:pick'),
    scanMedal: (roots) => bridge.invoke<MedalScan>('medal:scan', roots),
    importMedal: (opts) => bridge.invoke<MedalResult>('medal:import', opts),
    cancelMedalImport: () => bridge.invoke('medal:cancel'),
    resetMedalImport: () => bridge.invoke('medal:reset'),
    onMedalProgress: (cb) => bridge.on('medal:progress', (p) => cb(p as MedalProgress)),
    setClipsGame: (ids, game) => bridge.invoke<ClipMeta[]>('clips:set-game', ids, game),
  }
}
