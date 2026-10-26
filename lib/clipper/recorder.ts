import { SEGMENT_SEC, type AudioLayer, type Codec } from './types'

export type Container = 'webm' | 'mkv'

export interface CodecChoice {
  mimeType: string
  container: Container
  /** Coarse label for the UI / clip metadata. */
  family: 'h264' | 'vp9' | 'vp8'
}

/**
 * H.264 first: on any GPU with a hardware encoder it costs a fraction of the CPU
 * that VP9 does (measured ~5% vs ~35% for one 1080p60 session on an RX 6600 XT),
 * and it remuxes to MP4 without re-encoding. VP9 stays available for smaller files.
 */
const H264_CANDIDATES: CodecChoice[] = [
  // Ask for High profile explicitly: Chromium honours the request and the GPU
  // encodes it just the same, but High has CABAC and B-frames where the default
  // Baseline has neither — noticeably better picture for the same bitrate.
  { mimeType: 'video/x-matroska;codecs=avc1.640028,opus', container: 'mkv', family: 'h264' },
  { mimeType: 'video/x-matroska;codecs=avc1.4D401F,opus', container: 'mkv', family: 'h264' },
  { mimeType: 'video/x-matroska;codecs=avc1,opus', container: 'mkv', family: 'h264' },
  { mimeType: 'video/x-matroska;codecs=avc1', container: 'mkv', family: 'h264' },
]

const VP9_CANDIDATES: CodecChoice[] = [
  { mimeType: 'video/webm;codecs=vp9,opus', container: 'webm', family: 'vp9' },
  { mimeType: 'video/webm;codecs=vp9', container: 'webm', family: 'vp9' },
]

const VP8_CANDIDATES: CodecChoice[] = [
  { mimeType: 'video/webm;codecs=vp8,opus', container: 'webm', family: 'vp8' },
  { mimeType: 'video/webm', container: 'webm', family: 'vp8' },
]

/** Mic-only capture: no video, so the container just needs to hold Opus. */
/**
 * How often the continuous recorder hands us a piece. Smaller means the buffer
 * can start closer to the exact second you asked for; it does not restart the
 * encoder, so it costs nothing in dropped frames.
 */
const CHUNK_MS = 1000

const AUDIO_CANDIDATES: CodecChoice[] = [
  { mimeType: 'audio/webm;codecs=opus', container: 'webm', family: 'vp8' },
  { mimeType: 'audio/webm', container: 'webm', family: 'vp8' },
]

function supported(c: CodecChoice) {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mimeType)
}

export function pickAudioCodec(): CodecChoice {
  return AUDIO_CANDIDATES.find(supported) ?? AUDIO_CANDIDATES[AUDIO_CANDIDATES.length - 1]
}

export function pickCodec(preference: Codec = 'auto'): CodecChoice {
  const order =
    preference === 'vp9'
      ? [...VP9_CANDIDATES, ...VP8_CANDIDATES, ...H264_CANDIDATES]
      : preference === 'h264'
        ? [...H264_CANDIDATES, ...VP9_CANDIDATES, ...VP8_CANDIDATES]
        : [...H264_CANDIDATES, ...VP9_CANDIDATES, ...VP8_CANDIDATES]

  return order.find(supported) ?? { mimeType: 'video/webm', container: 'webm', family: 'vp8' }
}

export interface RecorderOptions {
  maxSeconds: number
  videoBitsPerSecond: number
  /**
   * Desktop mode records independent short segments that ffmpeg stitches together,
   * which yields clean timestamps. Web mode keeps one continuous recording and
   * reuses the header chunk because the browser has no muxer to fix things up.
   */
  mode: 'segmented' | 'continuous'
  codec?: Codec
  /** 'audio' records the mic on its own, as a second layer beside the game. */
  kind?: 'video' | 'audio'
  /**
   * How long each segment runs. Every rotation costs ~0.6s of lost video while
   * the encoder tears down and restarts, so this wants to be as long as the
   * buffer itself: a clip then spans two segments at most, not six.
   */
  segmentSec?: number
}

