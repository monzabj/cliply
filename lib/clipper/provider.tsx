'use client'

import * as React from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { getClipper, type ClipperAPI } from './api'
import { AudioRing, RollingRecorder } from './recorder'
import {
  DEFAULT_SESSION_ID,
  DEFAULT_SETTINGS,
  MAX_SESSIONS,
  SEGMENT_SEC,
  type AudioLayer,
  type CaptureSource,
  type ClipMeta,
  type Hotkey,
  type SessionConfig,
  type Settings,
  type ShotMeta,
  type SourceRef,
  type TrimPayload,
} from './types'
import { formatDuration } from './hotkeys'
import { I18nProvider, createT, resolveLanguage, type TFunction } from '@/lib/i18n'

export type CaptureStatus = 'idle' | 'starting' | 'armed' | 'saving'
export type Page = 'gallery' | 'capture' | 'settings'

/** Serialisable snapshot of one recording session, for the UI. */
export interface SessionView {
  id: string
  name: string
  status: CaptureStatus
  sourceLabel: string | null
  bufferedSeconds: number
  bufferedBytes: number
  codec: string | null
  error: string | null
}

interface SessionRuntime {
  recorder: RollingRecorder | null
  stream: MediaStream | null
  source: CaptureSource | null
  /**
   * Set when ffmpeg records this screen (see electron/native-recorder.js);
   * `recorder` and `stream` are null then and the buffer lives on disk.
   */
  native?: { armedAt: number; maxSeconds: number; bitrateMbps: number } | null
}

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

  sessions: SessionView[]
  /** Creates a session, optionally pre-bound to a source. Returns its id. */
  addSession: (source?: SourceRef | null, name?: string) => string | null
  removeSession: (id: string) => void
  updateSession: (id: string, patch: Partial<SessionConfig>) => void
  armSession: (id: string) => Promise<void>
  disarmSession: (id: string) => void
  armAll: () => Promise<void>
  disarmAll: () => void
  previewStreamFor: (id: string) => MediaStream | null

  /** Aggregate view kept for the sidebar and simple call sites. */
  status: CaptureStatus
  armedCount: number
  bufferedSeconds: number
  maxBufferSeconds: number
  activeSourceLabel: string | null

  clipNow: (durationSec: number, sessionId?: string | null, pressedAt?: number) => Promise<void>
  playCue: () => void

  /** Foreground app/game, polled cheaply for the status bar. */
  currentGame: string | null
  /** Accelerators Windows refused to give us; shown persistently, not as a toast. */
  hotkeyFailures: string[]
  openLog: () => void

  clips: ClipMeta[]
  shots: ShotMeta[]
  clipsLoading: boolean
  refreshClips: () => Promise<unknown>
  /** Clips and screenshots together, after something outside a save changed them. */
  refreshLibrary: () => Promise<void>
  deleteShot: (id: string) => Promise<void>
  renameShot: (id: string, title: string) => Promise<void>
  renameClipFile: (id: string, baseName: string) => Promise<void>
  renameShotFile: (id: string, baseName: string) => Promise<void>
  deleteClip: (id: string) => Promise<void>
  renameClip: (id: string, title: string) => Promise<void>
  trimClip: (payload: TrimPayload) => Promise<ClipMeta>

  viewingClipId: string | null
  setViewingClipId: (id: string | null) => void

  showSetup: boolean
  setShowSetup: (v: boolean) => void
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
  const [views, setViews] = React.useState<Record<string, SessionView>>({})
  const [viewingClipId, setViewingClipId] = React.useState<string | null>(null)
  const [currentGame, setCurrentGame] = React.useState<string | null>(null)
  const [hotkeyFailures, setHotkeyFailures] = React.useState<string[]>([])
  const [showSetup, setShowSetup] = React.useState(false)

  const runtimes = React.useRef(new Map<string, SessionRuntime>())
  const apiRef = React.useRef<ClipperAPI | null>(null)
  // One microphone, shared by every session: each clip takes its own slice of the
  // same buffer instead of opening the device twice.
  const micRuntime = React.useRef<AudioRing | null>(null)
  // System sound for natively recorded screens. It is the whole desktop mix, the
  // same for every screen, so one buffer serves all of them.
  const sysAudioRuntime = React.useRef<AudioRing | null>(null)
  // Whether ffmpeg can record screens on this machine; asked once.
  const nativeOk = React.useRef<Promise<boolean> | null>(null)
  const settingsRef = React.useRef(settings)
  settingsRef.current = settings
  const viewsRef = React.useRef(views)
  viewsRef.current = views

  // Translations are needed inside callbacks (toasts), where hooks can't run.
  const tRef = React.useRef<TFunction>(createT('en'))
  React.useEffect(() => {
    tRef.current = createT(resolveLanguage(settings.language))
  }, [settings.language])
  const t = React.useCallback<TFunction>((key, vars) => tRef.current(key, vars), [])

  const { data: clips, isLoading: clipsLoading, mutate } = useSWR(
    api ? 'clips' : null,
    () => api!.listClips(),
    { revalidateOnFocus: false },
  )

  const { data: shots, mutate: mutateShots } = useSWR(
    api ? 'shots' : null,
    () => api!.listShots(),
    { revalidateOnFocus: false },
  )

  // --- session bookkeeping ---------------------------------------------------

  const patchView = React.useCallback((id: string, patch: Partial<SessionView>) => {
    setViews((prev) => {
      const base = prev[id] ?? {
        id,
        name: id,
        status: 'idle' as CaptureStatus,
        sourceLabel: null,
        bufferedSeconds: 0,
        bufferedBytes: 0,
        codec: null,
        error: null,
      }
      return { ...prev, [id]: { ...base, ...patch } }
    })
  }, [])

  // Keep a view row for every configured session, and drop removed ones.
  React.useEffect(() => {
    setViews((prev) => {
      const next: Record<string, SessionView> = {}
      for (const s of settings.sessions) {
        next[s.id] = prev[s.id]
          ? { ...prev[s.id], name: s.name }
          : {
              id: s.id,
              name: s.name,
              status: 'idle',
              sourceLabel: null,
              bufferedSeconds: 0,
              bufferedBytes: 0,
              codec: null,
              error: null,
            }
      }
      return next
    })
  }, [settings.sessions])

  // --- boot ------------------------------------------------------------------

  React.useEffect(() => {
    let cancelled = false
    getClipper().then(async (a) => {
      if (cancelled) return
      const s = await a.getSettings()
      const list = await a.getSources().catch(() => [])
      if (cancelled) return
      apiRef.current = a
      setApi(a)
      setSettings(s)
      setSources(list)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const updateSettings = React.useCallback(
    async (patch: Partial<Settings>) => {
      const current = settingsRef.current
      const next = { ...current, ...patch }
      setSettings(next)
      settingsRef.current = next
      if (api) await api.saveSettings(next)
    },
    [api],
  )

  /** Refreshes just the stored source of a session. */
  const updateSessionRef = React.useCallback(
    (id: string, source: SourceRef) => {
      const s = settingsRef.current
      void updateSettings({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, source } : x)) })
    },
    [updateSettings],
  )

  const refreshSources = React.useCallback(async () => {
    if (!api) return
    const list = await api.getSources().catch(() => [])
    setSources(list)
  }, [api])

  // --- hotkeys ---------------------------------------------------------------

  React.useEffect(() => {
    if (!api) return
    api.registerHotkeys(settings.hotkeys).then(({ failed }) => {
      setHotkeyFailures(failed)
      if (failed.length) toast.error(t('toast.hotkeyFailed', { keys: failed.join(', ') }))
    })
  }, [api, settings.hotkeys, t])

  /** Longest hotkey aimed at this session decides how much its buffer holds. */
  const maxSecondsFor = React.useCallback((sessionId: string) => {
    const relevant = settingsRef.current.hotkeys.filter((h) => h.sessionId === null || h.sessionId === sessionId)
    return Math.max(...relevant.map((h) => h.durationSec), 10)
  }, [])

  // A longer hotkey needs a longer buffer. The audio rings just grow; a native
  // ring is sized when ffmpeg starts, so that session is re-armed.
  const rearmRef = React.useRef<(id: string) => void>(() => {})
  React.useEffect(() => {
    const longest = Math.max(...settings.hotkeys.map((h) => h.durationSec), 10)
    micRuntime.current?.setMaxSeconds(longest)
    sysAudioRuntime.current?.setMaxSeconds(longest)
    for (const [id, rt] of runtimes.current) {
      if (rt.native && rt.native.maxSeconds < maxSecondsFor(id)) rearmRef.current(id)
    }
  }, [settings.hotkeys, maxSecondsFor])

  // --- sound cue -------------------------------------------------------------

  const cueRef = React.useRef<Record<string, HTMLAudioElement>>({})

  /**
   * Plays the confirmation sound. Separate cues for clips and screenshots, each
   * able to point at a file the user supplied.
   */
  const playCue = React.useCallback(
    (kind: 'clip' | 'shot' = 'clip') => {
      const s = settingsRef.current
      if (kind === 'clip' && !s.soundCue) return
      if (kind === 'shot' && !s.screenshotSound) return

      const custom = kind === 'clip' ? s.clipSoundFile : s.screenshotSoundFile
      const fallback = kind === 'clip' ? 'clip-cue.wav' : 'shutter.wav'
      const src = apiRef.current ? apiRef.current.soundUrl(custom, fallback) : fallback

      try {
        const cache = cueRef.current
        if (!cache[src]) cache[src] = new Audio(src)
        const el = cache[src]
        el.volume = Math.max(0, Math.min(1, s.soundCueVolume))
        el.currentTime = 0
        void el.play().catch(() => {})
      } catch {
        /* audio is a nicety; never let it break a clip */
      }
    },
    [],
  )

  // --- arming ----------------------------------------------------------------

  /**
   * getDisplayMedia resolves against a single "selected source" held in the main
   * process, so two sessions arming at once would both capture whatever was set
   * last. Every arm therefore runs through this queue.
   */
  const armQueue = React.useRef<Promise<unknown>>(Promise.resolve())
  const serialize = React.useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = () => fn()
    const next = armQueue.current.then(run, run)
    armQueue.current = next.catch(() => undefined)
    return next
  }, [])

  const longestClip = () => Math.max(...settingsRef.current.hotkeys.map((h) => h.durationSec), 10)

  /** Opens the microphone buffer if it is wanted and not already running. */
  const ensureMic = React.useCallback(async () => {
    if (micRuntime.current) return
    const s = settingsRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(s.micDeviceId ? { deviceId: { exact: s.micDeviceId } } : {}),
          // The game sound is recorded separately, so the mic never hears it
          // through the capture — cancelling it would only eat your voice.
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      const ring = new AudioRing(stream, longestClip())
      ring.start()
      micRuntime.current = ring
      apiRef.current?.log('mic', `grabando ${stream.getAudioTracks()[0]?.label || 'micrófono'}`)
    } catch (err) {
      apiRef.current?.log('mic', `no disponible: ${err instanceof Error ? err.message : String(err)}`)
      toast.warning(t('toast.micUnavailable'))
    }
  }, [t])

  /**
   * System sound for native sessions. getDisplayMedia is the only way to get the
   * Windows loopback, and it insists on video too, so that track is stopped at
   * once — ffmpeg records the picture.
   */
  const ensureSystemAudio = React.useCallback(async () => {
    if (sysAudioRuntime.current) return
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1, width: 64, height: 36 },
        audio: { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      display.getVideoTracks().forEach((track) => track.stop())
      const tracks = display.getAudioTracks()
      if (!tracks.length) throw new Error('sin pista de audio del sistema')
      const ring = new AudioRing(new MediaStream(tracks), longestClip())
      ring.start()
      sysAudioRuntime.current = ring
    } catch (err) {
      apiRef.current?.log('audio', `audio del sistema no disponible: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const releaseAudioIfIdle = React.useCallback(() => {
    if (runtimes.current.size > 0) return
    micRuntime.current?.stop()
    micRuntime.current = null
    sysAudioRuntime.current?.stop()
    sysAudioRuntime.current = null
  }, [])

  const disarmSession = React.useCallback(
    (id: string) => {
      const rt = runtimes.current.get(id)
      rt?.recorder?.stop()
      if (rt?.native) void apiRef.current?.nativeStop(id)
      runtimes.current.delete(id)
      releaseAudioIfIdle()
      patchView(id, { status: 'idle', sourceLabel: null, bufferedSeconds: 0, bufferedBytes: 0, codec: null })
    },
    [patchView, releaseAudioIfIdle],
  )

  const armSession = React.useCallback(
    async (id: string) => {
      if (!api) return
      const current = viewsRef.current[id]
      if (current && current.status !== 'idle') return

      const config = settingsRef.current.sessions.find((s) => s.id === id)
      if (!config) return

      patchView(id, { status: 'starting', error: null })

      await serialize(async () => {
        const s = settingsRef.current
        try {
          let resolved: CaptureSource | null = null

          if (api.isDesktop) {
            if (!config.source) {
              const msg = t('toast.noSource', { name: config.name })
              patchView(id, { status: 'idle', error: msg })
              toast.error(msg)
              return
            }
            // Never silently fall back to "some other screen" — that is how you
            // end up clipping the wrong monitor without noticing.
            resolved = await api.resolveSource(config.source)
            if (resolved) {
              // Identifiers drift between runs; write back what actually matched
              // so the stored reference stays fresh and the UI agrees with us.
              const stored = config.source
              const moved =
                stored.id !== resolved.id || String(stored.displayId ?? '') !== String(resolved.displayId ?? '')
              if (moved) {
                api.log('captura', `${config.name}: referencia actualizada (${stored.id} -> ${resolved.id})`)
                updateSessionRef(id, {
                  id: resolved.id,
                  name: resolved.name,
                  type: resolved.type,
                  displayId: resolved.displayId ?? null,
                  width: resolved.width ?? null,
                  height: resolved.height ?? null,
                })
              }
            }
            if (!resolved) {
              const msg = t('toast.sourceMissing', { name: config.source.name })
              patchView(id, { status: 'idle', error: t('capture.unavailable') })
              toast.error(msg, { duration: 8000 })
              return
            }
            await api.selectSource(resolved)

            // Screens go to ffmpeg when it can take them: Chromium's capture
            // stalls at 30–40 fps on many machines, ffmpeg holds a steady 60.
            if (resolved.type === 'screen' && resolved.displayId && resolved.width && resolved.height) {
              nativeOk.current ??= api.nativeAvailable().catch(() => false)
              if (await nativeOk.current) {
                const maxSeconds = maxSecondsFor(id)
                const started = await api.nativeStart(id, {
                  displayId: String(resolved.displayId),
                  width: resolved.width,
                  height: resolved.height,
                  fps: s.fps,
                  bitrateMbps: s.videoBitrateMbps,
                  maxSeconds,
                })
                if (started.ok) {
                  // Same selected source: the loopback needs a getDisplayMedia call.
                  if (s.captureSystemAudio) await ensureSystemAudio()
                  if (s.captureMic) await ensureMic()
                  runtimes.current.set(id, {
                    recorder: null,
                    stream: null,
                    source: resolved,
                    native: { armedAt: Date.now(), maxSeconds, bitrateMbps: s.videoBitrateMbps },
                  })
                  patchView(id, { status: 'armed', sourceLabel: resolved.name, codec: started.encoder, error: null })
                  return
                }
                api.log('captura', `${config.name}: ffmpeg no pudo (${started.error}); uso la captura de Chromium`)
              }
            }
          }

          const display = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: s.fps, max: s.fps } },
            // Windows loopback hands back mono unless stereo is asked for, which
            // would flatten game audio. 'ideal' so it degrades instead of failing.
            audio: s.captureSystemAudio ? { channelCount: { ideal: 2 } } : false,
          })

          // The mic is recorded as its own layer, so the capture stream stays pure
          // game audio and the two can be balanced afterwards.
          const stream = display
          if (s.captureMic) await ensureMic()

          const videoTrack = display.getVideoTracks()[0]
          // Keep the frame rate over sharpness when the encoder is busy.
          videoTrack.contentHint = 'motion'
          const trackSettings = videoTrack.getSettings() as MediaTrackSettings & { displaySurface?: string }
          const source: CaptureSource =
            resolved ?? {
              id: videoTrack.id,
              name: friendlyTrackLabel(videoTrack.label, trackSettings.displaySurface),
              type: trackSettings.displaySurface === 'monitor' ? 'screen' : 'window',
            }

          const recorder = new RollingRecorder(stream, {
            maxSeconds: maxSecondsFor(id),
            videoBitsPerSecond: s.videoBitrateMbps * 1_000_000,
            mode: api.isDesktop ? 'segmented' : 'continuous',
            // Each rotation drops ~0.6s of video. Making a segment as long as the
            // whole buffer means a clip crosses one seam at most instead of six.
            segmentSec: maxSecondsFor(id),
            codec: s.codec,
          })
          recorder.onUpdate(() =>
            patchView(id, { bufferedSeconds: recorder.bufferedSeconds, bufferedBytes: recorder.bufferedBytes }),
          )
          recorder.start()

          runtimes.current.set(id, { recorder, stream: display, source })
          patchView(id, {
            status: 'armed',
            sourceLabel: source.name,
            codec: recorder.codec.family,
            error: null,
          })

          videoTrack.addEventListener('ended', () => {
            toast(t('toast.sourceClosed'))
            disarmSession(id)
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          patchView(id, { status: 'idle' })
          if (!/permission|abort|not ?allowed/i.test(message)) {
            toast.error(t('toast.captureFailed', { error: message }))
          }
        }
      })
    },
    [api, disarmSession, ensureMic, ensureSystemAudio, maxSecondsFor, patchView, serialize, t, updateSessionRef],
  )

  const armAll = React.useCallback(async () => {
    for (const s of settingsRef.current.sessions) await armSession(s.id)
  }, [armSession])

  const disarmAll = React.useCallback(() => {
    for (const id of [...runtimes.current.keys()]) disarmSession(id)
  }, [disarmSession])

  // armSession refuses while the view still says "armed"; give the disarm a
  // render to land before arming again.
  rearmRef.current = (id: string) => {
    disarmSession(id)
    setTimeout(() => void armSession(id), 500)
  }

  // Arm sessions flagged autoArm once, after boot.
  const autoArmed = React.useRef(false)
  React.useEffect(() => {
    if (!ready || !api || autoArmed.current) return
    autoArmed.current = true
    const targets = settingsRef.current.sessions.filter((s) => s.autoArm)
    if (!targets.length) return
    void (async () => {
      for (const s of targets) await armSession(s.id)
    })()
  }, [ready, api, armSession])

  // --- clipping --------------------------------------------------------------

  const clipNow = React.useCallback(
    async (durationSec: number, sessionId: string | null = null, pressedAt?: number) => {
      if (!api) return
      // The clip ends when the key went down, not when we got round to it.
      const endWall = pressedAt ?? Date.now()

      const targets = [...runtimes.current.entries()].filter(
        ([id, rt]) => (rt.recorder || rt.native) && (sessionId === null || id === sessionId),
      )

      if (!targets.length) {
        // Nothing was armed. Mid-game the warning toast is invisible, so start
        // recording now — the moment itself is lost, but the next one is not.
        api.log('clip', 'hotkey recibida SIN sesiones armadas: armando ahora')
        toast.warning(t('toast.notArmedArming'))
        const ready = settingsRef.current.sessions.filter((s) => s.source)
        for (const s of ready) await armSession(s.id)
        return
      }

      // Immediate feedback: the point of the cue is to confirm the key registered,
      // so it has to fire before any of the saving work starts.
      playCue()

      const savingToast = toast.loading(t('toast.saving', { d: formatDuration(durationSec) }))
      targets.forEach(([id]) => patchView(id, { status: 'saving' }))

      try {
        const foreground = await api.getForegroundWindow()
        const saved: ClipMeta[] = []

        // Audio layers are cut from complete recordings that started before the
        // clip window; a second of slack covers the keyframe the video snaps to.
        const from = endWall - (durationSec + 1) * 1000
        const mic: AudioLayer | null = (await micRuntime.current?.layerFrom(from)) ?? null
        const anyNative = targets.some(([, rt]) => rt.native)
        const sysAudio: AudioLayer | null = anyNative ? ((await sysAudioRuntime.current?.layerFrom(from)) ?? null) : null

        for (const [id, rt] of targets) {
          const config = settingsRef.current.sessions.find((s) => s.id === id)
          const source = {
            type: rt.source?.type ?? ('screen' as const),
            name: rt.source?.name ?? 'Screen',
            app: foreground,
            sessionName: config?.name ?? null,
          }

          if (rt.native) {
            saved.push(await api.nativeSave({ sessionId: id, durationSec, endWall, source, audio: sysAudio, mic }))
            continue
          }

          const slice = await rt.recorder!.getLast(durationSec)
          const parts = await Promise.all(slice.parts.map((b) => b.arrayBuffer()))
          const meta = await api.saveClip({
            parts,
            mimeType: slice.mimeType,
            container: slice.container,
            trimStartSec: slice.trimStartSec,
            continuous: slice.continuous,
            inputStartWall: slice.inputStartWall,
            inputEndWall: slice.inputEndWall,
            durationSec: Math.round(slice.durationSec),
            mic,
            endWall,
            source,
            title: foreground ?? rt.source?.name ?? 'Clip',
          })
          saved.push(meta)
        }

        await mutate()

        const first = saved[0]
        toast.success(t('toast.clipSaved', { d: formatDuration(first.durationSec) }), {
          id: savingToast,
          description: saved.length > 1 ? saved.map((c) => c.source.sessionName ?? c.title).join(' · ') : first.title,
          action: {
            label: t('toast.view'),
            onClick: () => {
              setPage('gallery')
              setViewingClipId(first.id)
            },
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // Mid-game a toast is invisible, so the reason has to reach the log too.
        api.log('clip', `FALLO al guardar: ${message}`)
        toast.error(t('toast.saveFailed', { error: message }), { id: savingToast })
      } finally {
        targets.forEach(([id]) => patchView(id, { status: runtimes.current.has(id) ? 'armed' : 'idle' }))
      }
    },
    [api, armSession, mutate, patchView, playCue, t],
  )

  const clipNowRef = React.useRef(clipNow)
  clipNowRef.current = clipNow

  React.useEffect(() => {
    if (!api) return
    return api.onHotkey((hotkey: Hotkey) => {
      const armedNow = runtimes.current.size
      api.log('clip', `hotkey ${hotkey.accelerator} en la interfaz (sesiones armadas: ${armedNow})`)
      void clipNowRef.current(hotkey.durationSec, hotkey.sessionId ?? null, hotkey.pressedAt)
    })
  }, [api])

  // Poll the foreground app for the status bar. The main process caches by pid,
  // so repeat polls on an unchanged window cost about a millisecond. Skipped while
  // the window is hidden and nothing is armed, since nobody can see the result.
  React.useEffect(() => {
    if (!api) return
    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      const armedNow = runtimes.current.size > 0
      if (typeof document !== 'undefined' && document.hidden && !armedNow) return
      try {
        const game = await api.getForegroundWindow()
        if (cancelled) return
        setCurrentGame((prev) => {
          if (game) return game
          // Detection returns null while Clipper itself is in front. Showing the
          // last known game beats blanking the bar every time you tab over here.
          if (typeof document !== 'undefined' && document.hasFocus()) return prev
          return null
        })
      } catch {
        /* detection is best-effort */
      }
    }

    void tick()
    const timer = setInterval(tick, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [api])

  // Screenshots run in the main process; here we only sound the shutter the
  // moment the key lands and report what happened.
  React.useEffect(() => {
    if (!api) return
    const offStart = api.onShotStarted(() => playCue('shot'))
    const offDone = api.onShotDone((res) => {
      if (!res.ok) {
        toast.error(t('toast.shotFailed'))
        return
      }
      if (res.saved) {
        void mutateShots()
        toast.success(t(res.copied ? 'toast.shotSavedCopied' : 'toast.shotSaved'), {
          description: res.fileName,
          action: { label: t('toast.openFolder'), onClick: () => void api.openShotsDir() },
        })
      } else {
        toast.success(t('toast.shotCopied'))
      }
    })
    return () => {
      offStart()
      offDone()
    }
  }, [api, playCue, t, mutateShots])

  // Tick buffer indicators while anything is armed.
  const anyArmed = Object.values(views).some((v) => v.status === 'armed' || v.status === 'saving')
  React.useEffect(() => {
    if (!anyArmed) return
    // Only push state when a displayed number actually changes: the UI shows whole
    // seconds and whole megabytes, so re-rendering the tree twice a second while
    // recording is pure waste.
    const lastShown = new Map<string, string>()
    const timer = setInterval(() => {
      for (const [id, rt] of runtimes.current) {
        let bufferedSeconds: number
        let bufferedBytes: number
        if (rt.native) {
          // The native buffer is a fixed ring on disk: it fills, then holds.
          bufferedSeconds = Math.min(rt.native.maxSeconds, (Date.now() - rt.native.armedAt) / 1000)
          bufferedBytes = (bufferedSeconds * rt.native.bitrateMbps * 1_000_000) / 8
        } else if (rt.recorder) {
          bufferedSeconds = rt.recorder.bufferedSeconds
          bufferedBytes = rt.recorder.bufferedBytes
        } else continue
        const key = `${Math.floor(bufferedSeconds)}|${Math.round(bufferedBytes / 1048576)}`
        if (lastShown.get(id) === key) continue
        lastShown.set(id, key)
        patchView(id, { bufferedSeconds, bufferedBytes })
      }
    }, 500)
    return () => clearInterval(timer)
  }, [anyArmed, patchView])

  // --- session config editing ------------------------------------------------

  const addSession = React.useCallback(
    (source: SourceRef | null = null, name?: string) => {
      const s = settingsRef.current
      if (s.sessions.length >= MAX_SESSIONS) return null
      const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
      const next: SessionConfig = {
        id,
        name: name ?? source?.name ?? `Monitor ${s.sessions.length + 1}`,
        source,
        autoArm: true,
      }
      // A brand new session needs a key of its own, otherwise it can never be clipped.
      const usedKeys = new Set(s.hotkeys.map((h) => h.accelerator))
      const spare = ['F9', 'F7', 'F6', 'F4'].find((k) => !usedKeys.has(k))
      const hotkeys = spare
        ? [
            ...s.hotkeys,
            {
              id: `hk-${id}`,
              accelerator: spare,
              action: 'clip' as const,
              durationSec: s.hotkeys.find((h) => h.action === 'clip')?.durationSec ?? 30,
              sessionId: id,
            },
          ]
        : s.hotkeys

      void updateSettings({ sessions: [...s.sessions, next], hotkeys })
      return id
    },
    [updateSettings],
  )

  const removeSession = React.useCallback(
    (id: string) => {
      const s = settingsRef.current
      if (s.sessions.length <= 1) return
      disarmSession(id)

      const fallback = s.sessions.find((x) => x.id !== id)?.id ?? DEFAULT_SESSION_ID
      // Drop a key that existed only for this session; re-point anything the user
      // set up themselves so no hotkey is left aiming at nothing.
      const hotkeys = s.hotkeys
        .filter((h) => h.id !== `hk-${id}`)
        .map((h) => (h.sessionId === id ? { ...h, sessionId: fallback } : h))
      const withDefault = hotkeys.length && !hotkeys.some((h) => h.isDefault)
        ? [{ ...hotkeys[0], isDefault: true }, ...hotkeys.slice(1)]
        : hotkeys

      void updateSettings({
        sessions: s.sessions.filter((x) => x.id !== id),
        hotkeys: withDefault.length ? withDefault : s.hotkeys,
      })
    },
    [disarmSession, updateSettings],
  )

  const updateSession = React.useCallback(
    (id: string, patch: Partial<SessionConfig>) => {
      const s = settingsRef.current
      void updateSettings({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
    },
    [updateSettings],
  )

  const previewStreamFor = React.useCallback((id: string) => runtimes.current.get(id)?.stream ?? null, [])

  // --- clip operations -------------------------------------------------------

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

  // --- aggregate view --------------------------------------------------------

  const sessionViews = React.useMemo(
    () => settings.sessions.map((s) => views[s.id]).filter(Boolean) as SessionView[],
    [settings.sessions, views],
  )

  const armedSessions = sessionViews.filter((v) => v.status === 'armed' || v.status === 'saving')
  const status: CaptureStatus = sessionViews.some((v) => v.status === 'saving')
    ? 'saving'
    : armedSessions.length
      ? 'armed'
      : sessionViews.some((v) => v.status === 'starting')
        ? 'starting'
        : 'idle'

  const maxBufferSeconds = React.useMemo(
    () => Math.max(...settings.hotkeys.map((h) => h.durationSec), 10),
    [settings.hotkeys],
  )

  // Keep the tray icon honest about whether anything is being recorded.
  const trayLabel = armedSessions.map((v) => v.sourceLabel ?? v.name).join(' \u00b7 ')
  React.useEffect(() => {
    api?.setTrayState(armedSessions.length > 0, trayLabel)
  }, [api, armedSessions.length, trayLabel])

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
    sessions: sessionViews,
    addSession,
    removeSession,
    updateSession,
    armSession,
    disarmSession,
    armAll,
    disarmAll,
    previewStreamFor,
    status,
    armedCount: armedSessions.length,
    bufferedSeconds: armedSessions.length ? Math.min(...armedSessions.map((v) => v.bufferedSeconds)) : 0,
    maxBufferSeconds: maxBufferSeconds + SEGMENT_SEC,
    activeSourceLabel: armedSessions.map((v) => v.sourceLabel).filter(Boolean).join(' · ') || null,
    clipNow,
    playCue,
    currentGame,
    hotkeyFailures,
    openLog: () => api?.openLog(),
    clips: clips ?? [],
    shots: shots ?? [],
    clipsLoading,
    refreshClips: mutate,
    refreshLibrary: async () => {
      await Promise.all([mutate(), mutateShots()])
    },
    deleteShot: async (id: string) => {
      if (!api) return
      await api.deleteShot(id)
      await mutateShots()
    },
    renameShot: async (id: string, title: string) => {
      if (!api) return
      await api.renameShot(id, title)
      await mutateShots()
    },
    renameClipFile: async (id: string, baseName: string) => {
      if (!api) return
      await api.renameClipFile(id, baseName)
      await mutate()
    },
    renameShotFile: async (id: string, baseName: string) => {
      if (!api) return
      await api.renameShotFile(id, baseName)
      await mutateShots()
    },
    deleteClip,
    renameClip,
    trimClip,
    viewingClipId,
    setViewingClipId,
    showSetup,
    setShowSetup,
  }

  return (
    <ClipperContext.Provider value={value}>
      <I18nProvider language={settings.language}>{children}</I18nProvider>
    </ClipperContext.Provider>
  )
}

export type { SourceRef }

function friendlyTrackLabel(label: string, surface?: string) {
  if (/^screen:/.test(label) || surface === 'monitor') return 'Screen'
  if (/^window:/.test(label)) return 'Window'
  if (surface === 'browser') return 'Browser tab'
  return label || 'Screen'
}
