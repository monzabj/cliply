'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  AppWindow,
  Calendar,
  Clock,
  Download,
  FolderOpen,
  Gamepad2,
  Monitor,
  Pause,
  Pencil,
  Play,
  Scissors,
  Trash2,
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
import { useClipper } from '@/lib/clipper/provider'
import { formatDuration, formatTimecode } from '@/lib/clipper/hotkeys'
import type { TrimMode } from '@/lib/clipper/types'
import { TrimBar } from './trim-bar'
import { dayLabel, formatBytes, timeLabel } from './gallery-page'

export function ClipViewer() {
  const { api, clips, viewingClipId, setViewingClipId, deleteClip, renameClip, trimClip, isDesktop } = useClipper()
  const clip = clips.find((c) => c.id === viewingClipId) ?? null

  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [src, setSrc] = React.useState<string | null>(null)
  const [duration, setDuration] = React.useState(0)
  const [current, setCurrent] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [muted, setMuted] = React.useState(false)
  const [range, setRange] = React.useState<[number, number]>([0, 0])
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<TrimMode | null>(null)
  const [editingTitle, setEditingTitle] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState('')

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
    // sizeBytes changes after an in-place trim, forcing a reload.
  }, [api, clip?.id, clip?.sizeBytes]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    setDuration(0)
    setCurrent(0)
    setPlaying(false)
    setEditingTitle(false)
  }, [clip?.id])

  const onLoaded = () => {
    const el = videoRef.current
    if (!el) return
    const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : clip?.durationSec ?? 0
    setDuration(d)
    setRange([0, d])
  }

  // Loop playback inside the trim selection so the user hears exactly what they will keep.
  const onTimeUpdate = () => {
    const el = videoRef.current
    if (!el) return
    setCurrent(el.currentTime)
    if (el.currentTime >= range[1] - 0.02) {
      el.currentTime = range[0]
      if (!el.paused) void el.play()
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

  const seek = (t: number) => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = t
    setCurrent(t)
  }

  const isTrimmed = duration > 0 && (range[0] > 0.05 || range[1] < duration - 0.05)
  const trimmedLength = Math.max(0, range[1] - range[0])

  async function handleTrim(mode: TrimMode) {
    if (!clip) return
    setBusy(mode)
    try {
      videoRef.current?.pause()
      const meta = await trimClip({ id: clip.id, startSec: range[0], endSec: range[1], mode })
      toast.success(mode === 'overwrite' ? 'Clip trimmed' : 'New trimmed clip saved', { description: meta.title })
      setSaveOpen(false)
      if (mode === 'new') setViewingClipId(meta.id)
    } catch (err) {
      toast.error(`Trim failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete() {
    if (!clip) return
    await deleteClip(clip.id)
    setDeleteOpen(false)
    setViewingClipId(null)
    toast('Clip deleted')
  }

  async function commitTitle() {
    if (!clip) return
    const next = titleDraft.trim()
    setEditingTitle(false)
    if (next && next !== clip.title) await renameClip(clip.id, next)
  }

  const SourceIcon = clip?.source.type === 'screen' ? Monitor : AppWindow

  return (
    <>
      <Dialog open={!!clip} onOpenChange={(o) => !o && setViewingClipId(null)}>
        <DialogContent className="flex max-h-[92vh] w-[min(1100px,96vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none" showCloseButton>
          {clip && (
            <>
              <DialogHeader className="border-b px-5 py-4 text-left">
                <div className="flex items-start justify-between gap-4 pr-8">
                  <div className="flex min-w-0 flex-col gap-1.5">
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
                        aria-label="Clip title"
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
                          aria-label="Rename clip"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </DialogTitle>
                    )}
                    <DialogDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="size-3.5" aria-hidden />
                        {dayLabel(clip.createdAt)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-3.5" aria-hidden />
                        {timeLabel(clip.createdAt)}
                      </span>
                      {clip.source.app && (
                        <span className="flex items-center gap-1.5">
                          <Gamepad2 className="size-3.5" aria-hidden />
                          {clip.source.app}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5">
                        <SourceIcon className="size-3.5" aria-hidden />
                        {clip.source.type === 'screen' ? 'Screen' : 'Window'} · {clip.source.name}
                      </span>
                      <span className="font-mono">
                        {formatDuration(clip.durationSec)} · {formatBytes(clip.sizeBytes)}
                      </span>
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="relative bg-background">
                <video
                  ref={videoRef}
                  src={src ?? undefined}
                  className="mx-auto max-h-[52vh] w-full bg-background object-contain"
                  onLoadedMetadata={onLoaded}
                  onDurationChange={onLoaded}
                  onTimeUpdate={onTimeUpdate}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onClick={togglePlay}
                  muted={muted}
                  playsInline
                />
              </div>

              <div className="flex flex-col gap-3 border-t px-5 py-4">
                <div className="flex items-center gap-3">
                  <Button variant="secondary" size="icon" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                    {playing ? <Pause /> : <Play />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>
                    {muted ? <VolumeX /> : <Volume2 />}
                  </Button>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatTimecode(current)} <span className="opacity-50">/</span> {formatTimecode(duration)}
                  </span>

                  <div className="ml-auto flex items-center gap-2">
                    {isTrimmed && (
                      <span className="flex items-center gap-1.5 font-mono text-xs text-signal">
                        <Scissors className="size-3.5" aria-hidden />
                        {formatTimecode(range[0])} → {formatTimecode(range[1])} · {formatDuration(Math.round(trimmedLength))}
                      </span>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setRange([0, duration])} disabled={!isTrimmed}>
                      Reset
                    </Button>
                    <Button size="sm" onClick={() => setSaveOpen(true)} disabled={!isTrimmed || trimmedLength < 0.5}>
                      <Scissors data-icon="inline-start" />
                      Save trim
                    </Button>
                  </div>
                </div>

                <TrimBar
                  duration={duration}
                  current={current}
                  range={range}
                  onRangeChange={setRange}
                  onSeek={seek}
                  thumbnail={api?.getThumbnailUrl(clip) ?? null}
                />

                <Separator />

                <div className="flex items-center gap-2">
                  {isDesktop && (
                    <Button variant="ghost" size="sm" onClick={() => api?.showClipInFolder(clip.id)}>
                      <FolderOpen data-icon="inline-start" />
                      Show in folder
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => api?.exportClip(clip.id)}>
                    <Download data-icon="inline-start" />
                    {isDesktop ? 'Export copy' : 'Download'}
                  </Button>
                  <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2 data-icon="inline-start" />
                    Delete
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
            <AlertDialogTitle>Save trimmed clip</AlertDialogTitle>
            <AlertDialogDescription>
              Keep {formatTimecode(range[0])} → {formatTimecode(range[1])} ({formatDuration(Math.round(trimmedLength))}
              ). Overwrite this clip, or save the selection as a new clip and keep the original.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={() => handleTrim('new')} disabled={!!busy}>
              {busy === 'new' ? 'Saving…' : 'Save as new clip'}
            </Button>
            <AlertDialogAction onClick={() => handleTrim('overwrite')} disabled={!!busy}>
              {busy === 'overwrite' ? 'Trimming…' : 'Overwrite this clip'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
            <AlertDialogDescription>
              {isDesktop ? 'The file is removed from your clips folder.' : 'The clip is removed from browser storage.'} This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