export interface ClipSlice {
  parts: Blob[]
  mimeType: string
  container: Container
  /** Seconds to skip from the start of the concatenated parts to hit the requested length. */
  trimStartSec: number
  durationSec: number
  inputStartWall: number
  inputEndWall: number
  /**
   * True when the parts are slices of ONE encoder stream and must be joined byte
   * for byte (header first). False means each part is a standalone file for the
   * concat demuxer.
   */
  continuous: boolean
}

interface Segment {
  blob: Blob
  start: number
  end: number
  /** Seconds from the start of the recording — the encoder's own timeline. */
  fromSec?: number
}

export class RollingRecorder {
  readonly codec: CodecChoice
  readonly mimeType: string
  private recorder: MediaRecorder | null = null
  private segments: Segment[] = []
  private header: Blob | null = null
  private chunks: Segment[] = []
  private rotateTimer: ReturnType<typeof setTimeout> | null = null
  private currentStart = 0
  private stopped = false
  /** Bytes of the segment currently being written. */
  private pendingBytes = 0
  private listeners = new Set<() => void>()

  constructor(
    private stream: MediaStream,
    private opts: RecorderOptions,
  ) {
    this.codec = opts.kind === 'audio' ? pickAudioCodec() : pickCodec(opts.codec)
    this.mimeType = this.codec.mimeType
  }

  get bufferedSeconds() {
    const now = Date.now()
    const list = this.opts.mode === 'segmented' ? this.segments : this.chunks
    const oldest = list[0]?.start ?? this.currentStart ?? now
    return Math.min(this.opts.maxSeconds, (now - oldest) / 1000)
  }

  /**
   * Rough RAM held by the buffer right now, for the UI. Includes the segment
   * still being recorded — otherwise this reads 0 MB for the whole first
   * segment, which now lasts as long as the buffer itself.
   */
  get bufferedBytes() {
    const list = this.opts.mode === 'segmented' ? this.segments : this.chunks
    const body = list.reduce((acc, s) => acc + s.blob.size, 0)
    return body + (this.header?.size ?? 0) + this.pendingBytes
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
        container: this.codec.container,
        trimStartSec,
        durationSec: Math.min(seconds, total),
        inputStartWall: selected.length ? selected[0].start + trimStartSec * 1000 : Date.now(),
        inputEndWall: selected.length ? selected[selected.length - 1].end : Date.now(),
        continuous: false,
      }
    }

    // Continuous mode: the header plus the trailing chunks of one unbroken
    // stream. The kept chunks still carry their original timeline, so the file
    // opens with a dead stretch from 0 up to the first kept chunk — trimStartSec
    // is exactly that offset, and cutting there removes it.
    await this.requestData()
    const cutoff = Date.now() - seconds * 1000
    const selected = this.chunks.filter((c) => c.end > cutoff)
    const parts = this.header ? [this.header, ...selected.map((c) => c.blob)] : selected.map((c) => c.blob)
    const total = selected.reduce((acc, c) => acc + (c.end - c.start) / 1000, 0)
    return {
      parts,
      mimeType: this.mimeType,
      container: this.codec.container,
      trimStartSec: selected.length ? (selected[0].fromSec ?? 0) : 0,
      durationSec: Math.min(seconds, total),
      inputStartWall: selected.length ? selected[0].start : Date.now(),
      inputEndWall: selected.length ? selected[selected.length - 1].end : Date.now(),
      // Browser chunks are arbitrary byte splits of one stream, not independently
      // parseable pieces, so this path only holds together for the web fallback.
      continuous: true,
    }
  }

  private makeRecorder() {
    if (this.opts.kind === 'audio') {
      return new MediaRecorder(this.stream, { mimeType: this.mimeType, audioBitsPerSecond: 128_000 })
    }
    const init: MediaRecorderOptions & { videoKeyFrameIntervalDuration?: number } = {
      mimeType: this.mimeType,
      videoBitsPerSecond: this.opts.videoBitsPerSecond,
      videoKeyFrameIntervalDuration: 1000,
    }
    return new MediaRecorder(this.stream, init)
  }

  /** Segment length actually in use. */
  private get segmentSec() {
    return this.opts.segmentSec ?? SEGMENT_SEC
  }

  private prune(list: Segment[]) {
    const cutoff = Date.now() - (this.opts.maxSeconds + this.segmentSec * 2) * 1000
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
    this.pendingBytes = 0
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      parts.push(e.data)
      this.pendingBytes += e.data.size
      this.notify()
    }
    rec.onstop = () => {
      const end = Date.now()
      this.pendingBytes = 0
      if (parts.length) this.segments.push({ blob: new Blob(parts, { type: this.mimeType }), start, end })
      this.prune(this.segments)
      this.notify()
    }
    // A timeslice makes the recorder hand over data as it goes, which is the only
    // way to know how much RAM the in-flight segment is using. It does not split
    // the segment: the pieces are still finalised together on stop().
    rec.start(1000)
    this.recorder = rec
    this.rotateTimer = setTimeout(() => void this.rotate(), this.segmentSec * 1000)
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
    const startedAt = Date.now()
    let last = startedAt
    this.currentStart = last
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      const now = Date.now()
      if (!this.header) {
        this.header = e.data
      } else {
        // fromSec is where this chunk sits on the encoder's own clock, which is
        // what ffmpeg sees once the pieces are glued back together.
        this.chunks.push({ blob: e.data, start: last, end: now, fromSec: (last - startedAt) / 1000 })
      }
      last = now
      this.prune(this.chunks)
      this.notify()
    }
    rec.start(CHUNK_MS)
    this.recorder = rec
  }

  private requestData(): Promise<void> {
    return flush(this.recorder)
  }
}

