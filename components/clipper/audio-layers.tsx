'use client'

import * as React from 'react'
import { ChevronRight, Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { AppAudioTrack, AudioMix, ClipMeta } from '@/lib/clipper/types'
import type { ClipperAPI } from '@/lib/clipper/api'

type Source = { id: string; url: string; mic?: boolean }
type Graph = { context: AudioContext; source: MediaElementAudioSourceNode; gain: GainNode }
// A media element can be wrapped only once, even when React reuses the video
// across clips. Disconnected graphs are weakly held; one context serves playback.
let playbackContext: AudioContext | null = null
const graphs = new WeakMap<HTMLMediaElement, Graph>()
function graphFor(media: HTMLMediaElement): Graph {
  const existing = graphs.get(media)
  if (existing) return existing
  const context = playbackContext ??= new AudioContext()
  const source = context.createMediaElementSource(media), gain = context.createGain()
  source.connect(gain)
  const graph = { context, source, gain }; graphs.set(media, graph)
  return graph
}

function LayerControl({ label, value, muted, mic = false, disabled = false, onValue, onMute }: {
  label: string; value: number; muted: boolean; mic?: boolean; disabled?: boolean
  onValue: (v: number) => void; onMute: () => void
}) {
  const Icon = mic ? muted ? MicOff : Mic : muted ? VolumeX : Volume2
  return <div className={cn('flex shrink-0 items-center gap-2', disabled && 'opacity-40')}>
    <button type="button" onClick={onMute} disabled={disabled} aria-label={label} aria-pressed={muted}
      className={cn('flex size-7 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring', muted && 'text-destructive')}>
      <Icon className="size-4" aria-hidden />
    </button>
    <span className={cn('max-w-36 truncate text-xs', muted && 'line-through')} title={label}>{label}</span>
    <input type="range" min={0} max={1.5} step={0.05} value={muted ? 0 : value} disabled={disabled}
      onChange={e => onValue(Number(e.target.value))} aria-label={label} className="range-signal w-24" />
    <span className="w-10 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{Math.round((muted ? 0 : value) * 100)}%</span>
  </div>
}

export function AudioLayers({ clip, api, mix, setMix, videoRef, src, volume, muted }: {
  clip: ClipMeta; api: ClipperAPI; mix: AudioMix; setMix: React.Dispatch<React.SetStateAction<AudioMix>>
  videoRef: React.RefObject<HTMLVideoElement | null>; src: string | null; volume: number; muted: boolean
}) {
  const t = useT(), region = React.useId()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = React.useState(false)
  const players = React.useRef<Array<{ source: Source; media: HTMLAudioElement; graph: Graph }>>([])
  const videoGraph = React.useRef<Graph | null>(null)
  const levels = React.useRef({ mix, volume, muted }); levels.current = { mix, volume, muted }
  const appSignature = JSON.stringify(clip.audioApps ?? [])
  const apps = React.useMemo(() => JSON.parse(appSignature) as AppAudioTrack[], [appSignature])
  const sourceSignature = (() => {
    const result: Source[] = []
    const micUrl = api.getMicUrl(clip)
    if (micUrl) result.push({ id: 'microphone', url: micUrl, mic: true })
    for (const track of apps ?? []) { const url = api.getAppAudioUrl(track.file,clip); if (url) result.push({ id: track.id, url }) }
    return JSON.stringify(result)
  })()
  const sources = React.useMemo(() => JSON.parse(sourceSignature) as Source[], [sourceSignature])

  const apply = React.useCallback(() => {
    const { mix: m, volume: master, muted: silent } = levels.current
    const volume = silent ? 0 : master, computer = m.gameMuted ? 0 : m.game
    const isolated = (apps ?? []).some(a => (m.apps?.[a.id]?.volume ?? 1) !== 1 || m.apps?.[a.id]?.muted === true)
    if (videoGraph.current) videoGraph.current.gain.gain.value = isolated ? 0 : computer * volume
    for (const p of players.current) {
      const layer = m.apps?.[p.source.id]
      p.graph.gain.gain.value = volume * (p.source.mic ? m.micMuted ? 0 : m.mic : isolated ? computer * (layer?.muted ? 0 : layer?.volume ?? 1) : 0)
      const video = videoRef.current
      if (!p.source.mic && !isolated) p.media.pause()
      else if (video && !video.paused && p.media.paused) { p.media.currentTime = video.currentTime; p.media.playbackRate = video.playbackRate; void p.media.play().catch(() => {}) }
    }
  }, [apps, videoRef])

  React.useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return
    const graph = graphFor(video); videoGraph.current = graph
    graph.gain.connect(graph.context.destination); video.volume = 1
    const owned = sources.map(source => {
      const media = new Audio(); media.crossOrigin = 'anonymous'; media.preload = 'auto'; media.src = source.url
      media.dataset.audioLayer = source.id
      const g = graphFor(media); g.gain.connect(g.context.destination)
      return { source, media, graph: g }
    })
    players.current = owned; apply()
    let disposed = false
    const sync = () => { for (const p of owned) if (p.media.readyState && Number.isFinite(video.currentTime)) p.media.currentTime = Math.min(video.currentTime, Number.isFinite(p.media.duration) ? p.media.duration : video.currentTime) }
    const play = () => { void graph.context.resume().catch(() => {}); sync(); for (const p of owned) { p.media.playbackRate = video.playbackRate; const m = levels.current.mix; const isolated = (apps ?? []).some(a => (m.apps?.[a.id]?.volume ?? 1) !== 1 || m.apps?.[a.id]?.muted === true); if (p.source.mic || isolated) void p.media.play().catch(() => {}) } }
    const pause = () => { for (const p of owned) p.media.pause() }
    const rate = () => { for (const p of owned) p.media.playbackRate = video.playbackRate }
    const drift = () => { for (const p of owned) if (!p.media.paused && p.media.readyState && Math.abs(p.media.currentTime - video.currentTime) > .08) p.media.currentTime = video.currentTime }
    for (const p of owned) p.media.onloadedmetadata = () => { if (disposed) return; sync(); rate(); if (!video.paused) play() }
    video.addEventListener('play', play); video.addEventListener('pause', pause); video.addEventListener('waiting', pause)
    video.addEventListener('playing', play); video.addEventListener('seeked', sync); video.addEventListener('ratechange', rate); video.addEventListener('timeupdate', drift)
    if (!video.paused) play()
    return () => {
      disposed = true; pause()
      video.removeEventListener('play', play); video.removeEventListener('pause', pause); video.removeEventListener('waiting', pause)
      video.removeEventListener('playing', play); video.removeEventListener('seeked', sync); video.removeEventListener('ratechange', rate); video.removeEventListener('timeupdate', drift)
      for (const p of owned) { p.media.onloadedmetadata = null; p.graph.source.disconnect(); p.graph.gain.disconnect(); p.media.removeAttribute('src'); p.media.load() }
      graph.gain.disconnect(); players.current = []; videoGraph.current = null
    }
  }, [src, sources, apply, videoRef])
  React.useEffect(() => { apply() }, [mix, volume, muted, apply])
  React.useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || !expanded) return
    const wheel = (e: WheelEvent) => {
      if (scroller.scrollWidth <= scroller.clientWidth || !e.deltaY || e.deltaX) return
      const before = scroller.scrollLeft; scroller.scrollLeft += e.deltaY
      if (scroller.scrollLeft !== before) e.preventDefault()
    }
    scroller.addEventListener('wheel', wheel, { passive: false })
    return () => scroller.removeEventListener('wheel', wheel)
  }, [expanded])

  const changeApp = (id: string, patch: { volume?: number; muted?: boolean }) => setMix(m => ({ ...m, apps: { ...m.apps, [id]: { volume: m.apps?.[id]?.volume ?? 1, muted: m.apps?.[id]?.muted ?? false, ...patch } } }))
  return <div className="space-y-1">
    <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border bg-surface/50 px-3 py-2" data-audio-mixer>
      <span className="shrink-0 text-xs text-muted-foreground">{t('viewer.layers')}</span>
      <LayerControl label={t('viewer.layerMic')} mic value={mix.mic} muted={mix.micMuted} disabled={!clip.micFile}
        onValue={v => setMix(m => ({ ...m, mic: v, micMuted: false }))} onMute={() => setMix(m => ({ ...m, micMuted: !m.micMuted }))} />
      <LayerControl label={t('viewer.layerGame')} value={mix.game} muted={mix.gameMuted}
        onValue={v => setMix(m => ({ ...m, game: v, gameMuted: false }))} onMute={() => setMix(m => ({ ...m, gameMuted: !m.gameMuted }))} />
      {!!apps?.length && <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} aria-controls={region}
        aria-label={t('viewer.expandApps')} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} aria-hidden />{apps.length} apps
      </button>}
      <div ref={scrollRef} id={region} hidden={!expanded || !apps?.length} className="min-w-0 flex-1 basis-72 overflow-x-auto pb-1" tabIndex={expanded ? 0 : -1} role="region" aria-label={t('viewer.appVolumes')}
        onKeyDown={e => { if (e.key.startsWith('Arrow')) e.stopPropagation() }}>
        <div className="flex w-max items-center gap-5 px-1">{apps?.map(app => <LayerControl key={app.id} label={app.name}
          value={mix.apps?.[app.id]?.volume ?? 1} muted={mix.apps?.[app.id]?.muted ?? false}
          onValue={v => changeApp(app.id, { volume: v, muted: false })} onMute={() => changeApp(app.id, { muted: !mix.apps?.[app.id]?.muted })} />)}</div>
      </div>
      {!expanded && <span className="ml-auto text-[11px] text-muted-foreground">{t('viewer.layersHint')}</span>}
    </div>
    {clip.audioWarning && <p role="status" className="text-xs text-amber-400">{clip.audioWarning}</p>}
  </div>
}
