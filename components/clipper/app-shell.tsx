'use client'

import { Film, Radio, Settings2, Scissors } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useClipper, type Page } from '@/lib/clipper/provider'
import { StatusPill } from './status-pill'
import { GalleryPage } from './gallery-page'
import { CapturePage } from './capture-page'
import { SettingsPage } from './settings-page'
import { ClipViewer } from './clip-viewer'

const NAV: { id: Page; label: string; icon: typeof Film }[] = [
  { id: 'gallery', label: 'Clips', icon: Film },
  { id: 'capture', label: 'Capture', icon: Radio },
  { id: 'settings', label: 'Hotkeys & Settings', icon: Settings2 },
]

export function AppShell() {
  const { page, setPage, clips, isDesktop, ready } = useClipper()

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-signal text-signal-foreground">
            <Scissors className="size-4" aria-hidden />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight">Clipper</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {isDesktop ? 'desktop' : 'browser preview'}
            </span>
          </div>
        </div>

        <nav className="flex flex-col gap-1 p-2" aria-label="Main">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPage(id)}
              aria-current={page === id ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors',
                page === id
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span className="flex-1 text-left">{label}</span>
              {id === 'gallery' && ready && (
                <span className="font-mono text-xs text-muted-foreground">{clips.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-auto p-3">
          <StatusPill />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {page === 'gallery' && <GalleryPage />}
        {page === 'capture' && <CapturePage />}
        {page === 'settings' && <SettingsPage />}
      </main>

      <ClipViewer />
    </div>
  )
}
