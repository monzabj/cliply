import type { ClipperAPI } from './api'
import type { CaptureSource, Settings } from './types'
import { pickCodec, pickAudioCodec } from './recorder'

/** Streams encoder chunks to disk. Neither video nor microphone grows with duration. */
export class ContinuousRecorder {
  private tracks: MediaStreamTrack[] = []
  private recorders: MediaRecorder[] = []
  private writes: Promise<void> = Promise.resolve()
  private stops = new Map<MediaRecorder, Promise<void>>()
  private began = new Set<MediaRecorder>()
  private queued = 0
  private failure: Error | null = null
  private ending: Promise<unknown> | null = null
  id = ''

  constructor(private api: ClipperAPI, private onError: (error: Error) => void) {}

  async start(name: string, directory: string, source: CaptureSource, settings: Settings) {
    const codec = pickCodec(settings.codec)
    const state = await this.api.continuousPrepare({ name, directory, source, container: codec.container })
    this.id = state.id!
    try {
      await this.api.selectSource(source)
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: settings.fps, max: settings.fps } },
        audio: settings.captureSystemAudio ? { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
      })
      this.tracks.push(...stream.getTracks())
      if (settings.captureSystemAudio && !stream.getAudioTracks().length) throw Error('No se pudo capturar el audio de Computadora.')
      let mic: MediaStream | null = null
      if (settings.captureMic) {
        mic = await navigator.mediaDevices.getUserMedia({ audio: {
          ...(settings.micDeviceId ? { deviceId: { exact: settings.micDeviceId } } : {}),
          echoCancellation: false, noiseSuppression: true, autoGainControl: true,
        } })
        this.tracks.push(...mic.getTracks())
      }
      const video = this.encoder(stream, 'video', codec.mimeType, settings.videoBitrateMbps * 1_000_000)
      const microphone = mic ? this.encoder(mic, 'mic', pickAudioCodec().mimeType) : null
      const wall = Date.now()
      video.start(1000); this.began.add(video)
      if (microphone) { microphone.start(1000); this.began.add(microphone) }
      await this.api.continuousStarted(this.id, wall, mic ? wall : undefined)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => this.onError(Error('Se cerró la fuente de video. La grabación se guardará.')), { once: true })
    } catch (error) {
      this.recorders.forEach(r => { if (r.state !== 'inactive') r.stop() })
      this.tracks.forEach(t => t.stop())
      await Promise.all([...this.began].map(r => this.stops.get(r)))
      await this.writes
      await this.api.continuousCancel(this.id)
      throw error
    }
  }

  private encoder(stream: MediaStream, kind: 'video' | 'mic', mimeType: string, bitrate?: number) {
    const recorder = new MediaRecorder(stream, { mimeType, ...(bitrate ? { videoBitsPerSecond: bitrate } : {}), audioBitsPerSecond: 160000 })
    this.recorders.push(recorder)
    this.stops.set(recorder, new Promise(resolve => recorder.addEventListener('stop', () => resolve(), { once: true })))
    recorder.addEventListener('dataavailable', event => {
      if (!event.data.size) return
      this.queued += event.data.size
      if (this.queued > 64 * 1024 * 1024 && !this.failure) {
        this.failure = Error('El disco no está guardando a tiempo. Se detuvo la captura para guardar lo recibido.')
        this.onError(this.failure)
      }
      this.writes = this.writes.then(async () => {
        try { await this.api.continuousAppend(this.id, kind, await event.data.arrayBuffer()) }
        finally { this.queued -= event.data.size }
      }).catch(error => { this.failure = error; this.onError(error) })
    })
    recorder.addEventListener('error', () => this.onError(Error('Se interrumpió el codificador de video.')))
    return recorder
  }

  stop() {
    if (this.ending) return this.ending
    this.ending = (async () => {
      const wall = Date.now()
      this.recorders.forEach(r => { if (r.state !== 'inactive') r.stop() })
      await Promise.all([...this.began].map(r => this.stops.get(r)))
      this.tracks.forEach(t => t.stop())
      await this.writes
      return this.api.continuousFinish(this.id, wall)
    })()
    return this.ending
  }
}
