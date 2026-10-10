'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * The real file name, sitting quietly next to the title. Click it to rename the
 * file on disk; the extension is shown but never editable, since changing it
 * would only produce a file nothing can open.
 */
export function FileNameEditor({
  fileName,
  onRename,
  className,
}: {
  fileName: string
  onRename: (baseName: string) => Promise<void>
  className?: string
}) {
  const t = useT()
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''

  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(base)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => setDraft(base), [base])

  async function commit() {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === base) {
      setDraft(base)
      return
    }
    setBusy(true)
    try {
      await onRename(next)
    } catch (err) {
      setDraft(base)
      toast.error(t('viewer.renameFileFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <span className={cn('flex min-w-0 items-center font-mono text-xs', className)}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) void commit()
            if (e.key === 'Escape') {
              setDraft(base)
              setEditing(false)
            }
          }}
          size={Math.max(12, Math.min(48, draft.length + 1))}
          aria-label={t('viewer.fileName')}
          className="min-w-0 rounded border border-ring bg-surface px-1.5 py-0.5 font-mono text-xs outline-none"
        />
        <span className="shrink-0 pl-0.5 text-muted-foreground">{ext}</span>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={busy}
      title={t('viewer.fileNameHint')}
      className={cn(
        'min-w-0 truncate rounded px-1 py-0.5 text-left font-mono text-xs text-muted-foreground/70 transition-colors',
        'hover:bg-accent hover:text-muted-foreground disabled:opacity-50',
        className,
      )}
    >
      {base}
      <span className="opacity-60">{ext}</span>
    </button>
  )
}
