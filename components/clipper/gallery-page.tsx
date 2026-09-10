'use client'

import * as React from 'react'
import { AppWindow, Clock, Film, FolderOpen, Gamepad2, Monitor, Play, Radio, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Kbd } from '@/components/ui/kbd'
import { useClipper } from '@/lib/clipper/provider'
import { formatDuration } from '@/lib/clipper/hotkeys'
import type { ClipMeta } from '@/lib/clipper/types'
import { PageHeader } from './page-header'

function groupByDay(clips: ClipMeta[]) {
  const groups = new Map<string, ClipMeta[]>()
  for (const clip of clips) {
    const key = new Date(clip.createdAt).toDateString()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(clip)
  }
  return [...groups.entries()]
}

export function dayLabel(dateString: string) {
  const d = new Date(dateString)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function GalleryPage() {
  const { api, clips, clipsLoading, isDesktop, setViewingClipId, setPage, settings } = useClipper()
  const [query, setQuery] = React.useState('')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clips
    return clips.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.source.name.toLowerCase().includes(q) ||
        (c.source.app ?? '').toLowerCase().includes(q),
    )
  }, [clips, query])

  const groups = groupByDay(filtered)
  const defaultHotkey = settings.hotkeys.find((h) => h.isDefault) ?? settings.hotkeys[0]

  return (
    <>
      <PageHeader
        title="Clips"
        description={`${clips.length} clip${clips.length === 1 ? '' : 's'} · ${formatBytes(clips.reduce((a, c) => a + c.sizeBytes, 0))} on disk`}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search game, window, title…"
                className="w-64 pl-8"
                aria-label="Search clips"
              />
            </div>
            {isDesktop && (
              <Button variant="outline" onClick={() => api?.openClipsDir()}>
                <FolderOpen data-icon="inline-start" />
                Open folder
              </Button>
            )}
          </>
        }
      />

      <ScrollArea className="flex-1">
        {!clipsLoading && clips.length === 0 && (
          <Empty className="min-h-[60vh]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Film />
              </EmptyMedia>
              <EmptyTitle>No clips yet</EmptyTitle>
              <EmptyDescription>
                Arm the capture on a screen or window, then press <Kbd>{defaultHotkey?.accelerator}</Kbd> while you
                play to save the last {formatDuration(defaultHotkey?.durationSec ?? 30)}.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setPage('capture')}>
                <Radio data-icon="inline-start" />
                Go to capture
              </Button>
            </EmptyContent>
          </Empty>
        )}

        {clips.length > 0 && filtered.length === 0 && (
          <Empty className="min-h-[40vh]">
            <EmptyHeader>
              <EmptyTitle>No matches</EmptyTitle>
              <EmptyDescription>Nothing matches &ldquo;{query}&rdquo;.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <div className="flex flex-col gap-8 p-6">
          {groups.map(([day, dayClips]) => (
            <section key={day} className="flex flex-col gap-3">
              <h2 className="flex items-baseline gap-3">
                <span className="text-sm font-medium">{dayLabel(dayClips[0].createdAt)}</span>
                <span className="font-mono text-xs text-muted-foreground">{dayClips.length}</span>
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                {dayClips.map((clip) => (
                  <ClipCard key={clip.id} clip={clip} onOpen={() => setViewingClipId(clip.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </ScrollArea>
    </>
  )
}

function ClipCard({ clip, onOpen }: { clip: ClipMeta; onOpen: () => void }) {
  const { api } = useClipper()
  const thumb = api?.getThumbnailUrl(clip) ?? null
  const SourceIcon = clip.source.type === 'screen' ? Monitor : AppWindow

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-2.5 rounded-lg border bg-surface p-2 text-left transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-muted grid-scan">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <Film className="size-6" aria-hidden />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-background/0 transition-colors group-hover:bg-background/40">
          <span className="flex size-10 items-center justify-center rounded-full bg-signal text-signal-foreground opacity-0 transition-opacity group-hover:opacity-100">
            <Play className="ml-0.5 size-4 fill-current" aria-hidden />
          </span>
        </div>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[11px] backdrop-blur">
          {formatDuration(clip.durationSec)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 px-0.5 pb-0.5">
        <p className="truncate text-sm font-medium" title={clip.title}>
          {clip.title}
        </p>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex shrink-0 items-center gap-1 font-mono tabular-nums">
              <Clock className="size-3" aria-hidden />
              {timeLabel(clip.createdAt)}
            </span>
            {clip.source.app && (
              <span className="flex min-w-0 items-center gap-1">
                <Gamepad2 className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{clip.source.app}</span>
              </span>
            )}
          </div>
          <span className="flex min-w-0 items-center gap-1">
            <SourceIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">
              {clip.source.type === 'screen' ? 'Screen' : 'Window'} · {clip.source.name}
            </span>
          </span>
        </div>
      </div>
    </button>
  )
}
