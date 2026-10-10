'use client'

import * as React from 'react'
import { AppWindow, ChevronDown, Monitor, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useClipper, type SessionView } from '@/lib/clipper/provider'
import { formatDuration } from '@/lib/clipper/hotkeys'
import { MAX_SESSIONS, type CaptureSource, type SessionConfig, type SourceRef } from '@/lib/clipper/types'
import { useT } from '@/lib/i18n'

function toRef(s: CaptureSource): SourceRef {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    displayId: s.displayId ?? null,
    width: s.width ?? null,
    height: s.height ?? null,
  }
}

/**
 * Same physical screen, matched the way the main process does it.
 *
 * Neither identifier is dependable on its own: Windows renumbers the capture id
 * when the display set changes, and it renumbers the display id between runs on
 * machines with a virtual display driver. Any one of them matching is enough,
 * which is why this walks the whole chain instead of trusting the first.
 */
function sameSource(ref: SourceRef | null, source: CaptureSource) {
  if (!ref) return false
  if (ref.displayId && source.displayId && String(ref.displayId) === String(source.displayId)) return true
  if (ref.id === source.id) return true
  if (ref.type !== source.type) return false
  if (ref.name && ref.name === source.name) return true
  return Boolean(ref.width && ref.height && ref.width === source.width && ref.height === source.height)
}

