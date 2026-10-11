'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  ArrowDownToLine,
  Check,
  FolderOpen,
  LoaderCircle,
  Monitor as MonitorIcon,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Volume2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useClipper } from '@/lib/clipper/provider'
import { acceleratorFromEvent, acceleratorKeys, formatDuration } from '@/lib/clipper/hotkeys'
import { DURATION_OPTIONS, type Hotkey, type SessionConfig, type UpdateState } from '@/lib/clipper/types'
import { useT, type TFunction } from '@/lib/i18n'
import { formatBytes } from './gallery-page'
import { MedalImportDialog } from './medal-import'

// --- small building blocks ---------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border bg-surface">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs leading-relaxed text-pretty text-muted-foreground">{hint}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className={cn('flex rounded-lg bg-muted/60 p-0.5', disabled && 'pointer-events-none opacity-50')}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors',
            value === o.value
              ? 'bg-surface font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function SoundPicker({
  file,
  onPick,
  onReset,
  onTest,
  t,
}: {
  file: string | null
  onPick: () => void
  onReset: () => void
  onTest: () => void
  t: TFunction
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="max-w-40 truncate font-mono text-[11px] text-muted-foreground">
        {file ? file : t('settings.builtInSound')}
      </span>
      <Button variant="outline" size="sm" onClick={onTest}>
        <Volume2 data-icon="inline-start" />
        {t('settings.testSound')}
      </Button>
      <Button variant="outline" size="sm" onClick={onPick}>
        <FolderOpen data-icon="inline-start" />
        {t('settings.pickSound')}
      </Button>
      {file && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t('settings.resetSound')}
        </Button>
      )}
    </div>
  )
}

/**
 * Version row. Checking is explicit and nothing downloads on its own: the user
 * decides when a 200 MB download happens, never in the middle of a game.
 */
function UpdateRow() {
  const { api } = useClipper()
  const t = useT()
  const [state, setState] = React.useState<UpdateState | null>(null)

  React.useEffect(() => {
    // Pushed updates carry no version of their own; keep the one from the first read.
    const merge = (next: UpdateState) => setState((prev) => ({ ...next, current: next.current ?? prev?.current }))
    void api?.getUpdateState().then(merge)
    return api?.onUpdateState(merge)
  }, [api])

  const status = state?.status ?? 'idle'
  const busy = status === 'checking' || status === 'downloading'
  const failure = (error: string | null) =>
    error && error.includes('404') ? t('update.noRepo') : t('update.failed', { error: (error ?? '').slice(0, 120) })

  async function act() {
    if (!api) return
    if (status === 'available') return void (await api.downloadUpdate())
    if (status === 'ready') return void (await api.installUpdate())
    const next = await api.checkForUpdate()
    if (next.status === 'current') toast.success(t('update.upToDate'))
    if (next.status === 'error') toast.error(failure(next.error ?? null))
  }

  const hint = (() => {
    switch (status) {
      case 'available':
        return t('update.availableDesc', { version: state?.version ?? '' })
      case 'downloading':
        return t('update.downloadingDesc', { percent: String(state?.percent ?? 0) })
      case 'ready':
        return t('update.readyDesc', { version: state?.version ?? '' })
      case 'error':
        return failure(state?.error ?? null)
      case 'unsupported':
        return t('update.unsupportedDesc')
      default:
        return t('update.hint')
    }
  })()

  const label = (() => {
    switch (status) {
      case 'available':
        return t('update.download')
      case 'downloading':
        return t('update.downloading', { percent: String(state?.percent ?? 0) })
      case 'ready':
        return t('update.restart')
      case 'checking':
        return t('update.checking')
      default:
        return t('update.check')
    }
  })()

  const Icon = status === 'available' ? ArrowDownToLine : status === 'ready' ? Check : RefreshCw
  const highlight = status === 'available' || status === 'ready'

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm">
          {t('update.title')}
          {state?.current && <span className="font-mono text-xs text-muted-foreground">v{state.current}</span>}
          {status === 'available' && (
            <span className="rounded-full bg-signal px-1.5 py-0.5 text-[10px] font-medium text-signal-foreground">
              {t('update.badge')}
            </span>
          )}
        </span>
        <span className="text-xs leading-relaxed text-pretty text-muted-foreground">{hint}</span>
      </div>
      <Button
        variant={highlight ? 'default' : 'outline'}
        size="sm"
        disabled={busy || status === 'unsupported'}
        onClick={act}
        className={highlight ? 'bg-signal text-signal-foreground hover:bg-signal/90' : ''}
      >
        {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Icon data-icon="inline-start" />}
        {label}
      </Button>
    </div>
  )
}

