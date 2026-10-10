'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Calendar,
  ClipboardCopy,
  Download,
  FileVideo,
  FolderOpen,
  Gamepad2,
  Maximize2,
  Monitor,
  Pause,
  Pencil,
  Play,
  Scissors,
  Settings2,
  Mic,
  MicOff,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useClipper } from '@/lib/clipper/provider'
import { formatClock, formatDuration, formatTimecode } from '@/lib/clipper/hotkeys'
import { DEFAULT_MIX, type AudioMix, type TrimMode } from '@/lib/clipper/types'
import { useT } from '@/lib/i18n'
import { TrimBar } from './trim-bar'
import { formatBytes, useRelativeDate, useTimeLabel } from './gallery-page'
import { FileNameEditor } from './file-name'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2]

/** Screen capture is variable-rate; 1/60s is the finest step worth offering. */
const FRAME_SEC = 1 / 60

/**
 * The progress bar under the picture: a thin line that thickens on hover, with a
 * knob you can grab and drag. The hit area is much taller than the line itself,
 * because a 4px target is miserable to grab with a mouse.
 */
function ProgressBar({
  current,
  duration,
  onSeek,
}: {
  current: number
  duration: number
  onSeek: (t: number) => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = React.useState(false)

  const pct = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0

  const timeAt = (clientX: number) => {
    const el = ref.current
    if (!el || duration <= 0) return 0
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - r.left, 0), r.width)
    return (x / r.width) * duration
  }

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.preventDefault()
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          /* dragging still works without capture */
        }
        setDragging(true)
        onSeek(timeAt(e.clientX))
      }}
      onPointerMove={(e) => dragging && onSeek(timeAt(e.clientX))}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      className="group/prog absolute inset-x-0 bottom-0 flex h-5 cursor-pointer touch-none items-end"
    >
      <div
        className={cn(
          'relative w-full bg-white/25 transition-[height] duration-100',
          dragging ? 'h-1.5' : 'h-1 group-hover/prog:h-1.5',
        )}
      >
        <div className="h-full bg-signal" style={{ width: `${pct}%` }} />
        <span
          className={cn(
            'absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal shadow transition-all duration-100',
            dragging ? 'scale-125 opacity-100' : 'opacity-0 group-hover/prog:opacity-100',
          )}
          style={{ left: `${pct}%` }}
          aria-hidden
        />
      </div>
    </div>
  )
}

function LayerControl({
  icon: Icon,
  mutedIcon: MutedIcon,
  label,
  value,
  muted,
  onValue,
  onMute,
}: {
  icon: typeof Volume2
  mutedIcon: typeof VolumeX
  label: string
  value: number
  muted: boolean
  onValue: (v: number) => void
  onMute: () => void
}) {
  const Glyph = muted ? MutedIcon : Icon
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onMute}
        aria-pressed={muted}
        aria-label={label}
        className={cn(
          'flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent',
          muted ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        <Glyph className="size-4" />
      </button>
      <span className={cn('w-20 text-xs', muted && 'text-muted-foreground line-through')}>{label}</span>
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.05}
        value={muted ? 0 : value}
        onChange={(e) => onValue(Number(e.target.value))}
        aria-label={label}
        className="range-signal w-28"
      />
      <span className="w-10 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {Math.round((muted ? 0 : value) * 100)}%
      </span>
    </div>
  )
}

