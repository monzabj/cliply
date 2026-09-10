'use client'

import * as React from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { getClipper, type ClipperAPI } from './api'
import { RollingRecorder } from './recorder'
import {
  DEFAULT_SETTINGS,
  SEGMENT_SEC,
  type CaptureSource,
  type ClipMeta,
  type Hotkey,
  type Settings,
  type TrimPayload,
} from './types'
import { formatDuration } from './hotkeys'

export type CaptureStatus = 'idle' | 'starting' | 'armed' | 'saving'
export type Page = 'gallery' | 'capture' | 'settings'

interface ClipperContextValue {
  api: ClipperAPI | null
  ready: boolean
  isDesktop: boolean

  page: Page
  setPage: (p: Page) => void

  settings: Settings
  updateSettings: (patch: Partial<Settings>) => Promise<void>

  sources: CaptureSource[]
  refreshSources: () => Promise<void>
  selectedSource: CaptureSource | null
  setSelectedSource: (s: CaptureSource | null) => void

  status: CaptureStatus
  previewStream: MediaStream | null
  bufferedSeconds: number
  maxBufferSeconds: number
  activeSourceLabel: string | null
  arm: () => Promise<void>
  disarm: () => void
  clipNow: (durationSec: number) => Promise<void>

  clips: ClipMeta[]
  clipsLoading: boolean
  refreshClips: () => Promise<unknown>
  deleteClip: (id: string) => Promise<void>
  renameClip: (id: string, title: string) => Promise<void>
  trimClip: (payload: TrimPayload) => Promise<ClipMeta>

  viewingClipId: string | null
  setViewingClipId: (id: string | null) => void
}

const ClipperContext = React.createContext<ClipperContextValue | null>(null)

export function useClipper() {
  const ctx = React.useContext(ClipperContext)
  if (!ctx) throw new Error('useClipper must be used inside ClipperProvider')
  return ctx
}

