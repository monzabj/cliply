'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Calendar, ClipboardCopy, Download, FolderOpen, Gamepad2, Monitor, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useClipper } from '@/lib/clipper/provider'
import { useT } from '@/lib/i18n'
import { formatBytes, useRelativeDate, useTimeLabel } from './gallery-page'
import { FileNameEditor } from './file-name'

/** Full-size view of a screenshot, with the same actions a clip gets. */
export function ShotViewer({ shotId, onClose }: { shotId: string | null; onClose: () => void }) {
  const { api, shots, deleteShot, renameShot, renameShotFile, isDesktop } = useClipper()
  const t = useT()
  const relativeOf = useRelativeDate()
  const timeLabelOf = useTimeLabel()

  const shot = shots.find((s) => s.id === shotId) ?? null
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')

  React.useEffect(() => setEditing(false), [shotId])

  if (!shot) {
    return (
      <Dialog open={false} onOpenChange={() => onClose()}>
        <DialogContent />
      </Dialog>
    )
  }

  const url = api?.getShotUrl(shot) ?? ''

  async function commitTitle() {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== shot!.title) await renameShot(shot!.id, next)
  }

  return (
    <>
      <Dialog open={Boolean(shotId)} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          className="flex max-h-[94vh] w-[min(1150px,96vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
          showCloseButton
        >
          <DialogHeader className="border-b px-5 py-3.5 text-left">
            <div className="flex min-w-0 flex-col gap-1 pr-8">
              {editing ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) void commitTitle()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  className="h-8 w-80"
                  aria-label={t('viewer.title')}
                />
              ) : (
                <DialogTitle className="flex items-center gap-2 text-base">
                  <span className="truncate">{shot.title}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(shot.title)
                      setEditing(true)
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={t('viewer.rename')}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  {isDesktop && (
                    <FileNameEditor fileName={shot.fileName} onRename={(base) => renameShotFile(shot.id, base)} />
                  )}
                </DialogTitle>
              )}
              <DialogDescription className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5">
                  <Calendar className="size-3.5" aria-hidden />
                  {relativeOf(shot.createdAt)} · {timeLabelOf(shot.createdAt)}
                </span>
                {shot.source.app && (
                  <span className="flex items-center gap-1.5">
                    <Gamepad2 className="size-3.5" aria-hidden />
                    {shot.source.app}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Monitor className="size-3.5" aria-hidden />
                  {shot.source.sessionName ?? shot.source.name}
                </span>
                <span className="font-mono">
                  {shot.width}×{shot.height} · {formatBytes(shot.sizeBytes)}
                </span>
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={shot.title} className="max-h-[70vh] w-full object-contain" />
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
            {isDesktop && (
              <Button variant="ghost" size="sm" onClick={() => api?.showShotInFolder(shot.id)}>
                <FolderOpen data-icon="inline-start" />
                {t('viewer.showInFolder')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const okCopy = await api?.copyShotFile(shot.id)
                if (okCopy) toast.success(t('viewer.copied'))
                else toast.error(t('viewer.copyFailed'))
              }}
            >
              <ClipboardCopy data-icon="inline-start" />
              {t('viewer.copyFile')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => api?.exportShot(shot.id)}>
              <Download data-icon="inline-start" />
              {t('viewer.export')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 data-icon="inline-start" />
              {t('viewer.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('viewer.deleteShotTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('viewer.deleteBodyDesktop')} {t('viewer.deleteUndo')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('viewer.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                await deleteShot(shot.id)
                setDeleteOpen(false)
                onClose()
                toast(t('toast.shotDeleted'))
              }}
            >
              {t('viewer.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