export function CapturePage() {
  const {
    isDesktop,
    sources,
    refreshSources,
    settings,
    sessions,
    addSession,
    removeSession,
    updateSession,
    armSession,
    disarmSession,
    previewStreamFor,
  } = useClipper()
  const t = useT()

  const [refreshing, setRefreshing] = React.useState(false)
  const [showWindows, setShowWindows] = React.useState(false)

  const screens = sources.filter((s) => s.type === 'screen')
  const windows = sources.filter((s) => s.type === 'window')

  const findSession = (source: CaptureSource) => settings.sessions.find((x) => sameSource(x.source, source)) ?? null
  const atLimit = settings.sessions.length >= MAX_SESSIONS

  function toggle(source: CaptureSource) {
    const existing = findSession(source)
    // Belt and braces: never end up with two sessions on one screen, which is
    // how a stale identifier used to turn into the same monitor recorded twice.
    const duplicate = settings.sessions.filter((x) => sameSource(x.source, source))
    if (duplicate.length > 1) {
      for (const extra of duplicate.slice(1)) removeSession(extra.id)
      return
    }
    if (existing) {
      if (settings.sessions.length <= 1) {
        // Keep at least one session around; just clear what it points at.
        disarmSession(existing.id)
        updateSession(existing.id, { source: null })
      } else {
        removeSession(existing.id)
      }
      return
    }

    // Reuse an empty session before creating another one.
    const empty = settings.sessions.find((x) => !x.source)
    if (empty) updateSession(empty.id, { source: toRef(source), name: source.name })
    else if (!atLimit) addSession(toRef(source), source.name)
  }

  async function handleRefresh() {
    setRefreshing(true)
    await refreshSources()
    setRefreshing(false)
  }

  const hotkeyFor = (sessionId: string) =>
    settings.hotkeys.find((h) => h.sessionId === sessionId) ??
    settings.hotkeys.find((h) => h.sessionId === null) ??
    null

  return (
    <div className="scroll-y flex-1">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
        <section className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">{t('capture.monitors')}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{t('capture.monitorsDesc')}</p>
            </div>
            {isDesktop && (
              <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
                <RefreshCw data-icon="inline-start" className={cn(refreshing && 'animate-spin')} />
                {t('capture.refresh')}
              </Button>
            )}
          </div>

          {!isDesktop && (
            <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t('capture.browserTitle')}</p>
              <p className="mt-1 leading-relaxed">{t('capture.browserBody')}</p>
            </div>
          )}

          {isDesktop && screens.length === 0 && (
            <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
              {t('capture.noSources')}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {screens.map((source) => {
              const config = findSession(source)
              const view = config ? sessions.find((v) => v.id === config.id) : null
              return (
                <SourceTile
                  key={source.id}
                  source={source}
                  config={config}
                  view={view ?? null}
                  hotkey={config ? hotkeyFor(config.id)?.accelerator ?? null : null}
                  duration={config ? hotkeyFor(config.id)?.durationSec ?? null : null}
                  stream={config ? previewStreamFor(config.id) : null}
                  disabled={!config && atLimit && !settings.sessions.some((x) => !x.source)}
                  onToggle={() => toggle(source)}
                  onArm={() => config && armSession(config.id)}
                  onDisarm={() => config && disarmSession(config.id)}
                  onAutoArm={(v) => config && updateSession(config.id, { autoArm: v })}
                />
              )
            })}
          </div>
        </section>

        {isDesktop && windows.length > 0 && (
          <section className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setShowWindows((v) => !v)}
              className="flex items-center gap-2 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown className={cn('size-4 transition-transform', !showWindows && '-rotate-90')} aria-hidden />
              {t('capture.windowsSection', { n: windows.length })}
            </button>

            {showWindows && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {windows.map((source) => {
                  const config = findSession(source)
                  const view = config ? sessions.find((v) => v.id === config.id) : null
                  return (
                    <SourceTile
                      key={source.id}
                      source={source}
                      config={config}
                      view={view ?? null}
                      hotkey={config ? hotkeyFor(config.id)?.accelerator ?? null : null}
                      duration={config ? hotkeyFor(config.id)?.durationSec ?? null : null}
                      stream={config ? previewStreamFor(config.id) : null}
                      disabled={!config && atLimit && !settings.sessions.some((x) => !x.source)}
                      compact
                      onToggle={() => toggle(source)}
                      onArm={() => config && armSession(config.id)}
                      onDisarm={() => config && disarmSession(config.id)}
                      onAutoArm={(v) => config && updateSession(config.id, { autoArm: v })}
                    />
                  )
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function SourceTile({
  source,
  config,
  view,
  hotkey,
  duration,
  stream,
  disabled,
  compact,
  onToggle,
  onArm,
  onDisarm,
  onAutoArm,
}: {
  source: CaptureSource
  config: SessionConfig | null
  view: SessionView | null
  hotkey: string | null
  duration: number | null
  stream: MediaStream | null
  disabled: boolean
  compact?: boolean
  onToggle: () => void
  onArm: () => void
  onDisarm: () => void
  onAutoArm: (v: boolean) => void
}) {
  const t = useT()
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const enabled = Boolean(config)
  const armed = view?.status === 'armed' || view?.status === 'saving'
  const starting = view?.status === 'starting'

  React.useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.srcObject = stream
    if (stream) void el.play().catch(() => {})
  }, [stream])

  return (
    <div
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border bg-surface transition-all',
        armed ? 'border-signal/60 rec-glow' : enabled ? 'border-foreground/20' : 'border-border',
        !enabled && 'opacity-75 hover:opacity-100',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={enabled}
        className="relative block w-full text-left disabled:cursor-not-allowed"
      >
        <div className={cn('relative overflow-hidden tile-empty', compact ? 'aspect-video' : 'aspect-video')}>
          {armed && stream ? (
            <video ref={videoRef} muted playsInline className="size-full object-contain" />
          ) : source.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={source.thumbnail}
              alt=""
              className={cn('size-full object-cover transition-transform duration-300', !enabled && 'grayscale')}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              {source.type === 'screen' ? <Monitor className="size-7" /> : <AppWindow className="size-7" />}
            </div>
          )}

          {armed && (
            <span className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-md bg-background/85 px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-wider backdrop-blur">
              <span className="size-1.5 rounded-full bg-signal pulse-signal" aria-hidden />
              rec
            </span>
          )}

          {!enabled && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/45 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="flex items-center gap-1.5 rounded-lg bg-signal px-3 py-1.5 text-xs font-medium text-signal-foreground">
                <Plus className="size-3.5" aria-hidden />
                {t('capture.enable')}
              </span>
            </span>
          )}

          {source.width && source.height && (
            <span className="absolute bottom-2.5 right-2.5 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground backdrop-blur">
              {source.width}×{source.height}
            </span>
          )}
        </div>
      </button>

      <div className="flex flex-col gap-3 p-3">
        <div className="flex min-w-0 items-center gap-2">
          {source.appIcon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={source.appIcon} alt="" className="size-4 shrink-0 rounded-sm" />
          )}
          <span className="truncate text-sm font-medium">{source.name}</span>
          {view?.error && (
            <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-destructive">
              <TriangleAlert className="size-3.5" aria-hidden />
              {view.error}
            </span>
          )}
          {armed && view && (
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
              {Math.floor(view.bufferedSeconds)}s · {(view.bufferedBytes / 1048576).toFixed(0)} MB
            </span>
          )}
        </div>

        {enabled ? (
          <>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={armed ? 'outline' : 'secondary'}
                className="flex-1"
                disabled={starting}
                onClick={armed ? onDisarm : onArm}
              >
                {starting ? t('capture.starting') : armed ? t('capture.disarmSession') : t('capture.armSession')}
              </Button>
              {hotkey && duration !== null && (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Kbd>{hotkey}</Kbd>
                  {formatDuration(duration)}
                </span>
              )}
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-muted-foreground">
              {t('capture.autoArm')}
              <Switch size="sm" checked={config!.autoArm} onCheckedChange={onAutoArm} />
            </label>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t('capture.disabledHint')}</p>
        )}
      </div>
    </div>
  )
}