/** Asks a recorder for whatever it is holding and waits until it has handed it over. */
function flush(rec: MediaRecorder | null): Promise<void> {
  return new Promise((resolve) => {
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

interface AudioTake {
  rec: MediaRecorder
  chunks: Blob[]
  /** Wall-clock ms of the first sample in this recording. */
  startWall: number
}

/**
 * Audio buffer with no gaps, for the system sound and the microphone.
 *
 * A MediaRecorder cannot hand out the middle of its stream as a file of its own,
 * and restarting it to get a fresh file loses the sound while it restarts. So
 * the next recording starts before the previous one is dropped: at any moment
 * one of them is a complete file that began before the window a clip needs,
 * and the main process cuts that window out by wall-clock time.
 */
export class AudioRing {
  readonly codec: CodecChoice
  private takes: AudioTake[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private stream: MediaStream,
    /** Longest clip that will ever be asked for. */
    private maxSeconds: number,
  ) {
    this.codec = pickAudioCodec()
  }

  start() {
    this.startTake()
    this.timer = setInterval(() => this.tick(), 5000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const t of this.takes) if (t.rec.state !== 'inactive') t.rec.stop()
    this.takes = []
    this.stream.getTracks().forEach((t) => t.stop())
  }

  setMaxSeconds(seconds: number) {
    this.maxSeconds = seconds
  }

  /** The newest complete recording that already covered `fromWall`. */
  async layerFrom(fromWall: number): Promise<AudioLayer | null> {
    let pick = this.takes[0]
    for (const t of this.takes) if (t.startWall <= fromWall) pick = t
    if (!pick) return null
    await flush(pick.rec)
    if (!pick.chunks.length) return null
    return {
      parts: await Promise.all(pick.chunks.map((b) => b.arrayBuffer())),
      container: this.codec.container,
      startWall: pick.startWall,
    }
  }

  private startTake() {
    const rec = new MediaRecorder(this.stream, { mimeType: this.codec.mimeType, audioBitsPerSecond: 128_000 })
    const take: AudioTake = { rec, chunks: [], startWall: Date.now() }
    rec.ondataavailable = (e) => {
      if (e.data.size) take.chunks.push(e.data)
    }
    // The recorder really begins on its 'start' event, a few ms after start().
    rec.onstart = () => {
      take.startWall = Date.now()
    }
    rec.start(1000)
    this.takes.push(take)
  }

  private tick() {
    const now = Date.now()
    const newest = this.takes[this.takes.length - 1]
    // Roll over well before a take grows large; the old one keeps covering the
    // gap until the new one is long enough to serve any clip on its own.
    if (newest && now - newest.startWall > (this.maxSeconds + 60) * 1000) this.startTake()
    while (this.takes.length > 1 && now - this.takes[1].startWall > (this.maxSeconds + 10) * 1000) {
      const old = this.takes.shift()!
      if (old.rec.state !== 'inactive') old.rec.stop()
    }
  }
}
