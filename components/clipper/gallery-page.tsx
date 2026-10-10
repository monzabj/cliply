'use client'

import * as React from 'react'
import { Film, FolderOpen, Image as ImageIcon, Monitor, Play, Search, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useClipper } from '@/lib/clipper/provider'
import { formatDuration } from '@/lib/clipper/hotkeys'
import type { ClipMeta, LibraryItem, ShotMeta } from '@/lib/clipper/types'
import { toast } from 'sonner'
import { localeTag, useI18n, useT, type ResolvedLanguage } from '@/lib/i18n'
import { ShotViewer } from './shot-viewer'

const SLOT = '[[slot]]'

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function dayLabel(dateString: string, lang: ResolvedLanguage, today_: string, yesterday_: string) {
  const d = new Date(dateString)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return today_
  if (d.toDateString() === yesterday.toDateString()) return yesterday_
  return d.toLocaleDateString(localeTag(lang), { weekday: 'long', month: 'long', day: 'numeric' })
}

export function useDayLabel() {
  const { lang } = useI18n()
  const t = useT()
  return React.useCallback((iso: string) => dayLabel(iso, lang, t('gallery.today'), t('gallery.yesterday')), [lang, t])
}

/**
 * "hace 4 horas" / "ayer" / "2 sep." / "5 oct 2025" — the recent end is what you
 * actually scan for, so it stays relative until it stops being useful.
 */
export function useRelativeDate() {
  const { lang } = useI18n()
  const t = useT()
  return React.useCallback(
    (iso: string) => {
      const then = new Date(iso)
      const now = new Date()
      const diffMin = Math.floor((now.getTime() - then.getTime()) / 60000)

      if (diffMin < 1) return t('date.justNow')
      if (diffMin < 60) return t(diffMin === 1 ? 'date.minute' : 'date.minutes', { n: diffMin })

      const diffH = Math.floor(diffMin / 60)
      const yesterday = new Date(now)
      yesterday.setDate(now.getDate() - 1)

      if (then.toDateString() === now.toDateString()) {
        return t(diffH === 1 ? 'date.hour' : 'date.hours', { n: diffH })
      }
      if (then.toDateString() === yesterday.toDateString()) return t('gallery.yesterday')

      const sameYear = then.getFullYear() === now.getFullYear()
      return then.toLocaleDateString(localeTag(lang), {
        day: 'numeric',
        month: 'short',
        ...(sameYear ? {} : { year: 'numeric' }),
      })
    },
    [lang, t],
  )
}

export function useTimeLabel() {
  const { lang } = useI18n()
  return React.useCallback(
    (iso: string) => new Date(iso).toLocaleTimeString(localeTag(lang), { hour: '2-digit', minute: '2-digit' }),
    [lang],
  )
}

type SortKey = 'date' | 'game' | 'size'
type KindFilter = 'all' | 'clip' | 'shot'

/** Distinct game / monitor a row can be filtered by. */
function sourceKeyOf(item: LibraryItem) {
  return item.source.app || item.source.sessionName || item.source.name || ''
}

