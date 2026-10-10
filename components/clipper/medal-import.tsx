'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Check, FolderOpen, Gamepad2, HardDrive, Image as ImageIcon, LoaderCircle, Search, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useClipper } from '@/lib/clipper/provider'
import type { MedalProgress, MedalResult, MedalScan } from '@/lib/clipper/types'
import { useT } from '@/lib/i18n'
import { formatBytes } from './gallery-page'

type Step = 'pick' | 'preview' | 'running' | 'done'

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'warn' }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-surface px-3 py-2.5">
      <span className={cn('font-mono text-lg leading-none', tone === 'warn' && 'text-signal')}>{value}</span>
      <span className="text-xs leading-snug text-muted-foreground">{label}</span>
    </div>
  )
}

/**
 * Brings an old Medal library in. Nothing is written until the scan has been
 * shown; the main process keeps the scan between the two steps and journals the
 * import, so an interrupted run resumes instead of duplicating.
 */
export function MedalImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, refreshLibrary } = useClipper()
  const t = useT()

  const [step, setStep] = React.useState<Step>('pick')
  const [roots, setRoots] = React.useState<string[]>([])
  const [scan, setScan] = React.useState<MedalScan | null>(null)
  const [scanning, setScanning] = React.useState(false)
  const [mode, setMode] = React.useState<'copy' | 'move'>('copy')
  const [includeShots, setIncludeShots] = React.useState(true)
  const [progress, setProgress] = React.useState<MedalProgress | null>(null)
  const [result, setResult] = React.useState<MedalResult | null>(null)

  const [tagGame, setTagGame] = React.useState('')
  const [tagFrom, setTagFrom] = React.useState('')
  const [tagTo, setTagTo] = React.useState('')
  const [tagging, setTagging] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setStep('pick')
    setRoots([])
    setScan(null)
    setProgress(null)
    setResult(null)
  }, [open])

  React.useEffect(() => api?.onMedalProgress(setProgress), [api])

  async function addFolders() {
    const picked = await api?.pickMedalFolders()
    if (picked?.length) setRoots((prev) => [...new Set([...prev, ...picked])])
  }

  async function runScan() {
    if (!api || !roots.length) return
    setScanning(true)
    try {
      setScan(await api.scanMedal(roots))
      setStep('preview')
    } catch (err) {
      toast.error(t('medal.scanFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setScanning(false)
    }
  }

  async function runImport() {
    if (!api) return
    setStep('running')
    setProgress(null)
    try {
      const res = await api.importMedal({ mode, kinds: includeShots ? ['clip', 'shot'] : ['clip'] })
      setResult(res)
      await refreshLibrary()
      setStep('done')
    } catch (err) {
      toast.error(t('medal.importFailed', { error: err instanceof Error ? err.message : String(err) }))
      setStep('preview')
    }
  }

  /** Names every untagged clip in a date range — usually one game per week. */
  async function applyTag() {
    const game = tagGame.trim()
    if (!api || !game) return
    setTagging(true)
    try {
      const from = tagFrom ? new Date(`${tagFrom}T00:00:00`) : null
      const to = tagTo ? new Date(`${tagTo}T23:59:59`) : null
      const targets = (await api.listClips())
        .filter((c) => !c.source.app)
        .filter((c) => {
          const at = new Date(c.createdAt)
          return (!from || at >= from) && (!to || at <= to)
        })
      if (!targets.length) {
        toast.info(t('medal.tagNone'))
        return
      }
      await api.setClipsGame(
        targets.map((c) => c.id),
        game,
      )
      await refreshLibrary()
      toast.success(t('medal.tagged', { n: String(targets.length), game }))
      setTagGame('')
    } finally {
      setTagging(false)
    }
  }

  const summary = scan?.summary
  const clips = summary?.byKind.clip ?? 0
  const shots = summary?.byKind.shot ?? 0
  const percent = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : 0

  return (
    <Dialog open={open} onOpenChange={(v) => !v && step !== 'running' && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[min(760px,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b px-5 py-4 text-left">
          <DialogTitle className="text-base">{t('medal.title')}</DialogTitle>
          <DialogDescription className="text-xs">{t('medal.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="scroll-y flex-1 px-5 py-4">
          {step === 'pick' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted-foreground">{t('medal.pickHelp')}</p>
              <div className="flex flex-col gap-2">
                {roots.map((dir) => (
                  <div key={dir} className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-2">
                    <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{dir}</span>
                    <button
                      type="button"
                      onClick={() => setRoots((prev) => prev.filter((d) => d !== dir))}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={t('medal.removeFolder')}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={addFolders}>
                  <FolderOpen data-icon="inline-start" />
                  {t('medal.addFolder')}
                </Button>
                <Button size="sm" disabled={!roots.length || scanning} onClick={runScan}>
                  {scanning ? (
                    <LoaderCircle data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Search data-icon="inline-start" />
                  )}
                  {t('medal.scan')}
                </Button>
              </div>
            </div>
          )}

          {step === 'preview' && summary && scan && (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat value={String(clips)} label={t('medal.statClips')} />
                <Stat value={formatBytes(summary.bytes)} label={t('medal.statSize')} />
                <Stat value={String(summary.withThumb)} label={t('medal.statThumbs')} />
                <Stat value={String(shots)} label={t('medal.statShots')} />
                <Stat value={String(summary.withDate)} label={t('medal.statDated')} />
                <Stat
                  value={String(summary.withoutDate)}
                  label={t('medal.statUndated')}
                  tone={summary.withoutDate ? 'warn' : undefined}
                />
                <Stat value={String(summary.noGame)} label={t('medal.statNoGame')} tone={summary.noGame ? 'warn' : undefined} />
                <Stat value={String(summary.games.length)} label={t('medal.statGames')} />
              </div>

              {summary.range && (
                <p className="text-xs text-muted-foreground">
                  {t('medal.range', {
                    from: new Date(summary.range.from).toLocaleDateString(),
                    to: new Date(summary.range.to).toLocaleDateString(),
                  })}
                </p>
              )}

              {scan.alreadyDone > 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-signal/40 bg-signal/5 px-3 py-2.5 text-xs">
                  <Check className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
                  <span className="leading-relaxed">{t('medal.resume', { n: String(scan.alreadyDone) })}</span>
                </div>
              )}

              {summary.games.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-medium">
                    <Gamepad2 className="size-4" aria-hidden />
                    {t('medal.gamesFound')}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.games.map((g) => (
                      <span key={g.name} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                        {g.name} <span className="font-mono opacity-60">{g.count}</span>
                      </span>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{t('medal.noGameNote')}</p>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{t('medal.modeTitle')}</h3>
                {(['copy', 'move'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      mode === m ? 'border-ring bg-accent/40' : 'hover:bg-accent/20',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 size-3.5 shrink-0 rounded-full border-2',
                        mode === m ? 'border-signal bg-signal' : 'border-muted-foreground/40',
                      )}
                      aria-hidden
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm">{t(m === 'copy' ? 'medal.modeCopy' : 'medal.modeMove')}</span>
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {t(m === 'copy' ? 'medal.modeCopyDesc' : 'medal.modeMoveDesc', { size: formatBytes(summary.bytes) })}
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              {shots > 0 && (
                <label className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={includeShots}
                    onChange={(e) => setIncludeShots(e.target.checked)}
                    className="size-4 accent-[var(--signal)]"
                  />
                  <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
                  {t('medal.includeShots', { n: String(shots) })}
                </label>
              )}

              <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="leading-relaxed text-muted-foreground">{t('medal.safety')}</span>
              </div>
            </div>
          )}

          {step === 'running' && (
            <div className="flex flex-col gap-4 py-6">
              <div className="flex items-center gap-3">
                <LoaderCircle className="size-4 shrink-0 animate-spin text-signal" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {progress?.current ?? t('medal.starting')}
                </span>
                <span className="shrink-0 font-mono text-sm">{percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-signal transition-[width]" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('medal.runningCount', {
                  done: String(progress?.done ?? 0),
                  total: String(progress?.total ?? 0),
                  skipped: String(progress?.skipped ?? 0),
                })}
              </p>
            </div>
          )}

          {step === 'done' && result && (
            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-2.5 rounded-lg border border-signal/40 bg-signal/5 px-3 py-3">
                <Check className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
                <div className="flex flex-col gap-0.5 text-sm">
                  <span>{t('medal.doneTitle', { n: String(result.imported) })}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('medal.doneDetail', { skipped: String(result.skipped), failed: String(result.failed) })}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <h3 className="flex items-center gap-1.5 text-sm font-medium">
                  <Gamepad2 className="size-4" aria-hidden />
                  {t('medal.tagTitle')}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{t('medal.tagHelp')}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('medal.tagFrom')}</span>
                    <Input type="date" value={tagFrom} onChange={(e) => setTagFrom(e.target.value)} className="h-8 w-36" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('medal.tagTo')}</span>
                    <Input type="date" value={tagTo} onChange={(e) => setTagTo(e.target.value)} className="h-8 w-36" />
                  </label>
                  <label className="flex min-w-40 flex-1 flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('medal.tagGame')}</span>
                    <Input
                      value={tagGame}
                      onChange={(e) => setTagGame(e.target.value)}
                      placeholder={t('medal.tagGamePlaceholder')}
                      className="h-8"
                    />
                  </label>
                  <Button size="sm" disabled={!tagGame.trim() || tagging} onClick={applyTag}>
                    {tagging && <LoaderCircle data-icon="inline-start" className="animate-spin" />}
                    {t('medal.tagApply')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
          {step === 'preview' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep('pick')}>
                {t('medal.back')}
              </Button>
              <Button size="sm" className="ml-auto bg-signal text-signal-foreground hover:bg-signal/90" onClick={runImport}>
                <HardDrive data-icon="inline-start" />
                {t(mode === 'copy' ? 'medal.startCopy' : 'medal.startMove', {
                  n: String(includeShots ? clips + shots : clips),
                })}
              </Button>
            </>
          )}
          {step === 'running' && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => api?.cancelMedalImport()}>
              {t('medal.stop')}
            </Button>
          )}
          {step !== 'preview' && step !== 'running' && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
              {t('medal.close')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
