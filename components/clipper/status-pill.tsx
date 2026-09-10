'use client'

import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useClipper } from '@/lib/clipper/provider'
import { formatDuration } from '@/lib/clipper/hotkeys'

export function StatusPill() {
  const { status, bufferedSeconds, maxBufferSeconds, activeSourceLabel, settings, setPage } = useClipper()
  const armed = status === 'armed' || status === 'saving'
  const defaultHotkey = settings.hotkeys.find((h) => h.isDefault) ?? settings.hotkeys[0]
  const pct = Math.min(100, (bufferedSeconds / maxBufferSeconds) * 100)

  return (
    <button
      type="button"
      onClick={() => setPage('capture')}
      className="flex w-full flex-col gap-2 rounded-lg border bg-surface p-3 text-left transition-colors hover:border-foreground/20"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-full',
            armed ? 'bg-signal pulse-signal' : status === 'starting' ? 'bg-muted-foreground animate-pulse' : 'bg-muted-foreground/40',
          )}
        />
        <span className="font-mono text-[11px] uppercase tracking-wider">
          {status === 'idle' && 'Not armed'}
          {status === 'starting' && 'Starting…'}
          {status === 'armed' && 'Recording buffer'}
          {status === 'saving' && 'Saving clip'}
        </span>
      </div>

      {armed ? (
        <>
          <p className="truncate text-xs text-muted-foreground">{activeSourceLabel}</p>
          <div className="flex flex-col gap-1">
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-signal transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>{Math.floor(bufferedSeconds)}s buffered</span>
              <span>{formatDuration(maxBufferSeconds)}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Arm capture, then press <Kbd>{defaultHotkey?.accelerator}</Kbd> in-game.
        </p>
      )}
    </button>
  )
}