// --- page --------------------------------------------------------------------

export function SettingsPage() {
  const { settings, updateSettings, updateSession, api, isDesktop, status, setShowSetup } = useClipper()
  const t = useT()
  const armed = status !== 'idle'

  // Plain-language answer to "so what happens when I open it?".
  const autoArming = settings.sessions.filter((s) => s.autoArm && s.source)
  const autoArmSummary =
    autoArming.length === 0
      ? t('settings.autoArmNone')
      : autoArming.length === settings.sessions.length && settings.sessions.length > 1
        ? t('settings.autoArmAll')
        : autoArming.map((s) => s.name).join(', ')
  const [usage, setUsage] = React.useState<number | null>(null)

  const [mics, setMics] = React.useState<MediaDeviceInfo[]>([])
  const [micError, setMicError] = React.useState<string | null>(null)
  const [medalOpen, setMedalOpen] = React.useState(false)

  React.useEffect(() => {
    if (!api) return
    api.getDiskUsage().then(setUsage).catch(() => setUsage(null))
  }, [api, settings.clipsDir])

  // Device labels stay blank until microphone permission is granted, so ask for
  // it only once the user actually turns the mic on.
  React.useEffect(() => {
    if (!settings.captureMic || typeof navigator === 'undefined' || !navigator.mediaDevices) return
    let cancelled = false

    const load = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((track) => track.stop())
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        setMics(devices.filter((d) => d.kind === 'audioinput'))
        setMicError(null)
      } catch {
        if (!cancelled) setMicError(t('settings.micNoPerm'))
      }
    }

    void load()
    navigator.mediaDevices.addEventListener?.('devicechange', load)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener?.('devicechange', load)
    }
  }, [settings.captureMic, t])

  const setHotkeys = (hotkeys: Hotkey[]) => void updateSettings({ hotkeys })

  function addHotkey() {
    const used = new Set(settings.hotkeys.map((h) => h.durationSec))
    const durationSec = DURATION_OPTIONS.find((d) => !used.has(d)) ?? 60
    setHotkeys([
      ...settings.hotkeys,
      {
        id: crypto.randomUUID(),
        accelerator: '',
        action: 'clip' as const,
        durationSec,
        sessionId: settings.sessions[0]?.id ?? null,
      },
    ])
  }

  function updateHotkey(id: string, patch: Partial<Hotkey>) {
    setHotkeys(settings.hotkeys.map((h) => (h.id === id ? { ...h, ...patch } : h)))
  }

  function removeHotkey(id: string) {
    const remaining = settings.hotkeys.filter((h) => h.id !== id)
    if (remaining.length && !remaining.some((h) => h.isDefault)) remaining[0] = { ...remaining[0], isDefault: true }
    setHotkeys(remaining)
  }

  async function chooseDir() {
    const dir = await api?.chooseClipsDir()
    if (dir) {
      await updateSettings({ clipsDir: dir })
      toast.success(t('settings.folderUpdated'))
    }
  }

  /** Previews whichever file is configured, falling back to the built-in one. */
  function playSound(file: string | null, fallback: string) {
    try {
      const el = new Audio(api ? api.soundUrl(file, fallback) : fallback)
      el.volume = settings.soundCueVolume
      void el.play().catch(() => {})
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="scroll-y flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
        {/* ---------- hotkeys ---------- */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">{t('settings.hotkeys')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.hotkeysDesc')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={addHotkey}>
              <Plus data-icon="inline-start" />
              {t('settings.addHotkey')}
            </Button>
          </div>

          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border bg-surface">
            {settings.hotkeys.map((hk) => (
              <HotkeyRow
                key={hk.id}
                hotkey={hk}
                sessions={settings.sessions}
                showSessions={settings.sessions.length > 1}
                taken={settings.hotkeys.filter((h) => h.id !== hk.id).map((h) => h.accelerator)}
                canDelete={settings.hotkeys.length > 1}
                t={t}
                onChange={(patch) => updateHotkey(hk.id, patch)}
                onRemove={() => removeHotkey(hk.id)}
                onMakeDefault={() => setHotkeys(settings.hotkeys.map((h) => ({ ...h, isDefault: h.id === hk.id })))}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('settings.bufferNote', {
              d: formatDuration(
                Math.max(...settings.hotkeys.filter((h) => h.action === 'clip').map((h) => h.durationSec), 10),
              ),
            })}
          </p>
        </section>

        {/* ---------- recording ---------- */}
        <Section title={t('settings.recording')}>
          <Row label={t('settings.codec')} hint={t('settings.codecDesc')}>
            <Segmented
              options={[
                { value: 'auto', label: t('settings.codecAuto') },
                { value: 'h264', label: 'H.264' },
                { value: 'vp9', label: 'VP9' },
              ]}
              value={settings.codec}
              onChange={(v) => updateSettings({ codec: v as 'auto' | 'h264' | 'vp9' })}
              disabled={armed}
            />
          </Row>

          <Row label={t('settings.fps')} hint={t('settings.fpsDesc')}>
            <Segmented
              options={[
                { value: 30, label: '30' },
                { value: 60, label: '60' },
              ]}
              value={settings.fps}
              onChange={(v) => updateSettings({ fps: v as 30 | 60 })}
              disabled={armed}
            />
          </Row>

          <Row
            label={t('settings.quality')}
            hint={`${t('settings.qualityDesc')} ${t('settings.qualitySize', {
              mb: Math.round((settings.videoBitrateMbps * 60) / 8),
            })}`}
          >
            <Segmented
              options={[
                { value: 4, label: '4' },
                { value: 6, label: '6' },
                { value: 8, label: '8' },
                { value: 12, label: '12' },
                { value: 20, label: '20 Mbps' },
              ]}
              value={settings.videoBitrateMbps}
              onChange={(v) => updateSettings({ videoBitrateMbps: Number(v) })}
              disabled={armed}
            />
          </Row>

          <Row label={t('settings.sysAudio')} hint={t('settings.sysAudioDesc')}>
            <Switch
              checked={settings.captureSystemAudio}
              onCheckedChange={(v) => updateSettings({ captureSystemAudio: v })}
              disabled={armed}
            />
          </Row>

          <Row label={t('settings.mic')} hint={t('settings.micDesc')}>
            <Switch
              checked={settings.captureMic}
              onCheckedChange={(v) => updateSettings({ captureMic: v })}
              disabled={armed}
            />
          </Row>

          {settings.captureMic && (
            <Row label={t('settings.micDevice')} hint={micError ?? t('settings.micDeviceDesc')}>
              <select
                value={settings.micDeviceId ?? ''}
                onChange={(e) => updateSettings({ micDeviceId: e.target.value || null })}
                disabled={armed}
                aria-label={t('settings.micDevice')}
                className="h-8 max-w-64 rounded-lg border bg-surface px-2 text-sm outline-none transition-colors hover:border-foreground/30 focus-visible:border-ring disabled:opacity-50"
              >
                <option value="">{t('settings.micDefault')}</option>
                {mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </Row>
          )}
        </Section>
        {armed && <p className="-mt-6 text-xs text-signal">{t('settings.disarmFirst')}</p>}

        {/* ---------- app ---------- */}
        <Section title={t('settings.app')}>
          <Row label={t('settings.language')}>
            <Segmented
              options={[
                { value: 'auto', label: t('settings.langAuto') },
                { value: 'es', label: 'Español' },
                { value: 'en', label: 'English' },
              ]}
              value={settings.language}
              onChange={(v) => updateSettings({ language: v as 'auto' | 'es' | 'en' })}
            />
          </Row>

          {isDesktop && (
            <>
              <Row label={t('settings.launchOnStartup')} hint={t('settings.launchOnStartupDesc')}>
                <Switch
                  checked={settings.launchOnStartup}
                  onCheckedChange={(v) => updateSettings({ launchOnStartup: v })}
                />
              </Row>
              <Row label={t('settings.startMinimized')} hint={t('settings.startMinimizedDesc')}>
                <Switch
                  checked={settings.startMinimized}
                  onCheckedChange={(v) => updateSettings({ startMinimized: v })}
                />
              </Row>
              <UpdateRow />
              <Row label={t('settings.autoArm')} hint={t('settings.autoArmDesc')}>
                <span className="text-xs text-muted-foreground">{autoArmSummary}</span>
              </Row>
              {settings.sessions.map((s) => (
                <Row
                  key={s.id}
                  label={s.name}
                  hint={s.source ? undefined : t('settings.autoArmNoSource')}
                >
                  <Switch
                    checked={s.autoArm}
                    disabled={!s.source}
                    onCheckedChange={(v) => updateSession(s.id, { autoArm: v })}
                  />
                </Row>
              ))}
            </>
          )}

          {isDesktop && (
            <Row label={t('settings.redoSetup')} hint={t('settings.redoSetupDesc')}>
              <Button variant="outline" size="sm" onClick={() => setShowSetup(true)}>
                <MonitorIcon data-icon="inline-start" />
                {t('settings.redoSetupBtn')}
              </Button>
            </Row>
          )}

          <Row label={t('settings.soundCue')} hint={t('settings.soundCueDesc')}>
            <Switch checked={settings.soundCue} onCheckedChange={(v) => updateSettings({ soundCue: v })} />
          </Row>

          {settings.soundCue && (
            <Row label={t('settings.customSoundClip')}>
              <SoundPicker
                t={t}
                file={settings.clipSoundFile}
                onTest={() => playSound(settings.clipSoundFile, 'clip-cue.wav')}
                onPick={async () => {
                  const picked = await api?.pickSound()
                  if (picked) {
                    await api?.clearSound(settings.clipSoundFile)
                    await updateSettings({ clipSoundFile: picked.file })
                  }
                }}
                onReset={async () => {
                  await api?.clearSound(settings.clipSoundFile)
                  await updateSettings({ clipSoundFile: null })
                }}
              />
            </Row>
          )}

          {(settings.soundCue || settings.screenshotSound) && (
            <Row label={t('settings.soundVolume')}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.soundCueVolume}
                onChange={(e) => updateSettings({ soundCueVolume: Number(e.target.value) })}
                className="range-signal w-32"
                aria-label={t('settings.soundVolume')}
              />
              <span className="w-9 text-right font-mono text-xs text-muted-foreground">
                {Math.round(settings.soundCueVolume * 100)}%
              </span>
            </Row>
          )}
        </Section>

        {/* ---------- screenshots ---------- */}
        {isDesktop && (
          <Section title={t('settings.screenshots')}>
            <Row label={t('settings.shotSound')} hint={t('settings.shotSoundDesc')}>
              <Switch
                checked={settings.screenshotSound}
                onCheckedChange={(v) => updateSettings({ screenshotSound: v })}
              />
            </Row>

            {settings.screenshotSound && (
              <Row label={t('settings.customSoundShot')}>
                <SoundPicker
                  t={t}
                  file={settings.screenshotSoundFile}
                  onTest={() => playSound(settings.screenshotSoundFile, 'shutter.wav')}
                  onPick={async () => {
                    const picked = await api?.pickSound()
                    if (picked) {
                      await api?.clearSound(settings.screenshotSoundFile)
                      await updateSettings({ screenshotSoundFile: picked.file })
                    }
                  }}
                  onReset={async () => {
                    await api?.clearSound(settings.screenshotSoundFile)
                    await updateSettings({ screenshotSoundFile: null })
                  }}
                />
              </Row>
            )}

            <Row label={t('settings.shotCopy')} hint={t('settings.shotCopyDesc')}>
              <Switch
                checked={settings.screenshotCopy}
                onCheckedChange={(v) => updateSettings({ screenshotCopy: v })}
              />
            </Row>

            <Row label={t('settings.shotFolder')} hint={t('settings.shotFolderDesc')}>
              <Button variant="outline" size="sm" onClick={() => api?.openShotsDir()}>
                <FolderOpen data-icon="inline-start" />
                {t('gallery.openFolder')}
              </Button>
            </Row>
          </Section>
        )}

        {/* ---------- storage ---------- */}
        <Section title={t('settings.storage')}>
          <Row
            label={t('settings.folder')}
            hint={isDesktop ? (settings.clipsDir ?? 'Videos/Clipper') : t('settings.browserStorage')}
          >
            {usage !== null && <span className="font-mono text-xs text-muted-foreground">{formatBytes(usage)}</span>}
            {isDesktop && (
              <Button variant="outline" size="sm" onClick={chooseDir}>
                <FolderOpen data-icon="inline-start" />
                {t('settings.change')}
              </Button>
            )}
          </Row>

          {isDesktop && (
            <Row label={t('settings.importMedal')} hint={t('settings.importMedalDesc')}>
              <Button variant="outline" size="sm" onClick={() => setMedalOpen(true)}>
                <FolderOpen data-icon="inline-start" />
                {t('settings.importMedalBtn')}
              </Button>
            </Row>
          )}

          {isDesktop && (
            <Row label={t('settings.diskLimit')} hint={t('settings.diskLimitDesc')}>
              <Segmented
                options={[
                  { value: 0, label: t('settings.diskNoLimit') },
                  { value: 25, label: '25' },
                  { value: 50, label: '50' },
                  { value: 100, label: '100 GB' },
                ]}
                value={settings.diskLimitGB}
                onChange={(v) => updateSettings({ diskLimitGB: Number(v) })}
              />
            </Row>
          )}
        </Section>
      </div>
      <MedalImportDialog open={medalOpen} onClose={() => setMedalOpen(false)} />
    </div>
  )
}

function HotkeyRow({
  hotkey,
  sessions,
  showSessions,
  taken,
  canDelete,
  t,
  onChange,
  onRemove,
  onMakeDefault,
}: {
  hotkey: Hotkey
  sessions: SessionConfig[]
  showSessions: boolean
  taken: string[]
  canDelete: boolean
  t: TFunction
  onChange: (patch: Partial<Hotkey>) => void
  onRemove: () => void
  onMakeDefault: () => void
}) {
  const [listening, setListening] = React.useState(false)
  const isClip = hotkey.action === 'clip'

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!listening) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') return setListening(false)
    const acc = acceleratorFromEvent(e.nativeEvent)
    if (!acc) return
    if (taken.includes(acc)) return toast.error(t('settings.keyTaken', { key: acc }))
    onChange({ accelerator: acc })
    setListening(false)
  }

  const selectClass =
    'h-8 min-w-0 rounded-lg border bg-surface px-2 text-sm outline-none transition-colors hover:border-foreground/30 focus-visible:border-ring'

  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5">
      <button
        type="button"
        onClick={() => setListening(true)}
        onBlur={() => setListening(false)}
        onKeyDown={onKeyDown}
        aria-label={`${hotkey.accelerator || '\u2014'}`}
        className={cn(
          'flex h-8 min-w-28 shrink-0 items-center justify-center rounded-lg border px-3 text-sm transition-colors',
          listening ? 'border-signal bg-signal/10 text-signal' : 'hover:border-foreground/30',
          !hotkey.accelerator && !listening && 'border-dashed text-muted-foreground',
        )}
      >
        {listening ? (
          <span className="text-xs">{t('settings.pressKeys')}</span>
        ) : hotkey.accelerator ? (
          <KbdGroup>
            {acceleratorKeys(hotkey.accelerator).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </KbdGroup>
        ) : (
          <span className="text-xs">{t('settings.setKey')}</span>
        )}
      </button>

      <select
        value={hotkey.action}
        onChange={(e) => {
          const action = e.target.value as Hotkey['action']
          // A screenshot key has no length; give a clip key one back.
          onChange({ action, durationSec: action === 'clip' ? hotkey.durationSec || 30 : 0 })
        }}
        aria-label={t('settings.action')}
        className={cn(selectClass, 'w-52 shrink-0')}
      >
        <option value="clip">{t('settings.actionClip')}</option>
        <option value="shot">{t('settings.actionShot')}</option>
        <option value="shot-copy">{t('settings.actionShotCopy')}</option>
      </select>

      {isClip ? (
        <select
          value={hotkey.durationSec}
          onChange={(e) => onChange({ durationSec: Number(e.target.value) })}
          aria-label={t('settings.clipLength')}
          className={cn(selectClass, 'w-24 shrink-0')}
        >
          {DURATION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {formatDuration(d)}
            </option>
          ))}
        </select>
      ) : (
        <span className="w-24 shrink-0" aria-hidden />
      )}

      {showSessions ? (
        <select
          value={hotkey.sessionId ?? '__all'}
          onChange={(e) => onChange({ sessionId: e.target.value === '__all' ? null : e.target.value })}
          aria-label={t('settings.target')}
          className={cn(selectClass, 'flex-1')}
        >
          {/* A screenshot of "every screen at once" makes no sense. */}
          {isClip && <option value="__all">{t('settings.allSessions')}</option>}
          {sessions.map((x) => (
            <option key={x.id} value={x.id}>
              {/* The resolution tells two screens apart at a glance. */}
              {x.source?.width && x.source?.height ? `${x.name} · ${x.source.width}×${x.source.height}` : x.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex-1" />
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        {isClip ? (
          <button
            type="button"
            onClick={onMakeDefault}
            disabled={hotkey.isDefault}
            title={t('settings.makeDefault')}
            aria-label={t('settings.makeDefault')}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              hotkey.isDefault ? 'text-signal' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Star className={cn('size-4', hotkey.isDefault && 'fill-current')} aria-hidden />
          </button>
        ) : (
          <span className="size-7" aria-hidden />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          disabled={!canDelete}
          aria-label={t('settings.removeHotkey')}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}
