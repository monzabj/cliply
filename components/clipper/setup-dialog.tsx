'use client'

import * as React from 'react'
import { Check, FolderOpen, FolderPlus, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useClipper } from '@/lib/clipper/provider'
import type { CaptureSource, SessionConfig, SourceRef } from '@/lib/clipper/types'
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
 * First run: confirm which screens this machine has and which of them Clipper
 * should keep in memory. A single-screen setup never has to see anything about
 * recording two at once.
 */
export function SetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { sources, settings, updateSettings, refreshSources, api } = useClipper()
  const t = useT()

  const screens = React.useMemo(() => sources.filter((s) => s.type === 'screen'), [sources])
  const [picked, setPicked] = React.useState<string[]>([])
  const [folder, setFolder] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) setFolder(settings.clipsDir)
  }, [open, settings.clipsDir])

  // Default to every detected screen; the user unticks what they do not want.
  React.useEffect(() => {
    if (!open) return
    void refreshSources()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!open || !screens.length) return
    setPicked((prev) => (prev.length ? prev : screens.map((s) => s.id)))
  }, [open, screens])

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  async function finish() {
    const chosen = screens.filter((s) => picked.includes(s.id))
    const keys = ['F8', 'F9', 'F7', 'F6']

    const sessions: SessionConfig[] = chosen.length
      ? chosen.map((s, i) => ({
          id: i === 0 ? 'main' : `s${i}`,
          name: chosen.length > 1 ? `Monitor ${i + 1}` : s.name,
          source: toRef(s),
          autoArm: true,
        }))
      : settings.sessions

    const hotkeys = chosen.length
      ? [
          ...chosen.map((_, i) => ({
            id: `hk-${i}`,
            accelerator: keys[i] ?? '',
            action: 'clip' as const,
            durationSec: settings.hotkeys.find((h) => h.action === 'clip')?.durationSec ?? 30,
            sessionId: sessions[i].id,
            isDefault: i === 0,
          })),
          // One screenshot key, always aimed at the first screen.
          {
            id: 'hk-shot',
            accelerator: 'F7',
            action: 'shot' as const,
            durationSec: 0,
            sessionId: sessions[0].id,
          },
        ]
      : settings.hotkeys

    await updateSettings({
      sessions,
      hotkeys,
      monitorSetup: chosen.length > 1 ? 'multi' : 'single',
      setupDone: true,
      ...(folder ? { clipsDir: folder } : {}),
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && void finish()}>
      <DialogContent className="w-[min(720px,94vw)] sm:max-w-none">
        <DialogHeader>
          <DialogTitle>{t('setup.title')}</DialogTitle>
          <DialogDescription>
            {screens.length === 1 ? t('setup.oneFound') : t('setup.manyFound', { n: screens.length })}
          </DialogDescription>
        </DialogHeader>

        <div className={cn('grid gap-3', screens.length > 1 ? 'sm:grid-cols-2' : 'sm:grid-cols-1')}>
          {screens.map((s, i) => {
            const active = picked.includes(s.id)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                aria-pressed={active}
                className={cn(
                  'group relative flex flex-col overflow-hidden rounded-xl border bg-surface text-left transition-all',
                  active ? 'border-signal ring-1 ring-signal/30' : 'border-border opacity-70 hover:opacity-100',
                )}
              >
                <div className="relative aspect-video tile-empty">
                  {s.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumbnail} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground">
                      <Monitor className="size-7" aria-hidden />
                    </div>
                  )}
                  {active && (
                    <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-signal text-signal-foreground">
                      <Check className="size-3.5" aria-hidden />
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <Monitor className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate text-sm font-medium">
                    {screens.length > 1 ? `Monitor ${i + 1}` : s.name}
                  </span>
                  {s.width && s.height && (
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                      {s.width}×{s.height}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {picked.length > 1 ? t('setup.hintMulti', { n: picked.length }) : t('setup.hintSingle')}
        </p>

        {/* where the clips live */}
        <div className="flex flex-col gap-2 rounded-xl border bg-surface p-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">{t('setup.folderTitle')}</span>
          </div>
          <p className="font-mono text-[11px] break-all text-muted-foreground">{folder ?? '—'}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const dir = await api?.chooseClipsDir()
                if (dir) setFolder(dir)
              }}
            >
              <FolderOpen data-icon="inline-start" />
              {t('setup.folderPick')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const dir = await api?.createClipsDir('Clipper')
                if (dir) setFolder(dir)
              }}
            >
              <FolderPlus data-icon="inline-start" />
              {t('setup.folderCreate')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('setup.folderHint')}</p>
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={finish} className="bg-signal text-signal-foreground hover:bg-signal/90">
            {t('setup.done')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
