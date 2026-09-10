'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { FolderOpen, Keyboard, Plus, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useClipper } from '@/lib/clipper/provider'
import { acceleratorFromEvent, acceleratorKeys, formatDuration } from '@/lib/clipper/hotkeys'
import { DURATION_OPTIONS, type Hotkey } from '@/lib/clipper/types'
import { PageHeader } from './page-header'

const FPS_ITEMS = { '30': '30 fps', '60': '60 fps' }
const BITRATE_ITEMS = {
  '6': '6 Mbps · Low',
  '12': '12 Mbps · Medium',
  '20': '20 Mbps · High',
  '35': '35 Mbps · Max',
}
const DURATION_ITEMS = Object.fromEntries(DURATION_OPTIONS.map((d) => [String(d), formatDuration(d)]))

export function SettingsPage() {
  const { settings, updateSettings, api, isDesktop, status } = useClipper()
  const armed = status !== 'idle'

  function setHotkeys(hotkeys: Hotkey[]) {
    void updateSettings({ hotkeys })
  }

  function addHotkey() {
    const used = new Set(settings.hotkeys.map((h) => h.durationSec))
    const durationSec = DURATION_OPTIONS.find((d) => !used.has(d)) ?? 60
    setHotkeys([...settings.hotkeys, { id: crypto.randomUUID(), accelerator: '', durationSec }])
  }

  function updateHotkey(id: string, patch: Partial<Hotkey>) {
    setHotkeys(settings.hotkeys.map((h) => (h.id === id ? { ...h, ...patch } : h)))
  }

  function removeHotkey(id: string) {
    const remaining = settings.hotkeys.filter((h) => h.id !== id)
    if (remaining.length && !remaining.some((h) => h.isDefault)) remaining[0] = { ...remaining[0], isDefault: true }
    setHotkeys(remaining)
  }

  function makeDefault(id: string) {
    setHotkeys(settings.hotkeys.map((h) => ({ ...h, isDefault: h.id === id })))
  }

  async function chooseDir() {
    const dir = await api?.chooseClipsDir()
    if (dir) {
      await updateSettings({ clipsDir: dir })
      toast.success('Clips folder updated')
    }
  }

  return (
    <>
      <PageHeader title="Hotkeys & Settings" description="Each hotkey saves a different length of the rolling buffer. Changes apply immediately." />

      <ScrollArea className="flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 p-6">
          <section className="flex flex-col gap-4">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-medium">
                  <Keyboard className="size-4" aria-hidden />
                  Clip hotkeys
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click a key field and press the combination you want. Works system-wide in the desktop app.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={addHotkey}>
                <Plus data-icon="inline-start" />
                Add hotkey
              </Button>
            </div>

            <div className="flex flex-col overflow-hidden rounded-lg border">
              {settings.hotkeys.map((hk, i) => (
                <HotkeyRow
                  key={hk.id}
                  hotkey={hk}
                  taken={settings.hotkeys.filter((h) => h.id !== hk.id).map((h) => h.accelerator)}
                  canDelete={settings.hotkeys.length > 1}
                  first={i === 0}
                  onChange={(patch) => updateHotkey(hk.id, patch)}
                  onRemove={() => removeHotkey(hk.id)}
                  onMakeDefault={() => makeDefault(hk.id)}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              The buffer keeps {formatDuration(Math.max(...settings.hotkeys.map((h) => h.durationSec)))} in memory — the
              longest hotkey decides how much RAM the buffer uses.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-medium">Recording</h2>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="fps">Frame rate</FieldLabel>
                  <FieldDescription>60 fps is smoother; 30 fps halves file size and CPU use.</FieldDescription>
                </FieldContent>
                <Select
                  items={FPS_ITEMS}
                  value={String(settings.fps)}
                  onValueChange={(v) => v && updateSettings({ fps: Number(v) as 30 | 60 })}
                  disabled={armed}
                >
                  <SelectTrigger id="fps" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(FPS_ITEMS).map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="bitrate">Video quality</FieldLabel>
                  <FieldDescription>Bitrate of the buffer. Higher looks better and uses more disk.</FieldDescription>
                </FieldContent>
                <Select
                  items={BITRATE_ITEMS}
                  value={String(settings.videoBitrateMbps)}
                  onValueChange={(v) => v && updateSettings({ videoBitrateMbps: Number(v) })}
                  disabled={armed}
                >
                  <SelectTrigger id="bitrate" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(BITRATE_ITEMS).map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="sysaudio">System audio</FieldLabel>
                  <FieldDescription>Record game and desktop audio with the clip.</FieldDescription>
                </FieldContent>
                <Switch
                  id="sysaudio"
                  checked={settings.captureSystemAudio}
                  onCheckedChange={(v) => updateSettings({ captureSystemAudio: v })}
                  disabled={armed}
                />
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="mic">Microphone</FieldLabel>
                  <FieldDescription>Mix your mic into the recording.</FieldDescription>
                </FieldContent>
                <Switch
                  id="mic"
                  checked={settings.captureMic}
                  onCheckedChange={(v) => updateSettings({ captureMic: v })}
                  disabled={armed}
                />
              </Field>
            </FieldGroup>
            {armed && <p className="text-xs text-signal">Disarm capture to change recording settings.</p>}
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-medium">Storage</h2>
            <FieldSet>
              <FieldLegend className="sr-only">Storage location</FieldLegend>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel>Clips folder</FieldLabel>
                  <FieldDescription className="font-mono text-xs break-all">
                    {isDesktop ? settings.clipsDir ?? 'Videos/Clipper' : 'Browser storage (IndexedDB) — download clips to keep them.'}
                  </FieldDescription>
                </FieldContent>
                {isDesktop && (
                  <Button variant="outline" size="sm" onClick={chooseDir}>
                    <FolderOpen data-icon="inline-start" />
                    Change
                  </Button>
                )}
              </Field>
            </FieldSet>
          </section>
        </div>
      </ScrollArea>
    </>
  )
}

function HotkeyRow({
  hotkey,
  taken,
  canDelete,
  first,
  onChange,
  onRemove,
  onMakeDefault,
}: {
  hotkey: Hotkey
  taken: string[]
  canDelete: boolean
  first: boolean
  onChange: (patch: Partial<Hotkey>) => void
  onRemove: () => void
  onMakeDefault: () => void
}) {
  const [listening, setListening] = React.useState(false)

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!listening) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') return setListening(false)
    const acc = acceleratorFromEvent(e.nativeEvent)
    if (!acc) return
    if (taken.includes(acc)) {
      toast.error(`${acc} is already used by another hotkey.`)
      return
    }
    onChange({ accelerator: acc })
    setListening(false)
  }

  return (
    <div className={cn('flex items-center gap-4 bg-surface px-4 py-3', !first && 'border-t')}>
      <button
        type="button"
        onClick={() => setListening(true)}
        onBlur={() => setListening(false)}
        onKeyDown={onKeyDown}
        aria-label={`Hotkey for ${formatDuration(hotkey.durationSec)} clip: ${hotkey.accelerator || 'unassigned'}. Press to rebind.`}
        className={cn(
          'flex h-9 min-w-40 items-center justify-center rounded-md border px-3 font-mono text-sm transition-colors',
          listening ? 'border-signal bg-signal/10 text-signal' : 'hover:border-foreground/30',
          !hotkey.accelerator && !listening && 'border-dashed text-muted-foreground',
        )}
      >
        {listening ? (
          'Press keys…'
        ) : hotkey.accelerator ? (
          <KbdGroup>
            {acceleratorKeys(hotkey.accelerator).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </KbdGroup>
        ) : (
          'Set key'
        )}
      </button>

      <span className="text-sm text-muted-foreground">saves the last</span>

      <Select
        items={DURATION_ITEMS}
        value={String(hotkey.durationSec)}
        onValueChange={(v) => v && onChange({ durationSec: Number(v) })}
      >
        <SelectTrigger className="w-32" aria-label="Clip length">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {DURATION_OPTIONS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {formatDuration(d)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <div className="ml-auto flex items-center gap-1">
        {hotkey.isDefault ? (
          <Badge variant="secondary" className="gap-1">
            <Star className="size-3 fill-current text-signal" aria-hidden />
            Default
          </Badge>
        ) : (
          <Button variant="ghost" size="sm" onClick={onMakeDefault}>
            Make default
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          disabled={!canDelete}
          aria-label="Remove hotkey"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}