export function GalleryPage() {
  const { api, clips, shots, clipsLoading, isDesktop, setViewingClipId, setPage, settings, updateSettings } =
    useClipper()
  const t = useT()
  const dayLabelOf = useDayLabel()
  const [query, setQuery] = React.useState('')
  const [sort, setSort] = React.useState<SortKey>('date')
  const [kind, setKind] = React.useState<KindFilter>('all')
  const [sourceFilter, setSourceFilter] = React.useState<string>('')
  const [viewingShotId, setViewingShotId] = React.useState<string | null>(null)

  // Clips and stills live in one list; `kind` is what tells them apart.
  const library = React.useMemo<LibraryItem[]>(
    () => [
      ...clips.map((c) => ({ ...c, kind: 'clip' as const })),
      ...shots.map((s) => ({ ...s, kind: 'shot' as const })),
    ],
    [clips, shots],
  )

  // Every game and monitor present, for the dropdown.
  const sourceOptions = React.useMemo(() => {
    const games = new Set<string>()
    const screens = new Set<string>()
    for (const item of library) {
      if (item.source.app) games.add(item.source.app)
      const screen = item.source.sessionName || item.source.name
      if (screen) screens.add(screen)
    }
    return { games: [...games].sort(), screens: [...screens].sort() }
  }, [library])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    let base = library

    if (kind !== 'all') base = base.filter((i) => i.kind === kind)
    if (sourceFilter) base = base.filter((i) => sourceKeyOf(i) === sourceFilter)
    if (q) {
      base = base.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.source.name.toLowerCase().includes(q) ||
          (i.source.app ?? '').toLowerCase().includes(q),
      )
    }

    if (sort === 'size') return [...base].sort((a, b) => b.sizeBytes - a.sizeBytes)
    if (sort === 'game')
      return [...base].sort(
        (a, b) => sourceKeyOf(a).localeCompare(sourceKeyOf(b)) || b.createdAt.localeCompare(a.createdAt),
      )
    return [...base].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [library, query, sort, kind, sourceFilter])

  // Day headings only make sense while the list is in chronological order.
  const groups = React.useMemo(() => {
    if (sort !== 'date') return [['', filtered] as const]
    const map = new Map<string, LibraryItem[]>()
    for (const item of filtered) {
      const key = new Date(item.createdAt).toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return [...map.entries()]
  }, [filtered, sort])

  const defaultHotkey = settings.hotkeys.find((h) => h.isDefault) ?? settings.hotkeys[0]
  const totalBytes = library.reduce((a, c) => a + c.sizeBytes, 0)

  const SORTS: { key: SortKey; label: string }[] = [
    { key: 'date', label: t('gallery.sortDate') },
    { key: 'game', label: t('gallery.sortGame') },
    { key: 'size', label: t('gallery.sortSize') },
  ]
  const KINDS: { key: KindFilter; label: string; count: number }[] = [
    { key: 'all', label: t('gallery.kindAll'), count: library.length },
    { key: 'clip', label: t('gallery.kindClips'), count: clips.length },
    { key: 'shot', label: t('gallery.kindShots'), count: shots.length },
  ]

  const hasFilters = kind !== 'all' || Boolean(sourceFilter) || Boolean(query.trim())

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 py-4">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-lg font-semibold tracking-tight">{t('gallery.title')}</h1>
          {library.length > 0 && (
            <span className="font-mono text-xs text-muted-foreground">
              {library.length} · {formatBytes(totalBytes)}
            </span>
          )}
        </div>

        {library.length > 0 && (
          <>
            <div className="flex rounded-lg bg-muted/60 p-0.5">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => setKind(k.key)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
                    kind === k.key ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {k.label}
                  <span className="font-mono opacity-60">{k.count}</span>
                </button>
              ))}
            </div>

            {(sourceOptions.games.length > 0 || sourceOptions.screens.length > 1) && (
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                aria-label={t('gallery.filterSource')}
                className="h-8 max-w-52 rounded-lg border bg-surface px-2 text-xs outline-none transition-colors hover:border-foreground/30 focus-visible:border-ring"
              >
                <option value="">{t('gallery.filterAll')}</option>
                {sourceOptions.games.length > 0 && (
                  <optgroup label={t('gallery.filterGames')}>
                    {sourceOptions.games.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </optgroup>
                )}
                {sourceOptions.screens.length > 0 && (
                  <optgroup label={t('gallery.filterScreens')}>
                    {sourceOptions.screens.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}

            <div className="flex rounded-lg bg-muted/60 p-0.5">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSort(s.key)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs transition-colors',
                    sort === s.key ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {library.length > 0 && (
            <button
              type="button"
              onClick={() => updateSettings({ previewSound: !settings.previewSound })}
              aria-pressed={settings.previewSound}
              title={t('gallery.previewSound')}
              aria-label={t('gallery.previewSound')}
              className={cn(
                'flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-accent',
                settings.previewSound ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {settings.previewSound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>
          )}
          {library.length > 0 && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('gallery.search')}
                className="w-48 pl-8"
                aria-label={t('gallery.searchLabel')}
              />
            </div>
          )}
          {isDesktop && (
            <Button variant="ghost" size="sm" onClick={() => api?.openClipsDir()}>
              <FolderOpen data-icon="inline-start" />
              {t('gallery.openFolder')}
            </Button>
          )}
        </div>
      </div>

      <div className="scroll-y flex-1">
        {!clipsLoading && library.length === 0 && (
          <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Film className="size-6" aria-hidden />
            </div>
            <div className="flex max-w-sm flex-col gap-1.5">
              <h2 className="text-base font-semibold">{t('gallery.empty')}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {(() => {
                  const [before, after] = t('gallery.emptyDesc', {
                    key: SLOT,
                    d: formatDuration(defaultHotkey?.durationSec ?? 30),
                  }).split(SLOT)
                  return (
                    <>
                      {before}
                      <Kbd>{defaultHotkey?.accelerator}</Kbd>
                      {after}
                    </>
                  )
                })()}
              </p>
            </div>
            <Button onClick={() => setPage('capture')} className="bg-signal text-signal-foreground hover:bg-signal/90">
              <Monitor data-icon="inline-start" />
              {t('gallery.goCapture')}
            </Button>
          </div>
        )}

        {library.length > 0 && filtered.length === 0 && (
          <div className="flex min-h-[35vh] flex-col items-center justify-center gap-2 text-center">
            <h2 className="text-sm font-medium">{t('gallery.noMatches')}</h2>
            <p className="text-sm text-muted-foreground">
              {query.trim() ? t('gallery.noMatchesDesc', { q: query }) : t('gallery.noMatchesFilter')}
            </p>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setKind('all')
                  setSourceFilter('')
                  setQuery('')
                }}
              >
                {t('gallery.clearFilters')}
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-7 px-6 pb-8">
          {groups.map(([day, items]) => (
            <section key={day || 'all'} className="flex flex-col gap-3">
              {day && items.length > 0 && (
                <h2 className="flex items-baseline gap-2.5">
                  <span className="text-sm font-medium">{dayLabelOf(items[0].createdAt)}</span>
                  <span className="font-mono text-xs text-muted-foreground">{items.length}</span>
                </h2>
              )}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                {items.map((item) =>
                  item.kind === 'clip' ? (
                    <ClipCard key={item.id} clip={item} onOpen={() => setViewingClipId(item.id)} />
                  ) : (
                    <ShotCard key={item.id} shot={item} onOpen={() => setViewingShotId(item.id)} />
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      </div>

      <ShotViewer shotId={viewingShotId} onClose={() => setViewingShotId(null)} />
    </div>
  )
}

/** A pointer just passing over a card does not start anything for this long. */
const HOVER_INTENT_MS = 150
/** Sound joins a preview only after the pointer has settled on it… */
const PREVIEW_SOUND_DELAY_MS = 400
/** …and fades in, so sweeping across the grid stays quiet. */
const PREVIEW_FADE_MS = 250
const PREVIEW_VOLUME = 0.8

/** The one preview allowed to play; starting another stops it. */
let activePreview: HTMLVideoElement | null = null

function stopPreview(el: HTMLVideoElement) {
  el.pause()
  el.currentTime = 0
  el.muted = true
  if (activePreview === el) activePreview = null
}

function ClipCard({ clip, onOpen }: { clip: ClipMeta; onOpen: () => void }) {
  const { api, deleteClip, renameClip, settings } = useClipper()
  const t = useT()
  const relativeOf = useRelativeDate()
  const thumb = api?.getThumbnailUrl(clip) ?? null

  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [src, setSrc] = React.useState<string | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(clip.title)

  const hovering = React.useRef(false)
  const intentTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const soundTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeFrame = React.useRef<number | null>(null)
  const previewSoundRef = React.useRef(settings.previewSound)
  previewSoundRef.current = settings.previewSound

  const clearTimers = React.useCallback(() => {
    if (intentTimer.current) clearTimeout(intentTimer.current)
    if (soundTimer.current) clearTimeout(soundTimer.current)
    if (fadeFrame.current) cancelAnimationFrame(fadeFrame.current)
    intentTimer.current = soundTimer.current = fadeFrame.current = null
  }, [])

  /** Brings the sound in once the pointer has stayed, with a short fade. */
  const scheduleSound = React.useCallback(() => {
    if (soundTimer.current) clearTimeout(soundTimer.current)
    if (!previewSoundRef.current) return
    soundTimer.current = setTimeout(() => {
      const el = videoRef.current
      if (!el || !hovering.current || activePreview !== el) return
      el.volume = 0
      el.muted = false
      const t0 = performance.now()
      const step = () => {
        if (!hovering.current || activePreview !== el) return
        const k = Math.min(1, (performance.now() - t0) / PREVIEW_FADE_MS)
        el.volume = PREVIEW_VOLUME * k
        fadeFrame.current = k < 1 ? requestAnimationFrame(step) : null
      }
      fadeFrame.current = requestAnimationFrame(step)
    }, PREVIEW_SOUND_DELAY_MS)
  }, [])

  const play = React.useCallback(() => {
    const el = videoRef.current
    if (!el || !hovering.current) return
    if (activePreview && activePreview !== el) stopPreview(activePreview)
    activePreview = el
    // Always starts silent; scheduleSound decides whether and when it is heard.
    el.muted = true
    el.volume = 0
    void el
      .play()
      .then(() => {
        if (!hovering.current) return stopPreview(el)
        setPlaying(true)
        scheduleSound()
      })
      .catch(() => setPlaying(false))
  }, [scheduleSound])

  // The file is only fetched once the pointer has settled on the card, so a
  // library of hundreds costs nothing until you actually look at one.
  const onEnter = React.useCallback(() => {
    hovering.current = true
    clearTimers()
    intentTimer.current = setTimeout(async () => {
      if (!hovering.current || !api) return
      if (src) return play()
      const url = await api.getPreviewUrl(clip)
      if (hovering.current && url) setSrc(url)
    }, HOVER_INTENT_MS)
  }, [api, clip, src, play, clearTimers])

  const onLeave = React.useCallback(() => {
    hovering.current = false
    clearTimers()
    const el = videoRef.current
    if (el) stopPreview(el)
    setPlaying(false)
  }, [clearTimers])

  React.useEffect(
    () => () => {
      clearTimers()
      const el = videoRef.current
      if (el && activePreview === el) activePreview = null
    },
    [clearTimers],
  )

  const onContextMenu = React.useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      const action = await api?.clipMenu(clip.id)
      if (action === 'delete') {
        await deleteClip(clip.id)
        toast(t('toast.deleted'))
      }
    },
    [api, clip.id, deleteClip, t],
  )

  // First hover: the URL just arrived and the <video> mounted with it.
  React.useEffect(() => {
    if (src) play()
  }, [src, play])

  // Keep an already-running preview in step with the sound toggle.
  React.useEffect(() => {
    const el = videoRef.current
    if (!el || activePreview !== el) return
    if (settings.previewSound) scheduleSound()
    else el.muted = true
  }, [settings.previewSound, scheduleSound])

  React.useEffect(() => setDraft(clip.title), [clip.title])

  async function commitRename() {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== clip.title) await renameClip(clip.id, next)
  }

  return (
    <div
      className="group flex flex-col gap-2"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        onClick={onOpen}
        onFocus={onEnter}
        onBlur={onLeave}
        aria-label={clip.title}
        className="relative aspect-video overflow-hidden rounded-xl border tile-empty outline-none transition-colors group-hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            className={cn('size-full object-cover transition-opacity duration-200', playing && 'opacity-0')}
          />
        )}
        {src && (
          <video
            ref={videoRef}
            src={src}
            loop
            playsInline
            muted
            preload="auto"
            className={cn(
              'absolute inset-0 size-full object-cover transition-opacity duration-200',
              playing ? 'opacity-100' : 'opacity-0',
            )}
          />
        )}

        <span className="absolute inset-0 flex items-center justify-center bg-background/0 transition-colors group-hover:bg-background/20">
          <span
            className={cn(
              'flex size-11 scale-90 items-center justify-center rounded-full bg-signal text-signal-foreground transition-all duration-200',
              playing ? 'opacity-0' : 'opacity-0 group-hover:scale-100 group-hover:opacity-100',
            )}
          >
            <Play className="ml-0.5 size-4 fill-current" aria-hidden />
          </span>
        </span>

        {playing && settings.previewSound && (
          <span className="absolute left-2 top-2 flex size-6 items-center justify-center rounded bg-background/85 text-muted-foreground backdrop-blur">
            <Volume2 className="size-3.5" aria-hidden />
          </span>
        )}

        <span className="absolute bottom-2 right-2 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[11px] backdrop-blur">
          {formatDuration(clip.durationSec)}
        </span>

        {clip.format === 'mp4' && !playing && (
          <span className="absolute bottom-2 left-2 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground backdrop-blur">
            mp4
          </span>
        )}
      </button>

      <div className="flex flex-col gap-1 px-0.5">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) void commitRename()
              if (e.key === 'Escape') {
                setDraft(clip.title)
                setEditing(false)
              }
            }}
            className="h-7 text-sm"
            aria-label={t('viewer.title')}
          />
        ) : (
          <p
            className="cursor-text truncate text-sm font-medium"
            title={`${clip.title}
${t('gallery.renameHint')}`}
            onDoubleClick={() => setEditing(true)}
          >
            {clip.title}
          </p>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Monitor className="size-3 shrink-0" aria-hidden />
          <span className="shrink-0 truncate" title={clip.source.name}>
            {clip.source.sessionName ?? clip.source.name}
          </span>
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">{formatBytes(clip.sizeBytes)}</span>
          <span aria-hidden>·</span>
          <span className="truncate" title={new Date(clip.createdAt).toLocaleString()}>
            {relativeOf(clip.createdAt)}
          </span>
        </div>
      </div>
    </div>
  )
}

function ShotCard({ shot, onOpen }: { shot: ShotMeta; onOpen: () => void }) {
  const { api, deleteShot, renameShot } = useClipper()
  const t = useT()
  const relativeOf = useRelativeDate()
  const thumb = api?.getShotThumbUrl(shot) ?? null
  const full = api?.getShotUrl(shot) ?? null

  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(shot.title)
  React.useEffect(() => setDraft(shot.title), [shot.title])

  async function commitRename() {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== shot.title) await renameShot(shot.id, next)
  }

  return (
    <div
      className="group flex flex-col gap-2"
      onContextMenu={async (e) => {
        e.preventDefault()
        // Stills have no native menu of their own yet; the essentials live here.
        const copied = await api?.copyShotFile(shot.id)
        if (copied) toast.success(t('viewer.copied'))
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={shot.title}
        className="relative aspect-video overflow-hidden rounded-xl border tile-empty outline-none transition-colors group-hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {(thumb || full) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb ?? full ?? ''} alt="" className="size-full object-cover" />
        )}
        <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground backdrop-blur">
          <ImageIcon className="size-3" aria-hidden />
          png
        </span>
        <span className="absolute bottom-2 right-2 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[11px] backdrop-blur">
          {shot.width}×{shot.height}
        </span>
      </button>

      <div className="flex flex-col gap-1 px-0.5">
        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) void commitRename()
              if (e.key === 'Escape') {
                setDraft(shot.title)
                setEditing(false)
              }
            }}
            className="h-7 text-sm"
            aria-label={t('viewer.title')}
          />
        ) : (
          <p
            className="cursor-text truncate text-sm font-medium"
            title={`${shot.title}
${t('gallery.renameHint')}`}
            onDoubleClick={() => setEditing(true)}
          >
            {shot.title}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Monitor className="size-3 shrink-0" aria-hidden />
          <span className="shrink-0 truncate">{shot.source.sessionName ?? shot.source.name}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">{formatBytes(shot.sizeBytes)}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{relativeOf(shot.createdAt)}</span>
        </div>
      </div>
    </div>
  )
}
