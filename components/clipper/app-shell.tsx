'use client'

import * as React from 'react'
import { Film, Monitor, Settings2, Scissors } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useClipper, type Page } from '@/lib/clipper/provider'
import { useT, type DictKey } from '@/lib/i18n'
import { TopBar } from './top-bar'
import { GalleryPage } from './gallery-page'
import { CapturePage } from './capture-page'
import { SettingsPage } from './settings-page'
import { ClipViewer } from './clip-viewer'
import { SetupDialog } from './setup-dialog'

const NAV: { id: Page; label: DictKey; icon: typeof Film }[] = [
  { id: 'gallery', label: 'nav.clips', icon: Film },
  { id: 'capture', label: 'nav.capture', icon: Monitor },
  { id: 'settings', label: 'nav.settings', icon: Settings2 },
]

export function AppShell() {
  const { page, setPage, clips, isDesktop, ready, status, settings, showSetup, setShowSetup } = useClipper()
  const t = useT()

  // First run: ask about the screens before anything else makes sense.
  React.useEffect(() => {
    if (ready && isDesktop && !settings.setupDone) setShowSetup(true)
  }, [ready, isDesktop, settings.setupDone, setShowSetup])
  const armed = status === 'armed' || status === 'saving'

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="flex w-52 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-16 items-center gap-2.5 px-4">
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-lg bg-signal text-signal-foreground transition-shadow',
              armed && 'rec-glow',
            )}
          >
            <Scissors className="size-4" aria-hidden />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight">Clipper</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {isDesktop ? t('app.desktop') : t('app.browser')}
            </span>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 px-2 py-2" aria-label="Main">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = page === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPage(id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                  active
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                )}
              >
                {active && (
                  <span className="absolute left-0 h-5 w-0.5 -translate-x-1 rounded-full bg-signal" aria-hidden />
                )}
                <Icon className="size-[18px] shrink-0" aria-hidden />
                <span className="flex-1 text-left">{t(label)}</span>
                {id === 'gallery' && ready && clips.length > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {clips.length}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Pinned to the bottom so "which build am I running?" is answered at a glance. */}
        <span className="mt-auto px-4 py-3 font-mono text-[10px] text-muted-foreground/70">
          v{process.env.NEXT_PUBLIC_APP_VERSION}
        </span>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {page === 'gallery' && <GalleryPage />}
          {page === 'capture' && <CapturePage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>

      <ClipViewer />
      <SetupDialog open={showSetup} onClose={() => setShowSetup(false)} />
    </div>
  )
}
