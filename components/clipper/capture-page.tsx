'use client'

import * as React from 'react'
import { AppWindow, Monitor, Power, RefreshCw, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useClipper } from '@/lib/clipper/provider'
import { acceleratorKeys, formatDuration } from '@/lib/clipper/hotkeys'
import type { CaptureSource } from '@/lib/clipper/types'
import { PageHeader } from './page-header'

export function CapturePage() {
  const {
    isDesktop,
    sources,
    refreshSources,
    selectedSource,
    setSelectedSource,
    status,
    arm,
    disarm,
    clipNow,
    settings,
    previewStream,
    bufferedSeconds,
    activeSourceLabel,
  } = useClipper()

  const armed = status === 'armed' || status === 'saving'
  const [refreshing, setRefreshing] = React.useState(false)

  const screens = sources.filter((s) => s.type === 'screen')
  const windows = sources.filter((s) => s.type === 'window')

  async function handleRefresh() {
    setRefreshing(true)
    await refreshSources()
    setRefreshing(false)
  }

  return (
    <>
      <PageHeader
        title="Capture"
        description="Choose what to record. The last few seconds are kept in memory until you press a hotkey."
        actions={
          armed ? (
            <Button variant="outline" onClick={disarm}>
              <Power data-icon="inline-start" />
              Disarm
            </Button>
          ) : (
            <Button onClick={arm} disabled={status === 'starting' || (isDesktop && !selectedSource)}>
              <Power data-icon="inline-start" />
              {status === 'starting' ? 'Starting…' : 'Arm capture'}
            </Button>
          )
        }
      />

      <div className="grid flex-1 min-h-0 grid-cols-1 gap-0 lg:grid-cols-[1fr_360px]">
        <section className="flex min-h-0 flex-col border-r">
          <div className="flex items-center justify-between border-b px-6 py-3">
            <h2 className="text-sm font-medium">Source</h2>
            {isDesktop && (
              <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing || armed}>
                <RefreshCw data-icon="inline-start" className={cn(refreshing && 'animate-spin')} />
                Refresh
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-6 p-6">
              {!isDesktop && (
                <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                  <p className="text-foreground">Browser preview mode</p>
                  <p className="mt-1 leading-relaxed">
                    In the desktop app you pick a screen or window here. In the browser, clicking{' '}
                    <span className="text-foreground">Arm capture</span> opens the system share picker instead. Hotkeys
                    only fire while this tab is focused.
                  </p>
                </div>
              )}

              {isDesktop && sources.length === 0 && (
                <p className="text-sm text-muted-foreground">No capture sources found. Try refreshing.</p>
              )}

              {screens.length > 0 && (
                <SourceGroup
                  title="Screens"
                  icon={Monitor}
                  sources={screens}
                  selected={selectedSource}
                  onSelect={setSelectedSource}
                  disabled={armed}
                />
              )}
              {windows.length > 0 && (
                <SourceGroup
                  title="Windows"
                  icon={AppWindow}
                  sources={windows}
                  selected={selectedSource}
                  onSelect={setSelectedSource}
                  disabled={armed}
                />
              )}
            </div>
          </ScrollArea>
        </section>

        <aside className="flex min-h-0 flex-col">
          <div className="border-b px-5 py-3">
            <h2 className="text-sm font-medium">Live buffer</h2>
          </div>
          <div className="flex flex-col gap-5 p-5">
            <LivePreview stream={previewStream} armed={armed} label={activeSourceLabel} />

            <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
              <span>{armed ? `${Math.floor(bufferedSeconds)}s in memory` : 'Idle'}</span>
              <span>
                {settings.fps} fps · {settings.videoBitrateMbps} Mbps
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Clip now</h3>
              {settings.hotkeys.map((hk) => (
                <button
                  key={hk.id}
                  type="button"
                  disabled={!armed || status === 'saving'}
                  onClick={() => clipNow(hk.durationSec)}
                  className="flex h-11 items-center justify-between rounded-md border bg-surface px-3 text-sm transition-colors hover:border-signal/60 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Scissors className="size-4 text-signal" aria-hidden />
                    Last {formatDuration(hk.durationSec)}
                  </span>
                  <KbdGroup>
                    {acceleratorKeys(hk.accelerator).map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </KbdGroup>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

function SourceGroup({
  title,
  icon: Icon,
  sources,
  selected,
  onSelect,
  disabled,
}: {
  title: string
  icon: typeof Monitor
  sources: CaptureSource[]
  selected: CaptureSource | null
  onSelect: (s: CaptureSource) => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {title}
        <span>{sources.length}</span>
      </h3>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {sources.map((s) => {
          const active = selected?.id === s.id
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(s)}
              aria-pressed={active}
              className={cn(
                'group flex flex-col gap-2 rounded-lg border bg-surface p-2 text-left transition-colors disabled:cursor-not-allowed',
                active ? 'border-signal ring-2 ring-signal/30' : 'hover:border-foreground/25',
              )}
            >
              <div className="relative aspect-video overflow-hidden rounded-md bg-muted grid-scan">
                {s.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.thumbnail} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    <Icon className="size-6" aria-hidden />
                  </div>
                )}
                {active && (
                  <Badge className="absolute left-1.5 top-1.5 bg-signal text-signal-foreground">Selected</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 px-0.5">
                {s.appIcon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.appIcon} alt="" className="size-4 shrink-0 rounded-sm" />
                )}
                <span className="truncate text-xs">{s.name}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LivePreview({ stream, armed, label }: { stream: MediaStream | null; armed: boolean; label: string | null }) {
  const ref = React.useRef<HTMLVideoElement>(null)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    if (stream) void el.play().catch(() => {})
  }, [stream])

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted grid-scan">
      <video ref={ref} muted playsInline className={cn('size-full object-contain', !stream && 'hidden')} />
      {!stream && (
        <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <Monitor className="size-6" aria-hidden />
          <span className="text-xs">Preview appears when armed</span>
        </div>
      )}
      {armed && (
        <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-background/80 px-2 py-1 font-mono text-[10px] uppercase tracking-wider backdrop-blur">
          <span className="size-1.5 rounded-full bg-signal pulse-signal" aria-hidden />
          REC · {label}
        </div>
      )}
    </div>
  )
}
