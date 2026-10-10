'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/clipper/hotkeys'

interface TrimBarProps {
  duration: number
  current: number
  range: [number, number]
  onRangeChange: (r: [number, number]) => void
  onSeek: (t: number) => void
  /** Horizontal strip of evenly spaced frames covering the whole clip. */
  filmstrip?: string | null
}

type Handle = 'start' | 'end' | 'scrub'

const MIN_LEN = 0.5
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300]

/** Tick spacing that yields roughly six labels, on a round number of seconds. */
function tickStep(duration: number) {
  const ideal = duration / 6
  return STEPS.find((s) => s >= ideal) ?? STEPS[STEPS.length - 1]
}

/**
 * Scrubbing timeline: a filmstrip of the clip with a ruler above it and draggable
 * in/out handles. What you keep stays lit; what you cut is dimmed.
 */
export function TrimBar({ duration, current, range, onRangeChange, onSeek, filmstrip }: TrimBarProps) {
  const trackRef = React.useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = React.useState<Handle | null>(null)

  const pct = (t: number) => (duration > 0 ? (Math.min(Math.max(t, 0), duration) / duration) * 100 : 0)

  const timeFromClientX = React.useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || duration <= 0) return 0
      const rect = el.getBoundingClientRect()
      const x = Math.min(Math.max(clientX - rect.left, 0), rect.width)
      return (x / rect.width) * duration
    },
    [duration],
  )

  const beginDrag = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Synthetic or already-released pointers cannot be captured; dragging still works via bubbling.
    }
    setDragging(handle)
    if (handle === 'scrub') onSeek(timeFromClientX(e.clientX))
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const t = timeFromClientX(e.clientX)
    if (dragging === 'start') {
      const next = Math.min(t, range[1] - MIN_LEN)
      onRangeChange([Math.max(0, next), range[1]])
      onSeek(Math.max(0, next))
    } else if (dragging === 'end') {
      const next = Math.max(t, range[0] + MIN_LEN)
      onRangeChange([range[0], Math.min(duration, next)])
      onSeek(Math.min(duration, next))
    } else {
      onSeek(t)
    }
  }

  const endDrag = () => setDragging(null)

  const nudge = (handle: 'start' | 'end', delta: number) => {
    if (handle === 'start') {
      const next = Math.min(Math.max(0, range[0] + delta), range[1] - MIN_LEN)
      onRangeChange([next, range[1]])
      onSeek(next)
    } else {
      const next = Math.max(Math.min(duration, range[1] + delta), range[0] + MIN_LEN)
      onRangeChange([range[0], next])
      onSeek(next)
    }
  }

  const keyHandler = (handle: 'start' | 'end') => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      nudge(handle, -step)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      nudge(handle, step)
    }
  }

  const step = tickStep(duration || 30)
  const ticks: number[] = []
  for (let t = 0; t <= duration + 0.001; t += step) ticks.push(t)

  return (
    <div className="flex flex-col gap-1 select-none">
      {/* ruler */}
      <div className="relative h-4">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-muted-foreground tabular-nums"
            style={{ left: `${pct(t)}%` }}
          >
            {formatRulerTime(t)}
          </span>
        ))}
      </div>

      {/* filmstrip + handles */}
      <div
        ref={trackRef}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={(e) => {
          // Pointer capture keeps events coming, but a stray leave without a
          // button held means the drag is over.
          if (dragging && e.buttons === 0) endDrag()
        }}
        className={cn('relative my-1 h-16 touch-none rounded-lg border bg-muted', dragging && 'select-none')}
      >
        <div
          onPointerDown={beginDrag('scrub')}
          className="absolute inset-0 overflow-hidden rounded-lg cursor-pointer"
          style={
            filmstrip
              ? {
                  backgroundImage: `url("${filmstrip}")`,
                  backgroundSize: '100% 100%',
                  backgroundRepeat: 'no-repeat',
                }
              : undefined
          }
        />

        {/* what gets cut away, pushed back */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-background/78"
          style={{ width: `${pct(range[0])}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-background/78"
          style={{ width: `${100 - pct(range[1])}%` }}
        />

        {/* the kept region reads as one framed block, like a film gate */}
        <div
          className="pointer-events-none absolute inset-y-0 rounded-[3px] border-y-[3px] border-white/90"
          style={{ left: `${pct(range[0])}%`, width: `${Math.max(0, pct(range[1]) - pct(range[0]))}%` }}
        />

        {/* playhead, with a grab handle you can drag from anywhere on the bar */}
        <div
          onPointerDown={beginDrag('scrub')}
          className={cn(
            'absolute -inset-y-1 z-10 w-[3px] rounded-full bg-signal',
            dragging === 'scrub' ? 'cursor-grabbing' : 'cursor-grab',
          )}
          style={{ left: `calc(${pct(current)}% - 1.5px)` }}
        >
          <span
            className={cn(
              'absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal',
              'border-2 border-background shadow-[0_0_8px_-1px] shadow-signal/80 transition-transform',
              dragging === 'scrub' ? 'scale-125' : 'hover:scale-110',
            )}
            aria-hidden
          />
        </div>

        <Handle side="start" left={pct(range[0])} onPointerDown={beginDrag('start')} onKeyDown={keyHandler('start')} time={range[0]} />
        <Handle side="end" left={pct(range[1])} onPointerDown={beginDrag('end')} onKeyDown={keyHandler('end')} time={range[1]} />
      </div>
    </div>
  )
}

function Handle({
  side,
  left,
  time,
  onPointerDown,
  onKeyDown,
}: {
  side: 'start' | 'end'
  left: number
  time: number
  onPointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  return (
    <button
      type="button"
      role="slider"
      tabIndex={0}
      aria-label={side === 'start' ? 'Inicio' : 'Fin'}
      aria-valuetext={formatTimecode(time)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        'group/handle absolute -inset-y-1 z-20 flex w-4 cursor-ew-resize items-center justify-center',
        'rounded-md bg-white outline-none shadow-md transition-transform hover:scale-y-105',
        side === 'start' ? '-translate-x-full' : '',
        'focus-visible:ring-2 focus-visible:ring-ring',
      )}
      style={{ left: `${left}%` }}
    >
      {/* grip: two hairlines, so the handle reads as draggable at a glance */}
      <span className="flex gap-[3px]" aria-hidden>
        <span className="h-4 w-px rounded-full bg-black/45" />
        <span className="h-4 w-px rounded-full bg-black/45" />
      </span>
    </button>
  )
}

function formatRulerTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