export function ClipViewer() {
  const { api, clips, viewingClipId, setViewingClipId, deleteClip, renameClip, renameClipFile, trimClip, isDesktop } =
    useClipper()
  const t = useT()
  const relativeOf = useRelativeDate()
  const timeLabelOf = useTimeLabel()
  const clip = clips.find((c) => c.id === viewingClipId) ?? null

  const videoRef = React.useRef<HTMLVideoElement>(null)
  const micRef = React.useRef<HTMLAudioElement>(null)
  const stageRef = React.useRef<HTMLDivElement>(null)

  const [src, setSrc] = React.useState<string | null>(null)
  const [strip, setStrip] = React.useState<string | null>(null)
  const [duration, setDuration] = React.useState(0)
  const [current, setCurrent] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [volume, setVolume] = React.useState(1)
  const [muted, setMuted] = React.useState(false)
  const [speed, setSpeed] = React.useState(1)
  const [speedOpen, setSpeedOpen] = React.useState(false)
  const [range, setRange] = React.useState<[number, number]>([0, 0])
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<TrimMode | null>(null)
  const [exporting, setExporting] = React.useState(false)
  const [editingTitle, setEditingTitle] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState('')
  const [mix, setMix] = React.useState<AudioMix>(DEFAULT_MIX)

  const micUrl = clip && api ? api.getMicUrl(clip) : null
  const hasLayers = Boolean(micUrl)

  // Load / release the media URL when the clip changes.
  React.useEffect(() => {
    if (!api || !clip) {
      setSrc(null)
      return
    }
    let url: string | null = null
    let cancelled = false
    api.getClipUrl(clip).then((u) => {
      if (cancelled) return api.releaseClipUrl(u)
      url = u
      setSrc(u)
    })
    return () => {
      cancelled = true
      if (url) api.releaseClipUrl(url)
    }
    // sizeBytes changes after an in-place trim and fileName after a rename;
    // either way the URL we hold is stale and has to be rebuilt.
  }, [api, clip?.id, clip?.sizeBytes, clip?.fileName]) // eslint-disable-line react-hooks/exhaustive-deps

  // The scrub strip is rendered by ffmpeg on first open and cached from then on.
  React.useEffect(() => {
    if (!api || !clip) {
      setStrip(null)
      return
    }
    let cancelled = false
    setStrip(null)
    api
      .getFilmstrip(clip.id, 16)
      .then((res) => {
        if (!cancelled) setStrip(res?.url ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [api, clip?.id, clip?.sizeBytes, clip?.fileName]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    setDuration(0)
    setCurrent(0)
    setPlaying(false)
    setEditingTitle(false)
    setSpeed(1)
    setMix(clip?.mix ?? DEFAULT_MIX)
  }, [clip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist the levels shortly after the user stops dragging.
  React.useEffect(() => {
    if (!api || !clip || !hasLayers) return
    const saved = clip.mix ?? DEFAULT_MIX
    const same =
      saved.game === mix.game &&
      saved.mic === mix.mic &&
      saved.gameMuted === mix.gameMuted &&
      saved.micMuted === mix.micMuted
    if (same) return
    const timer = window.setTimeout(() => void api.setMix(clip.id, mix), 600)
    return () => window.clearTimeout(timer)
  }, [api, clip, hasLayers, mix])

  // Apply levels live: master volume scales both layers.
  React.useEffect(() => {
    const master = muted ? 0 : volume
    const v = videoRef.current
    if (v) v.volume = Math.max(0, Math.min(1, (mix.gameMuted ? 0 : mix.game) * master))
    const a = micRef.current
    if (a) a.volume = Math.max(0, Math.min(1, (mix.micMuted ? 0 : mix.mic) * master))
  }, [mix, volume, muted, src, micUrl])

  /**
   * The microphone is a separate file, so it has to be driven off the video:
   * same play state, same position, same rate. A 200 ms drift is corrected
   * silently; anything smaller is inaudible for voice.
   */
  React.useEffect(() => {
    const v = videoRef.current
    const a = micRef.current
    if (!v || !a || !micUrl) return

    const hardSync = () => {
      if (Number.isFinite(v.currentTime)) a.currentTime = v.currentTime
    }
    const softSync = () => {
      if (Math.abs(a.currentTime - v.currentTime) > 0.2) hardSync()
    }
    const onPlay = () => {
      hardSync()
      a.playbackRate = v.playbackRate
      void a.play().catch(() => {})
    }
    const onPause = () => a.pause()
    const onRate = () => {
      a.playbackRate = v.playbackRate
    }

    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', hardSync)
    v.addEventListener('ratechange', onRate)
    v.addEventListener('timeupdate', softSync)
    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('seeked', hardSync)
      v.removeEventListener('ratechange', onRate)
      v.removeEventListener('timeupdate', softSync)
      a.pause()
    }
  }, [micUrl, src])

  React.useEffect(() => {
    const el = videoRef.current
    if (el) el.playbackRate = speed
  }, [speed, src])

  React.useEffect(() => {
    const el = videoRef.current
    if (el) el.volume = volume
  }, [volume, src])

  const onLoaded = () => {
    const el = videoRef.current
    if (!el) return
    const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : clip?.durationSec ?? 0
    setDuration(d)
    setRange([0, d])
  }

  // Loop playback inside the trim selection so you hear exactly what you will keep.
  const onTimeUpdate = () => {
    const el = videoRef.current
    if (!el) return
    setCurrent(el.currentTime)
    // Only loop while actually playing — stepping frame by frame near the end
    // used to snap back to the start of the selection.
    if (!el.paused && el.currentTime >= range[1] - 0.02) {
      el.currentTime = range[0]
      void el.play()
    }
  }

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) {
      if (el.currentTime < range[0] || el.currentTime >= range[1]) el.currentTime = range[0]
      void el.play()
    } else el.pause()
  }

  const seek = (time: number) => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = time
    setCurrent(time)
  }

  /**
   * Nudges one frame. Always pauses first and never resumes: stepping is for
   * looking at a single moment, so playback starting again would fight you.
   */
  const stepFrame = React.useCallback(
    (direction: -1 | 1, big = false) => {
      const el = videoRef.current
      if (!el) return
      el.pause()
      const step = big ? 1 : FRAME_SEC
      const next = Math.min(Math.max(0, el.currentTime + direction * step), duration || el.duration || 0)
      el.currentTime = next
      setCurrent(next)
    },
    [duration],
  )

  // Arrow keys drive the playhead while the viewer is open.
  React.useEffect(() => {
    if (!clip) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Never hijack typing.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        stepFrame(-1, e.shiftKey)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        stepFrame(1, e.shiftKey)
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clip, stepFrame]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFullscreen = () => {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen().catch(() => {})
  }

  const isTrimmed = duration > 0 && (range[0] > 0.05 || range[1] < duration - 0.05)
  const trimmedLength = Math.max(0, range[1] - range[0])

  async function handleTrim(mode: TrimMode) {
    if (!clip) return
    setBusy(mode)
    try {
      videoRef.current?.pause()
      const meta = await trimClip({ id: clip.id, startSec: range[0], endSec: range[1], mode })
      toast.success(mode === 'overwrite' ? t('toast.trimmed') : t('toast.trimmedNew'), { description: meta.title })
      setSaveOpen(false)
      if (mode === 'new') setViewingClipId(meta.id)
    } catch (err) {
      toast.error(t('toast.trimFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete() {
    if (!clip) return
    await deleteClip(clip.id)
    setDeleteOpen(false)
    setViewingClipId(null)
    toast(t('toast.deleted'))
  }

  async function commitTitle() {
    if (!clip) return
    const next = titleDraft.trim()
    setEditingTitle(false)
    if (next && next !== clip.title) await renameClip(clip.id, next)
  }

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <>
      <Dialog open={!!clip} onOpenChange={(o) => !o && setViewingClipId(null)}>
        <DialogContent
          className="flex max-h-[94vh] w-[min(1150px,96vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
          showCloseButton
        >
          {clip && (
            <>
              <DialogHeader className="border-b px-5 py-3.5 text-left">
                <div className="flex items-start justify-between gap-4 pr-8">
                  <div className="flex min-w-0 flex-col gap-1">
                    {editingTitle ? (
                      <Input
                        autoFocus
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={commitTitle}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) commitTitle()
                          if (e.key === 'Escape') setEditingTitle(false)
                        }}
                        className="h-8 w-80"
                        aria-label={t('viewer.title')}
                      />
                    ) : (
                      <DialogTitle className="flex items-center gap-2 text-base">
                        <span className="truncate">{clip.title}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setTitleDraft(clip.title)
                            setEditingTitle(true)
                          }}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label={t('viewer.rename')}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        {isDesktop && (
                          <FileNameEditor
                            fileName={clip.fileName}
                            onRename={(base) => renameClipFile(clip.id, base)}
                          />
                        )}
                      </DialogTitle>
                    )}
                    <DialogDescription className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="size-3.5" aria-hidden />
                        {relativeOf(clip.createdAt)} · {timeLabelOf(clip.createdAt)}
                      </span>
                      {clip.source.app && (
                        <span className="flex items-center gap-1.5">
                          <Gamepad2 className="size-3.5" aria-hidden />
                          {clip.source.app}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5">
                        <Monitor className="size-3.5" aria-hidden />
                        {clip.source.sessionName ?? clip.source.name}
                      </span>
                      <span className="font-mono">
                        {formatDuration(clip.durationSec)} · {formatBytes(clip.sizeBytes)}
                      </span>
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              {/* ---------- stage: video + controls ---------- */}
              <div ref={stageRef} className="clip-stage flex min-h-0 shrink flex-col bg-black">
                <div className="clip-stage-video relative">
                  <video
                    ref={videoRef}
                    src={src ?? undefined}
                    className="mx-auto max-h-[44vh] w-full bg-black object-contain"
                    onLoadedMetadata={onLoaded}
                    onDurationChange={onLoaded}
                    onTimeUpdate={onTimeUpdate}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onClick={togglePlay}
                    muted={muted}
                    playsInline
                  />

                  {micUrl && <audio ref={micRef} src={micUrl} preload="auto" className="hidden" />}

                  <ProgressBar current={current} duration={duration} onSeek={seek} />
                </div>

                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={playing ? t('viewer.pause') : t('viewer.play')}
                    className="flex size-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/10"
                  >
                    {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
                  </button>

                  <span className="font-mono text-xs tabular-nums text-white/80">
                    {formatClock(current)}
                    <span className="mx-1 text-white/35">/</span>
                    {formatClock(duration)}
                  </span>

                  <div className="group/vol flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setMuted((m) => !m)}
                      aria-label={muted ? t('viewer.unmute') : t('viewer.mute')}
                      className="flex size-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/10"
                    >
                      <VolumeIcon className="size-4" />
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={muted ? 0 : volume}
                      onChange={(e) => {
                        setVolume(Number(e.target.value))
                        setMuted(false)
                      }}
                      aria-label={t('viewer.volume')}
                      className="range-signal w-20"
                    />
                  </div>

                  <div className="ml-auto flex items-center gap-1">
                    {speed !== 1 && (
                      <span className="mr-1 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
                        {speed}×
                      </span>
                    )}

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setSpeedOpen((v) => !v)}
                        onBlur={() => window.setTimeout(() => setSpeedOpen(false), 150)}
                        aria-label={t('viewer.speed')}
                        aria-expanded={speedOpen}
                        className="flex size-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/10"
                      >
                        <Settings2 className="size-4" />
                      </button>

                      {speedOpen && (
                        <div className="absolute bottom-10 right-0 z-10 flex min-w-32 flex-col overflow-hidden rounded-lg border bg-popover py-1 shadow-lg">
                          <span className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                            {t('viewer.speed')}
                          </span>
                          {SPEEDS.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setSpeed(s)
                                setSpeedOpen(false)
                              }}
                              className={cn(
                                'px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                                s === speed && 'text-signal',
                              )}
                            >
                              {s}×{s === 1 && <span className="ml-1.5 text-xs text-muted-foreground">normal</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      aria-label={t('viewer.fullscreen')}
                      className="flex size-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/10"
                    >
                      <Maximize2 className="size-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* ---------- timeline + actions ---------- */}
              <div className="flex shrink-0 flex-col gap-3 border-t px-5 py-3.5">
                <TrimBar
                  duration={duration}
                  current={current}
                  range={range}
                  onRangeChange={setRange}
                  onSeek={seek}
                  filmstrip={strip}
                />

                {hasLayers && (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-surface px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">{t('viewer.layers')}</span>
                    <LayerControl
                      icon={Volume2}
                      mutedIcon={VolumeX}
                      label={t('viewer.layerGame')}
                      value={mix.game}
                      muted={mix.gameMuted}
                      onValue={(v) => setMix((m) => ({ ...m, game: v, gameMuted: false }))}
                      onMute={() => setMix((m) => ({ ...m, gameMuted: !m.gameMuted }))}
                    />
                    <LayerControl
                      icon={Mic}
                      mutedIcon={MicOff}
                      label={t('viewer.layerMic')}
                      value={mix.mic}
                      muted={mix.micMuted}
                      onValue={(v) => setMix((m) => ({ ...m, mic: v, micMuted: false }))}
                      onMute={() => setMix((m) => ({ ...m, micMuted: !m.micMuted }))}
                    />
                    <span className="ml-auto text-[11px] text-muted-foreground">{t('viewer.layersHint')}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {isTrimmed && (
                    <span className="flex items-center gap-1.5 font-mono text-xs text-signal">
                      <Scissors className="size-3.5" aria-hidden />
                      {formatTimecode(range[0])} → {formatTimecode(range[1])} ·{' '}
                      {formatDuration(Math.round(trimmedLength))}
                    </span>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setRange([0, duration])} disabled={!isTrimmed}>
                    {t('viewer.reset')}
                  </Button>
                  <Button size="sm" onClick={() => setSaveOpen(true)} disabled={!isTrimmed || trimmedLength < 0.5}>
                    <Scissors data-icon="inline-start" />
                    {t('viewer.saveTrim')}
                  </Button>

                  <Separator orientation="vertical" className="mx-1 h-6" />

                  {isDesktop && (
                    <Button variant="ghost" size="sm" onClick={() => api?.showClipInFolder(clip.id)}>
                      <FolderOpen data-icon="inline-start" />
                      {t('viewer.showInFolder')}
                    </Button>
                  )}
                  {isDesktop && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const okCopy = await api?.copyClipFile(clip.id)
                        if (okCopy) toast.success(t('viewer.copied'))
                        else toast.error(t('viewer.copyFailed'))
                      }}
                    >
                      <ClipboardCopy data-icon="inline-start" />
                      {t('viewer.copyFile')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => api?.exportClip(clip.id)}>
                    <Download data-icon="inline-start" />
                    {isDesktop ? t('viewer.export') : t('viewer.download')}
                  </Button>
                  {isDesktop && clip.format !== 'mp4' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={exporting}
                      onClick={async () => {
                        setExporting(true)
                        try {
                          await api?.exportClip(clip.id, 'mp4')
                        } catch (err) {
                          toast.error(
                            t('toast.exportFailed', { error: err instanceof Error ? err.message : String(err) }),
                          )
                        } finally {
                          setExporting(false)
                        }
                      }}
                    >
                      <FileVideo data-icon="inline-start" />
                      {exporting ? t('viewer.exporting') : t('viewer.exportMp4')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-destructive hover:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 data-icon="inline-start" />
                    {t('viewer.delete')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={saveOpen} onOpenChange={setSaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('viewer.trimTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('viewer.trimBody', {
                from: formatTimecode(range[0]),
                to: formatTimecode(range[1]),
                d: formatDuration(Math.round(trimmedLength)),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>{t('viewer.cancel')}</AlertDialogCancel>
            <Button variant="outline" onClick={() => handleTrim('new')} disabled={!!busy}>
              {busy === 'new' ? t('viewer.saving') : t('viewer.saveAsNew')}
            </Button>
            <AlertDialogAction onClick={() => handleTrim('overwrite')} disabled={!!busy}>
              {busy === 'overwrite' ? t('viewer.trimming') : t('viewer.overwrite')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('viewer.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {isDesktop ? t('viewer.deleteBodyDesktop') : t('viewer.deleteBodyWeb')} {t('viewer.deleteUndo')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('viewer.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              {t('viewer.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
