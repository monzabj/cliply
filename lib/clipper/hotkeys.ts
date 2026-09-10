const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Enter: 'Return',
  Tab: 'Tab',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  '+': 'Plus',
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

export function isModifierKey(key: string) {
  return MODIFIER_KEYS.has(key)
}

/**
 * Converts a KeyboardEvent into an Electron-style accelerator such as
 * "F8" or "CommandOrControl+Shift+F9". Returns null while only modifiers are held.
 */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (isModifierKey(e.key)) return null

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  let key = e.key
  if (KEY_ALIASES[key]) key = KEY_ALIASES[key]
  else if (key.length === 1) key = key.toUpperCase()

  parts.push(key)
  return parts.join('+')
}

export function eventMatchesAccelerator(e: KeyboardEvent, accelerator: string) {
  return acceleratorFromEvent(e) === accelerator
}

export function acceleratorKeys(accelerator: string): string[] {
  return accelerator.split('+').map((part) => {
    if (part === 'CommandOrControl') return 'Ctrl'
    return part
  })
}

export function formatDuration(sec: number) {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

export function formatTimecode(sec: number) {
  const total = Math.max(0, sec)
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  const ms = Math.floor((total % 1) * 10)
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`
}
