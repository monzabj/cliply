'use client'

import * as React from 'react'
import { Gamepad2, Power, Scissors, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useClipper } from '@/lib/clipper/provider'
import { formatDuration } from '@/lib/clipper/hotkeys'
import { useT } from '@/lib/i18n'

/**
 * Always-visible state: what is being recorded, which game is in front, and one
 * control to start or stop. Everything else in the app is secondary to this.
 */
export function TopBar() {
  const {
    status,
    armedCount,
    bufferedSeconds,
    maxBufferSeconds,
    currentGame,
    settings,
    sessions,
    armAll,
    disarmAll,
    clipNow,
    setPage,
    hotkeyFailures,
    openLog,
  } = useClipper()
  const t = useT()

  const armed = status === 'armed' || status === 'saving'
  const busy = status === 'starting'
  const pct = Math.min(100, (bufferedSeconds / maxBufferSeconds) * 100)
  const ready = settings.sessions.filter((s) => s.source).length
  const primary = settings.hotkeys.find((h) => h.isDefault) ?? settings.hotkeys[0]

  return (
    <>
      {hotkeyFailures.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-5 py-2 text-xs text-foreground">
          <TriangleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />
          <span className="min-w-0 flex-1">{t('top.hotkeyFailed', { keys: hotkeyFailures.join(', ') })}</span>
          <button type="button" onClick={openLog} className="shrink-0 underline underline-offset-2 hover:no-underline">
            {t('top.openLog')}
          </button>
        </div>
      )}
      <header className="relative flex h-16 shrink-0 items-center gap-4 border-b bg-surface/60 px-5">
      {/* recording state */}
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'size-2.5 shrink-0 rounded-full transition-colors',
            armed ? 'bg-signal pulse-signal rec-dot' : busy ? 'animate-pulse bg-muted-foreground' : 'bg-muted-foreground/35',
          )}
        />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-medium">
            {armed
              ? armedCount > 1
                ? t('top.recordingN', { n: armedCount })
                : t('top.recording')
              : busy
                ? t('capture.starting')
                : t('top.idle')}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {armed
              ? sessions
                  .filter((s) => s.status !== 'idle')
                  .map((s) => s.sourceLabel ?? s.name)
                  .join(' · ')
              : ready
                ? t('top.readyWith', { n: ready })
                : t('top.nothingPicked')}
          </span>
        </div>
      </div>

      {/* detected game */}
      <div
        className={cn(
          'ml-2 flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
          currentGame ? 'border-signal/30 bg-signal/10 text-foreground' : 'border-transparent bg-muted/50 text-muted-foreground',
        )}
        title={currentGame ?? undefined}
      >
        <Gamepad2 className="size-3.5 shrink-0" aria-hidden />
        <span className="max-w-52 truncate">{currentGame ?? t('top.waitingGame')}</span>
      </div>

      {/* buffer meter */}
      {armed && (
        <div className="ml-auto hidden min-w-36 flex-col gap-1 md:flex">
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>{t('status.buffered', { n: Math.floor(bufferedSeconds) })}</span>
            <span>{formatDuration(maxBufferSeconds)}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-signal transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className={cn('flex shrink-0 items-center gap-2', !armed && 'ml-auto')}>
        {armed && primary && (
          <Button
            variant="outline"
            onClick={() => clipNow(primary.durationSec, primary.sessionId)}
            disabled={status === 'saving'}
            className="gap-2"
          >
            <Scissors data-icon="inline-start" />
            {t('capture.last', { d: formatDuration(primary.durationSec) })}
            {primary.accelerator && <Kbd className="ml-1">{primary.accelerator}</Kbd>}
          </Button>
        )}

        <Button
          variant={armed ? 'outline' : 'default'}
          disabled={busy || (!armed && ready === 0)}
          onClick={() => {
            if (armed) return disarmAll()
            if (ready === 0) return setPage('capture')
            void armAll()
          }}
          className={cn(!armed && ready > 0 && 'bg-signal text-signal-foreground hover:bg-signal/90')}
        >
          <Power data-icon="inline-start" />
          {armed ? t('top.stop') : t('top.start')}
        </Button>
        </div>
      </header>
    </>
  )
}
