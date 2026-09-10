import { SEGMENT_SEC } from './types'

export interface RecorderOptions {
  maxSeconds: number
  videoBitsPerSecond: number
  /**
   * Desktop mode records independent short segments that ffmpeg stitches together,
   * which yields clean timestamps. Web mode keeps one continuous recording and
   * reuses the header chunk because the browser has no muxer to fix things up.
   */
  mode: 'segmented' | 'continuous'
}

export interface ClipSlice {
  parts: Blob[]
  mimeType: string
  /** Seconds to skip from the start of the concatenated parts to hit the requested length. */
  trimStartSec: number
  durationSec: number
}

interface Segment {
  blob: Blob
  start: number
  end: number
}

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return candidates.find((c) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) ?? 'video/webm'
}

export class RollingRecorder {
  readonly mimeType = pickMimeType()
  private recorder: MediaRecorder | null = null
  private segments: Segment[] = []
  private header: Blob | null = null
  private chunks: Segment[] = []
  private rotateTimer: ReturnType<typeof setTimeout> | null = null
  private currentStart = 0
  private stopped = false
  private listeners = new Set<() => void>()

  constructor(
    private stream: MediaStream,
    private opts: RecorderOptions,
  ) {}

  get bufferedSeconds() {
    const now = Date.now()
    const list = this.opts.mode === 'segmented' ? this.segments : this.chunks
    const oldest = list[0]?.start ?? this.currentStart ?? now
    return Math.min(this.opts.maxSeconds, (now - oldest) / 1000)
  }

  onUpdate(cb: () => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  start() {
    this.stopped = false
    if (this.opts.mode === 'segmented') this.startSegment()
    else this.startContinuous()
  }

  stop() {
    this.stopped = true
    if (this.rotateTimer) clearTimeout(this.rotateTimer)
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.recorder = null
    this.stream.getTracks().forEach((t) => t.stop())
  }

  async getLast(seconds: number): Promise<ClipSlice> {
    if (this.opts.mode === 'segmented') {
      await this.rotate()
      const cutoff = Date.now() - seconds * 1000
      const selected = this.segments.filter((s) => s.end > cutoff)
      const total = selected.reduce((acc, s) => acc + (s.end - s.start) / 1000, 0)
      const trimStartSec = Math.max(0, total - seconds)
      return {
        parts: selected.map((s) => s.blob),
        mimeType: this.mimeType,
        trimStartSec,
        durationSec: Math.min(seconds, total),
      }
    }

    // Continuous mode: header chunk + trailing chunks.
    await this.requestData()
    const cutoff = Date.now() - seconds * 1000
    const selected = this.chunks.filter((c) => c.end > cutoff)
    const parts = this.header ? [this.header, ...selected.map((c) => c.blob)] : selected.map((c) => c.blob)
    const total = selected.reduce((acc, c) => acc + (c.end - c.start) / 1000, 0)
    return {
      parts,
      mimeType: this.mimeType,
      trimStartSec: 0,
      durationSec: Math.min(seconds, total),
    }
  }

  private makeRecorder() {
    const init: MediaRecorderOptions & { videoKeyFrameIntervalDuration?: number } = {
      mimeType: this.mimeType,
      videoBitsPerSecond: this.opts.videoBitsPerSecond,
      videoKeyFrameIntervalDuration: 1000,
    }
    return new MediaRecorder(this.stream, init)
  }

  private prune(list: Segment[]) {
    const cutoff = Date.now() - (this.opts.maxSeconds + SEGMENT_SEC * 2) * 1000
    while (list.length && list[0].end < cutoff) list.shift()
  }

  private notify() {
    this.listeners.forEach((cb) => cb())
  }

  // --- segmented -------------------------------------------------------------

  private startSegment() {
    if (this.stopped) return
    const rec = this.makeRecorder()
    const start = Date.now()
    this.currentStart = start
    const parts: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data)
    rec.onstop = () => {
      const end = Date.now()
      if (parts.length) this.segments.push({ blob: new Blob(parts, { type: this.mimeType }), start, end })
      this.prune(this.segments)
      this.notify()
    }
    rec.start()
    this.recorder = rec
    this.rotateTimer = setTimeout(() => void this.rotate(), SEGMENT_SEC * 1000)
  }

  private rotate(): Promise<void> {
    return new Promise((resolve) => {
      const rec = this.recorder
      if (this.rotateTimer) clearTimeout(this.rotateTimer)
      if (!rec || rec.state === 'inactive') {
        this.startSegment()
        return resolve()
      }
      const prevStop = rec.onstop
      rec.onstop = (ev) => {
        prevStop?.call(rec, ev)
        this.startSegment()
        resolve()
      }
      rec.stop()
    })
  }

  // --- continuous --------------------------------------------------------------

  private startContinuous() {
    const rec = this.makeRecorder()
    let last = Date.now()
    this.currentStart = last
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      const now = Date.now()
      if (!this.header) this.header = e.data
      else this.chunks.push({ blob: e.data, start: last, end: now })
      last = now
      this.prune(this.chunks)
      this.notify()
    }
    rec.start(1000)
    this.recorder = rec
  }

  private requestData(): Promise<void> {
    return new Promise((resolve) => {
      const rec = this.recorder
      if (!rec || rec.state !== 'recording') return resolve()
      const prev = rec.ondataavailable
      rec.ondataavailable = (e) => {
        prev?.call(rec, e)
        rec.ondataavailable = prev
        resolve()
      }
      rec.requestData()
    })
  }
}
