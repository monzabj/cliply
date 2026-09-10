import type { ClipperAPI, DesktopBridge } from './api'
import type { CaptureSource, ClipMeta, Hotkey, SaveClipPayload, Settings, TrimPayload } from './types'

export function createDesktopAPI(bridge: DesktopBridge): ClipperAPI {
  return {
    isDesktop: true,
    platform: bridge.platform,

    getSettings: () => bridge.invoke<Settings>('settings:get'),
    saveSettings: (settings) => bridge.invoke<Settings>('settings:save', settings),

    getSources: () => bridge.invoke<CaptureSource[]>('sources:list'),
    selectSource: (source: CaptureSource | null) => bridge.invoke('sources:select', source),
    getForegroundWindow: () => bridge.invoke<string | null>('system:foreground-window'),

    listClips: () => bridge.invoke<ClipMeta[]>('clips:list'),
    saveClip: (payload: SaveClipPayload) => bridge.invoke<ClipMeta>('clips:save', payload),
    deleteClip: (id) => bridge.invoke('clips:delete', id),
    renameClip: (id, title) => bridge.invoke<ClipMeta>('clips:rename', id, title),
    trimClip: (payload: TrimPayload) => bridge.invoke<ClipMeta>('clips:trim', payload),
    getClipUrl: async (clip) => `clip://local/${encodeURIComponent(clip.fileName)}`,
    releaseClipUrl: () => {},
    getThumbnailUrl: (clip) =>
      clip.thumbnail ? `clip://thumbs/${encodeURIComponent(clip.thumbnail)}?v=${clip.sizeBytes}` : null,

    chooseClipsDir: () => bridge.invoke<string | null>('clips:choose-dir'),
    openClipsDir: () => bridge.invoke('clips:open-dir'),
    showClipInFolder: (id) => bridge.invoke('clips:show', id),
    exportClip: (id) => bridge.invoke('clips:export', id),

    registerHotkeys: (hotkeys: Hotkey[]) => bridge.invoke<{ failed: string[] }>('hotkeys:register', hotkeys),
    onHotkey: (cb) => bridge.on('hotkeys:pressed', (hotkey) => cb(hotkey as Hotkey)),
  }
}
