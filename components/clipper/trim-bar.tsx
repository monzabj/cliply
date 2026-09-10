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
  thumbnail?: string | null
}

type Handle = 'start' | 'end' | 'scrub'

const MIN_LEN = 0.5

/**
 * Timeline with draggable in/out handles. The kept region is shown in full color,
 * the discarded regions are dimmed. Click the track to seek; drag the edges to trim.
 */
export function TrimBar({ duration, current, range, onRangeChange, onSeek, thumbnail }: TrimBarProps) {
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

  const ticks = React.useMemo(() => {
    if (duration <= 0) return []
    const step = duration <= 20 ? 1 : duration <= 60 ? 5 : duration <= 180 ? 15 : 30
    const out: number[] = []
    for (let t = 0; t <= duration; t += step) out.push(t)
    return out
  }, [duration])

  return (
    <div className="flex flex-col gap-1.5 select-none">
      <div
        ref={trackRef}
        role="presentation"
        onPointerDown={beginDrag('scrub')}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          'relative h-16 w-full touch-none overflow-hidden rounded-md border bg-muted',
          dragging === 'scrub' ? 'cursor-grabbing' : 'cursor-pointer',
        )}
      >
        {thumbnail && (
          <div
            aria-hidden
            className="absolute inset-0 opacity-60"
            style={{ backgroundImage: `url(${thumbnail})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }}
          />
        )}
        {/* Dimmed, discarded regions */}
        <div className="absolute inset-y-0 left-0 bg-background/75" style={{ width: `${pct(range[0])}%` }} aria-hidden />
        <div className="absolute inset-y-0 right-0 bg-background/75" style={{ width: `${100 - pct(range[1])}%` }} aria-hidden />

        {/* Kept region outline */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 border-y-2 border-signal"
          style={{ left: `${pct(range[0])}%`, width: `${pct(range[1]) - pct(range[0])}%` }}
        />

        {/* Playhead */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
          style={{ left: `${pct(current)}%` }}
        >
          <div className="absolute -left-[3px] -top-px size-[7px] rounded-b-sm bg-foreground" />
        </div>

        <TrimHandle
          side="start"
          value={range[0]}
          left={pct(range[0])}
          duration={duration}
          onPointerDown={beginDrag('start')}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onKeyDown={keyHandler('start')}
        />
        <TrimHandle
          side="end"
          value={range[1]}
          left={pct(range[1])}
          duration={duration}
          onPointerDown={beginDrag('end')}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onKeyDown={keyHandler('end')}
        />
      </div>

      <div className="relative h-4 font-mono text-[10px] text-muted-foreground">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${pct(t)}%` }}
          >
            {formatTimecode(t).replace(/\.\d$/, '')}
          </span>
        ))}
      </div>
    </div>
  )
}

function TrimHandle({
  side,
  value,
  left,
  duration,
  ...handlers
}: {
  side: 'start' | 'end'
  value: number
  left: number
  duration: number
} & Pick<React.HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onKeyDown'>) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={side === 'start' ? 'Trim start' : 'Trim end'}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={value}
      aria-valuetext={formatTimecode(value)}
      {...handlers}
      className={cn(
        'absolute inset-y-0 flex w-3 cursor-ew-resize items-center justify-center bg-signal text-signal-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
        side === 'start' ? '-translate-x-full rounded-l-md' : 'rounded-r-md',
      )}
      style={{ left: `${left}%` }}
    >
      <span aria-hidden className="h-5 w-0.5 rounded-full bg-signal-foreground/70" />
      <span
        aria-hidden
        className={cn(
          'absolute -top-0 rounded bg-signal px-1 py-0.5 font-mono text-[10px] leading-none',
          side === 'start' ? 'right-full mr-1' : 'left-full ml-1',
        )}
      >
        {formatTimecode(value)}
      </span>
    </div>
  )
}
