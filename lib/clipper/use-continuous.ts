'use client'
import * as React from 'react'
import { toast } from 'sonner'
import { ContinuousRecorder } from './continuous-recorder'
import type { ClipperAPI } from './api'
import type { ContinuousState, Settings, SourceRef } from './types'
import { sourceRef } from '@/electron/source-identity'

export function useContinuous(api: ClipperAPI | null, settings: Settings, updateSettings: (patch: Partial<Settings>) => Promise<void>, serialize: <T>(fn: () => Promise<T>) => Promise<T>, refresh: () => Promise<unknown>) {
  const [state, setState] = React.useState<ContinuousState>({ status: 'idle', markers: [] })
  const [open, setOpen] = React.useState(false)
  const runtime = React.useRef<ContinuousRecorder | null>(null)
  const busy = React.useRef(false)
  const latest = React.useRef({ settings, state })
  latest.current = { settings, state }
  const stop = React.useCallback(async () => {
    if (!api || busy.current) return
    busy.current = true
    try {
      if (runtime.current) { await runtime.current.stop(); runtime.current = null }
      else if (latest.current.state.id) await api.continuousFinish(latest.current.state.id)
    } catch (e) { runtime.current = null; toast.error(String(e)) }
    finally { busy.current = false; setState(await api.continuousStatus()) }
  }, [api])
  const start = React.useCallback(async (name: string, directory: string, reference: SourceRef) => {
    if (!api || busy.current || latest.current.state.status !== 'idle') return
    busy.current = true
    try {
      await serialize(async () => {
        const source = await api.resolveSource(reference)
        if (!source) throw Error('La pantalla o ventana elegida no está disponible. Elegí una fuente para continuar.')
        const recorder = new ContinuousRecorder(api, error => { toast.error(error.message); void stopRef.current() })
        runtime.current = recorder
        await recorder.start(name, directory, source, latest.current.settings)
        try { await updateSettings({ continuousName: name, continuousDir: directory, continuousSource: sourceRef(source) }) }
        catch { toast.warning('La grabación sigue activa, pero no se pudo recordar el nombre y la carpeta para el atajo.') }
        setOpen(false)
      })
    } catch (e) { runtime.current = null; toast.error(String(e)) }
    finally { busy.current = false; setState(await api.continuousStatus()) }
  }, [api, serialize, updateSettings])
  const stopRef = React.useRef(stop)
  stopRef.current = stop
  const actions = React.useRef({ start, stop })
  actions.current = { start, stop }
  React.useEffect(() => {
    if (!api?.isDesktop) return
    let live = true
    const receive = (value: ContinuousState) => { if (live) setState(value) }
    void api.continuousStatus().then(receive)
    const offState = api.onContinuousState(receive)
    const offSaved = api.onContinuousSaved(() => { void refresh(); toast.success('Grabación guardada en la biblioteca') })
    const offStop = api.onContinuousStop(() => { void actions.current.stop() })
    const offToggle = api.onContinuousToggle(() => {
      const { settings: s, state: current } = latest.current
      if (current.status === 'recording' || current.status === 'error') void actions.current.stop()
      else if (current.status === 'idle') {
        if (s.continuousName && s.continuousDir && s.continuousSource) void actions.current.start(s.continuousName, s.continuousDir, s.continuousSource)
        else setOpen(true)
      }
    })
    return () => { live = false; offState(); offSaved(); offStop(); offToggle() }
  }, [api, refresh])
  const discard = async () => { if (!api || !state.id || state.status !== 'error') return; try { await api.continuousCancel(state.id); setState(await api.continuousStatus()) } catch (e) { toast.error(String(e)) } }
  return { state, open, setOpen, start, stop, discard, mark: async () => { try { await api?.continuousMark() } catch (e) { toast.error(String(e)) } } }
}
export type ContinuousControl = ReturnType<typeof useContinuous>
