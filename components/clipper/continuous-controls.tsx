'use client'
import * as React from 'react'
import { Circle, Flag, FolderOpen, Square, Keyboard } from 'lucide-react'
import { toast } from 'sonner'
import { useClipper } from '@/lib/clipper/provider'
import { acceleratorFromEvent, formatClock } from '@/lib/clipper/hotkeys'
import { matchSourceIdentity, sourceRef } from '@/electron/source-identity'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

export function ContinuousControls() {
  const { api, isDesktop, continuous: c, settings, updateSettings, sources, refreshSources } = useClipper()
  const [name, setName] = React.useState('')
  const [directory, setDirectory] = React.useState('')
  const [source, setSource] = React.useState('')
  const [now, setNow] = React.useState(Date.now())
  const [discarding, setDiscarding] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const active = c.state.status !== 'idle'
  React.useEffect(() => {
    setNow(Date.now())
    if (c.state.status !== 'recording') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [c.state.status])
  React.useEffect(() => {
    if (!c.open) return
    setName(settings.continuousName || `Grabación ${new Date().toLocaleDateString('sv')} ${new Date().toTimeString().slice(0, 8).replaceAll(':', '-')}`)
    setDirectory(settings.continuousDir || settings.clipsDir || '')
    setSource(matchSourceIdentity(sources, settings.continuousSource)?.id || '')
  }, [c.open])
  const beginDialog = async () => {
    await refreshSources()
    setName(settings.continuousName || `Grabación ${new Date().toLocaleDateString('sv')} ${new Date().toTimeString().slice(0, 8).replaceAll(':', '-')}`)
    setDirectory(settings.continuousDir || settings.clipsDir || '')
    setSource('')
    c.setOpen(true)
  }
  if (!isDesktop) return null
  const chosen = sources.find(s => s.id === source)
  const elapsed = c.state.startWall ? (now - c.state.startWall) / 1000 : 0
  return <>
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-2 text-xs" data-testid="continuous-controls">
      {active ? <>
        <span className="flex min-w-0 items-center gap-2"><Circle className="size-3 fill-red-500 text-red-500" /><span className="max-w-64 truncate">{c.state.name}</span><span className="font-mono">{formatClock(elapsed)}</span></span>
        {c.state.status === 'recording' && <Button size="sm" variant="outline" onClick={() => void c.mark()}><Flag className="size-3" />Destacar{settings.continuousMarkerKey ? ` · ${settings.continuousMarkerKey}` : ''}</Button>}
        <span className="text-muted-foreground">{c.state.markers.length} destacados</span>
        <Button size="sm" variant="outline" disabled={c.state.status === 'preparing' || c.state.status === 'stopping'} onClick={() => void c.stop()}><Square className="size-3" />{c.state.status === 'stopping' ? 'Guardando…' : c.state.status === 'error' ? 'Reintentar guardar' : 'Detener y guardar'}</Button>
        {c.state.status === 'error' && <Button size="sm" variant="ghost" onClick={() => setDiscarding(true)}>Descartar temporal</Button>}
        {c.state.error && <span role="alert" className="text-destructive">{c.state.error}</span>}
      </> : <>
        <Button size="sm" variant="outline" onClick={() => void beginDialog()}><Circle className="size-3 text-red-400" />Grabación continua</Button>
        <span className="text-muted-foreground">Grabá una sesión completa y marcá tus momentos destacados.</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void beginDialog()}><Keyboard className="size-3" />Atajos</Button>
      </>}
    </div>
    <Dialog open={discarding} onOpenChange={setDiscarding}><DialogContent><DialogHeader><DialogTitle>Descartar grabación pendiente</DialogTitle><DialogDescription>Se borrarán los datos temporales que todavía no se pudieron guardar. Podés cancelar para reintentar guardarlos.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDiscarding(false)}>Cancelar</Button><Button variant="destructive" onClick={async () => { await c.discard(); setDiscarding(false) }}>Descartar temporal</Button></div></DialogContent></Dialog>
    <Dialog open={c.open} onOpenChange={c.setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Grabación continua</DialogTitle><DialogDescription>Los clips y sus atajos siguen funcionando mientras grabás. Los destacados quedan guardados junto al video.</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={async e => {
          e.preventDefault()
          if (!chosen || !name.trim() || !directory) return
          setStarting(true)
          try { await c.start(name, directory, sourceRef(chosen)!) } finally { setStarting(false) }
        }}>
          <label className="grid gap-1.5 text-sm">Nombre del archivo<Input aria-label="Nombre del archivo" value={name} onChange={e => setName(e.target.value)} required maxLength={120} /></label>
          <label className="grid gap-1.5 text-sm">Carpeta de destino<div className="flex gap-2"><Input aria-label="Carpeta de destino" value={directory} onChange={e => setDirectory(e.target.value)} required /><Button type="button" variant="outline" aria-label="Elegir carpeta" onClick={async () => { const dir = await api?.chooseRecordingDir(); if (dir) setDirectory(dir) }}><FolderOpen className="size-4" /></Button></div></label>
          <label className="grid gap-1.5 text-sm">Pantalla o ventana<select className="h-9 rounded-md border bg-background px-3" aria-label="Fuente de grabación" required value={source} onChange={e => setSource(e.target.value)}><option value="">Elegí qué grabar</option>{sources.map(s => <option key={s.id} value={s.id}>{s.name}{s.width ? ` · ${s.width}×${s.height}` : ''}</option>)}</select></label>
          <div className="grid gap-3 rounded-lg border p-3">
            <Keybind label="Iniciar / detener (opcional)" value={settings.continuousToggleKey} forbidden={[...settings.hotkeys.map(h => h.accelerator), settings.continuousMarkerKey]} onChange={value => updateSettings({ continuousToggleKey: value })} />
            <Keybind label="Marcar destacado (opcional)" value={settings.continuousMarkerKey} forbidden={[...settings.hotkeys.map(h => h.accelerator), settings.continuousToggleKey]} onChange={value => updateSettings({ continuousMarkerKey: value })} />
            <p className="text-xs text-muted-foreground">Sin tecla de inicio, se inicia únicamente con el botón. El atajo recuerda el último nombre, carpeta y pantalla; crea un archivo nuevo cada vez.</p>
          </div>
          <Button type="submit" disabled={starting || !chosen || !name.trim() || !directory}><Circle className="size-4" />{starting ? 'Iniciando…' : 'Iniciar grabación'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </>
}

function Keybind({ label, value, forbidden, onChange }: { label: string; value: string; forbidden: string[]; onChange: (key: string) => Promise<void> }) {
  const { api } = useClipper()
  const [listening, setListening] = React.useState(false)
  React.useEffect(() => {
    if (!listening || !api) return
    void api.captureHotkeys(true)
    const timer = setTimeout(() => setListening(false), 15000)
    return () => { clearTimeout(timer); void api.captureHotkeys(false) }
  }, [listening, api])
  return <div className="flex items-center justify-between gap-2 text-sm"><span>{label}</span><div className="flex items-center gap-1"><Button type="button" variant="outline" size="sm" aria-label={label} onClick={() => setListening(true)} onBlur={() => setListening(false)} onKeyDown={e => {
    if (!listening) return
    e.preventDefault(); e.stopPropagation()
    if (e.key === 'Escape') { setListening(false); return }
    const key = acceleratorFromEvent(e.nativeEvent)
    if (!key) return
    if (forbidden.some(k => k.toLowerCase() === key.toLowerCase())) { toast.error('Esa tecla ya está asignada a otra acción.'); return }
    setListening(false); void onChange(key)
  }}>{listening ? 'Presioná una tecla…' : value || 'Sin tecla'}</Button>{value && <Button type="button" variant="ghost" size="sm" aria-label={`Quitar ${label}`} onClick={() => void onChange('')}>×</Button>}</div></div>
}