export function ClipperProvider({ children }: { children: React.ReactNode }) {
  const [api, setApi] = React.useState<ClipperAPI | null>(null)
  const [settings, setSettings] = React.useState<Settings>(DEFAULT_SETTINGS)
  const [ready, setReady] = React.useState(false)
  const [page, setPage] = React.useState<Page>('gallery')

  const [sources, setSources] = React.useState<CaptureSource[]>([])
  const [selectedSource, setSelectedSource] = React.useState<CaptureSource | null>(null)

  const [status, setStatus] = React.useState<CaptureStatus>('idle')
  const [previewStream, setPreviewStream] = React.useState<MediaStream | null>(null)
  const [bufferedSeconds, setBufferedSeconds] = React.useState(0)
  const [activeSourceLabel, setActiveSourceLabel] = React.useState<string | null>(null)
  const [viewingClipId, setViewingClipId] = React.useState<string | null>(null)

  const recorderRef = React.useRef<RollingRecorder | null>(null)
  const activeSourceRef = React.useRef<CaptureSource | null>(null)
  const statusRef = React.useRef<CaptureStatus>('idle')
  statusRef.current = status

  const { data: clips, isLoading: clipsLoading, mutate } = useSWR(
    api ? 'clips' : null,
    () => api!.listClips(),
    { revalidateOnFocus: false },
  )

  // Boot: resolve the platform adapter, load settings + sources.
  React.useEffect(() => {
    let cancelled = false
    getClipper().then(async (a) => {
      if (cancelled) return
      const s = await a.getSettings()
      const list = await a.getSources().catch(() => [])
      if (cancelled) return
      setApi(a)
      setSettings(s)
      setSources(list)
      if (s.lastSourceId) setSelectedSource(list.find((x) => x.id === s.lastSourceId) ?? null)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep global hotkeys registered in sync with settings.
  React.useEffect(() => {
    if (!api) return
    api.registerHotkeys(settings.hotkeys).then(({ failed }) => {
      if (failed.length) toast.error(`Could not bind ${failed.join(', ')} — another app may own that key.`)
    })
  }, [api, settings.hotkeys])

  const maxBufferSeconds = React.useMemo(
    () => Math.max(...settings.hotkeys.map((h) => h.durationSec), 10),
    [settings.hotkeys],
  )

  const updateSettings = React.useCallback(
    async (patch: Partial<Settings>) => {
      if (!api) return
      const next = { ...settings, ...patch }
      setSettings(next)
      await api.saveSettings(next)
    },
    [api, settings],
  )

  const refreshSources = React.useCallback(async () => {
    if (!api) return
    const list = await api.getSources().catch(() => [])
    setSources(list)
  }, [api])

  const disarm = React.useCallback(() => {
    recorderRef.current?.stop()
    recorderRef.current = null
    activeSourceRef.current = null
    setPreviewStream(null)
    setActiveSourceLabel(null)
    setBufferedSeconds(0)
    setStatus('idle')
  }, [])

  const arm = React.useCallback(async () => {
    if (!api || statusRef.current !== 'idle') return
    setStatus('starting')
    try {
      await api.selectSource(selectedSource)
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: settings.fps },
        audio: settings.captureSystemAudio,
      })

      let stream = display
      if (settings.captureMic) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
          stream = mixAudio(display, mic)
        } catch {
          toast.warning('Microphone unavailable — recording system audio only.')
        }
      }

      const videoTrack = display.getVideoTracks()[0]
      const trackSettings = videoTrack.getSettings() as MediaTrackSettings & { displaySurface?: string }
      const resolvedSource: CaptureSource = selectedSource ?? {
        id: videoTrack.id,
        name: friendlyTrackLabel(videoTrack.label, trackSettings.displaySurface),
        type: trackSettings.displaySurface === 'monitor' ? 'screen' : 'window',
      }
      activeSourceRef.current = resolvedSource
      setActiveSourceLabel(resolvedSource.name)

      const recorder = new RollingRecorder(stream, {
        maxSeconds: maxBufferSeconds,
        videoBitsPerSecond: settings.videoBitrateMbps * 1_000_000,
        mode: api.isDesktop ? 'segmented' : 'continuous',
      })
      recorder.onUpdate(() => setBufferedSeconds(recorder.bufferedSeconds))
      recorder.start()
      recorderRef.current = recorder
      setPreviewStream(display)
      setStatus('armed')

      videoTrack.addEventListener('ended', () => {
        toast('Capture source closed — clipper disarmed.')
        disarm()
      })

      if (selectedSource && selectedSource.id !== settings.lastSourceId) {
        void updateSettings({ lastSourceId: selectedSource.id })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/permission|abort|not ?allowed/i.test(message)) toast.error(`Could not start capture: ${message}`)
      setStatus('idle')
    }
  }, [api, selectedSource, settings, maxBufferSeconds, disarm, updateSettings])

  const clipNow = React.useCallback(
    async (durationSec: number) => {
      const recorder = recorderRef.current
      if (!api || !recorder || statusRef.current !== 'armed') {
        toast.warning('Clipper is not armed. Pick a source and arm it first.')
        return
      }
      setStatus('saving')
      const savingToast = toast.loading(`Saving last ${formatDuration(durationSec)}…`)
      try {
        const [slice, foreground] = await Promise.all([recorder.getLast(durationSec), api.getForegroundWindow()])
        const src = activeSourceRef.current
        const source = {
          type: src?.type ?? 'screen',
          name: src?.name ?? 'Screen',
          app: foreground,
        }
        const title = foreground ?? source.name
        const parts = await Promise.all(slice.parts.map((b) => b.arrayBuffer()))
        const meta = await api.saveClip({
          parts,
          mimeType: slice.mimeType,
          trimStartSec: slice.trimStartSec,
          durationSec: Math.round(slice.durationSec),
          source,
          title,
        })
        await mutate()
        toast.success(`Clip saved · ${formatDuration(meta.durationSec)}`, {
          id: savingToast,
          description: meta.title,
          action: {
            label: 'View',
            onClick: () => {
              setPage('gallery')
              setViewingClipId(meta.id)
            },
          },
        })
      } catch (err) {
        toast.error(`Failed to save clip: ${err instanceof Error ? err.message : String(err)}`, { id: savingToast })
      } finally {
        setStatus(recorderRef.current ? 'armed' : 'idle')
      }
    },
    [api, mutate],
  )

  // Global hotkeys → clip.
  React.useEffect(() => {
    if (!api) return
    return api.onHotkey((hotkey: Hotkey) => void clipNow(hotkey.durationSec))
  }, [api, clipNow])

  // Tick the buffer indicator while armed.
  React.useEffect(() => {
    if (status !== 'armed') return
    const t = setInterval(() => {
      const r = recorderRef.current
      if (r) setBufferedSeconds(r.bufferedSeconds)
    }, 500)
    return () => clearInterval(t)
  }, [status])

  const deleteClip = React.useCallback(
    async (id: string) => {
      if (!api) return
      await api.deleteClip(id)
      await mutate()
    },
    [api, mutate],
  )

  const renameClip = React.useCallback(
    async (id: string, title: string) => {
      if (!api) return
      await api.renameClip(id, title)
      await mutate()
    },
    [api, mutate],
  )

  const trimClip = React.useCallback(
    async (payload: TrimPayload) => {
      if (!api) throw new Error('Not ready')
      const meta = await api.trimClip(payload)
      await mutate()
      return meta
    },
    [api, mutate],
  )

  const value: ClipperContextValue = {
    api,
    ready,
    isDesktop: api?.isDesktop ?? false,
    page,
    setPage,
    settings,
    updateSettings,
    sources,
    refreshSources,
    selectedSource,
    setSelectedSource,
    status,
    previewStream,
    bufferedSeconds,
    maxBufferSeconds: maxBufferSeconds + SEGMENT_SEC,
    activeSourceLabel,
    arm,
    disarm,
    clipNow,
    clips: clips ?? [],
    clipsLoading,
    refreshClips: mutate,
    deleteClip,
    renameClip,
    trimClip,
    viewingClipId,
    setViewingClipId,
  }

  return <ClipperContext.Provider value={value}>{children}</ClipperContext.Provider>
}

function mixAudio(display: MediaStream, mic: MediaStream): MediaStream {
  const ctx = new AudioContext()
  const dest = ctx.createMediaStreamDestination()
  for (const s of [display, mic]) {
    if (s.getAudioTracks().length) ctx.createMediaStreamSource(s).connect(dest)
  }
  return new MediaStream([...display.getVideoTracks(), ...dest.stream.getAudioTracks()])
}

function friendlyTrackLabel(label: string, surface?: string) {
  if (/^screen:/.test(label) || surface === 'monitor') return 'Screen'
  if (/^window:/.test(label)) return 'Window'
  if (surface === 'browser') return 'Browser tab'
  return label || 'Screen'
}
