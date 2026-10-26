const { desktopCapturer } = require('electron')
const { spawn, execFile } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const log = require('./log')
const ffmpeg = require('./ffmpeg')

/**
 * Screen recording outside Chromium.
 *
 * Chromium's screen capture tops out around 30–40 fps on a lot of machines:
 * when DXGI Desktop Duplication cannot open an output (virtual displays such as
 * Parsec's, HDR, some multi-GPU setups) it falls back to GDI, and either way it
 * throttles itself to half a CPU core. ffmpeg's ddagrab reads the same desktop
 * on the GPU and hands frames straight to the hardware encoder — measured a
 * flat 60 fps (worst gap 17 ms) on a display where Chromium managed 31.
 *
 * Each armed screen runs one ffmpeg that never stops: it writes a ring of short
 * MPEG-TS segments to a temp folder. A clip is the last few segments joined
 * byte for byte — one continuous encoder stream, so there are no seams and no
 * frames lost to restarting an encoder on every keypress.
 */

const SEGMENT_SEC = 2
// Keyframes on a fixed half-second grid, so a clip can open on an exact
// keyframe without re-encoding and the audio can be cut to the same instant.
const KEYFRAME_SEC = 0.5

const RING_ROOT = path.join(process.env.CLIPPER_TEST_DATA || os.tmpdir(), 'clipper-ring')

function runCapture(args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(
      ffmpeg.binary(),
      ['-hide_banner', ...args],
      { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr: String(stderr || '') }),
    )
  })
}

// --- outputs -------------------------------------------------------------------

let outputsCache = null

/** DXGI outputs ddagrab can open, in its own index order, with their sizes. */
async function listOutputs() {
  if (outputsCache) return outputsCache
  const found = []
  for (let idx = 0; idx < 8; idx++) {
    const r = await runCapture(
      ['-loglevel', 'verbose', '-f', 'lavfi', '-i', `ddagrab=output_idx=${idx}:framerate=1`, '-frames:v', '1', '-f', 'null', '-'],
      10000,
    )
    const m = /Opened dxgi output (\d+) with dimensions (\d+)x(\d+)/.exec(r.stderr)
    if (!m) break
    found.push({ idx, width: Number(m[2]), height: Number(m[3]) })
  }
  outputsCache = found
  log.write('nativo', `salidas DXGI: ${found.map((o) => `#${o.idx} ${o.width}x${o.height}`).join(', ') || 'ninguna'}`)
  return found
}

function invalidateOutputs() {
  outputsCache = null
  mapCache.clear()
}

/** Tiny grayscale fingerprint of what an output is showing right now. */
async function outputFingerprint(idx) {
  const r = await runCapture([
    '-loglevel', 'error', '-f', 'lavfi', '-i', `ddagrab=output_idx=${idx}:framerate=5`,
    '-frames:v', '1', '-vf', 'hwdownload,format=bgra,scale=32:18,format=gray', '-f', 'rawvideo', '-',
  ])
  return r.ok ? r.stdout : null
}

function thumbFingerprint(img) {
  const small = img.resize({ width: 32, height: 18, quality: 'good' }).toBitmap() // BGRA
  const out = Buffer.alloc(32 * 18)
  for (let i = 0; i < out.length; i++) {
    const b = small[i * 4], g = small[i * 4 + 1], r = small[i * 4 + 2]
    out[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }
  return out
}

const mapCache = new Map()

/**
 * Finds the ddagrab output that shows a given Electron display. Size decides it
 * almost always; two identical monitors are told apart by comparing what each
 * one is showing against Electron's own thumbnail of the display.
 */
async function outputForDisplay(displayId, width, height) {
  const key = `${displayId}|${width}x${height}`
  if (mapCache.has(key)) return mapCache.get(key)

  const outputs = await listOutputs()
  const same = outputs.filter((o) => o.width === width && o.height === height)
  let picked = null
  if (same.length === 1) picked = same[0].idx
  else if (same.length > 1) {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } })
    const src = sources.find((s) => String(s.display_id) === String(displayId))
    if (src && !src.thumbnail.isEmpty()) {
      const want = thumbFingerprint(src.thumbnail)
      let best = Infinity
      for (const o of same) {
        const fp = await outputFingerprint(o.idx)
        if (!fp) continue
        let diff = 0
        for (let i = 0; i < want.length; i++) diff += Math.abs(want[i] - fp[i])
        if (diff < best) {
          best = diff
          picked = o.idx
        }
      }
    }
    if (picked === null) picked = same[0].idx
  }
  if (picked !== null) mapCache.set(key, picked)
  return picked
}

// --- encoder -------------------------------------------------------------------

/** Ordered by preference; each entry knows its own flags. */
const ENCODERS = [
  {
    name: 'h264_nvenc',
    label: 'H.264 · NVIDIA',
    args: (b, g) => ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-profile:v', 'high', '-rc', 'cbr',
      '-b:v', b, '-maxrate', b, '-bufsize', b, '-g', g, '-bf', '0', '-no-scenecut', '1'],
  },
  {
    name: 'h264_amf',
    label: 'H.264 · AMD',
    args: (b, g) => ['-c:v', 'h264_amf', '-quality', 'balanced', '-profile:v', 'high', '-rc', 'cbr',
      '-b:v', b, '-maxrate', b, '-bufsize', b, '-g', g, '-bf', '0'],
  },
  {
    name: 'h264_qsv',
    label: 'H.264 · Intel',
    filter: 'hwmap=derive_device=qsv,format=qsv',
    args: (b, g) => ['-c:v', 'h264_qsv', '-preset', 'faster', '-profile:v', 'high', '-b:v', b, '-maxrate', b, '-g', g, '-bf', '0'],
  },
  {
    name: 'libx264',
    label: 'H.264 · CPU',
    filter: 'hwdownload,format=bgra',
    args: (b, g) => ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
      '-b:v', b, '-maxrate', b, '-bufsize', b, '-g', g, '-bf', '0'],
  },
]

let encoderCache = null

/** First encoder that actually takes frames from ddagrab on this machine. */
async function pickEncoder() {
  if (encoderCache) return encoderCache
  for (const enc of ENCODERS) {
    const r = await runCapture([
      '-loglevel', 'error', '-f', 'lavfi', '-i', 'ddagrab=output_idx=0:framerate=30',
      ...(enc.filter ? ['-vf', enc.filter] : []),
      '-frames:v', '5', ...enc.args('4M', '30'), '-f', 'null', '-',
    ])
    if (r.ok) {
      encoderCache = enc
      log.write('nativo', `encoder: ${enc.name}`)
      return enc
    }
  }
  encoderCache = false
  log.write('nativo', 'ningún encoder funcionó con ddagrab; queda la captura de Chromium')
  return false
}

// --- rings ---------------------------------------------------------------------

/** @type {Map<string, Ring>} */
const rings = new Map()

class Ring {
  constructor(sessionId, opts) {
    this.sessionId = sessionId
    this.opts = opts
    this.gen = 0
    this.proc = null
    this.dir = null
    this.offset = null // wall ms at stream time 0
    this.lastOutTime = 0 // seconds of stream written
    this.stopping = false
    this.restarts = 0
  }

  get wrap() {
    return Math.ceil((this.opts.maxSeconds + 6) / SEGMENT_SEC) + 2
  }

  async start() {
    this.gen++
    this.offset = null
    this.lastOutTime = 0
    this.dir = path.join(RING_ROOT, `${this.sessionId}-${process.pid}-${this.gen}`)
    await fs.rm(this.dir, { recursive: true, force: true })
    await fs.mkdir(this.dir, { recursive: true })

    const { outputIdx, fps, bitrateMbps, encoder } = this.opts
    const b = `${bitrateMbps}M`
    const g = String(Math.round(fps * KEYFRAME_SEC))
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-stats_period', '0.25',
      '-f', 'lavfi', '-i', `ddagrab=output_idx=${outputIdx}:framerate=${fps}:draw_mouse=1`,
      ...(encoder.filter ? ['-vf', encoder.filter] : []),
      ...encoder.args(b, g),
      '-force_key_frames', `expr:gte(t,n_forced*${KEYFRAME_SEC})`,
      '-flush_packets', '1',
      '-f', 'segment', '-segment_time', String(SEGMENT_SEC), '-segment_format', 'mpegts',
      '-segment_wrap', String(this.wrap), '-segment_list', path.join(this.dir, 'list.csv'),
      '-segment_list_type', 'csv', '-segment_list_size', String(this.wrap), '-reset_timestamps', '0',
      path.join(this.dir, 'seg%03d.ts'),
    ]

    const proc = spawn(ffmpeg.binary(), args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    let err = ''
    let buf = ''
    proc.stdout.on('data', (d) => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        const m = /^out_time_us=(\d+)/.exec(line)
        if (!m) continue
        const t = Number(m[1]) / 1e6
        if (t <= 0) continue
        this.lastOutTime = t
        // Smallest wall-minus-stream seen is the closest to the true offset: any
        // delay in reporting only ever makes the estimate later, never earlier.
        const est = Date.now() - t * 1000
        if (this.offset === null || est < this.offset) this.offset = est
      }
    })
    proc.stderr.on('data', (d) => {
      err = (err + d).slice(-2000)
    })
    proc.on('exit', (code) => {
      if (this.proc !== proc) return
      this.proc = null
      if (this.stopping) return
      log.write('nativo', `${this.sessionId}: ffmpeg terminó (code=${code}) ${err.trim().split('\n').pop() || ''}`)
      // Display changes (resolution, a UAC prompt, a game going exclusive) can
      // drop the duplication; come back rather than leave the session dead.
      if (this.restarts < 20) {
        this.restarts++
        setTimeout(() => {
          if (!this.stopping) void this.start().catch((e) => log.write('nativo', `reinicio fallo: ${e.message}`))
        }, Math.min(5000, 500 * this.restarts))
      }
    })

    // Wait for the first frames so arming reports failure instead of a dead buffer.
    const deadline = Date.now() + 8000
    while (this.offset === null && this.proc === proc && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (this.offset === null) {
      const why = err.trim().split('\n').pop() || 'sin frames'
      this.stopping = true
      try { proc.kill() } catch {}
      throw new Error(`ffmpeg no arrancó: ${why}`)
    }
    this.restarts = 0
    log.write('nativo', `${this.sessionId}: grabando salida #${outputIdx} a ${fps} fps con ${encoder.name}`)
  }

  async stop() {
    this.stopping = true
    const proc = this.proc
    this.proc = null
    if (proc) {
      try { proc.stdin.write('q\n') } catch {}
      await new Promise((r) => {
        const t = setTimeout(() => { try { proc.kill() } catch {}; r() }, 2000)
        proc.once('exit', () => { clearTimeout(t); r() })
      })
    }
    if (this.dir) await fs.rm(this.dir, { recursive: true, force: true }).catch(() => {})
  }

  /** Segments on disk, oldest first, including the one still being written. */
  async segments() {
    const csv = await fs.readFile(path.join(this.dir, 'list.csv'), 'utf8').catch(() => '')
    const closed = csv
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [name, s, e] = l.split(',')
        return { name, start: Number(s), end: Number(e) }
      })
    const last = closed[closed.length - 1]
    const nextIdx = last ? (Number(/(\d+)/.exec(last.name)[1]) + 1) % this.wrap : 0
    const current = {
      name: `seg${String(nextIdx).padStart(3, '0')}.ts`,
      start: last ? last.end : 0,
      end: Infinity,
    }
    return [...closed, current]
  }

  /**
   * Copies the slice covering [endWall - durationSec, endWall] into `outTs`.
   * Returns where the clip opens inside that file and on the wall clock.
   */
  async cut(endWall, durationSec, outTs) {
    if (this.offset === null) throw new Error('el buffer todavía no tiene video')
    // Progress is reported every 250 ms; wait for the stream to reach the moment
    // the key was pressed, so that moment is in the clip rather than just before it.
    const deadline = Date.now() + 800
    while (this.offset + this.lastOutTime * 1000 < endWall && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 40))
    }
    const end = Math.min((endWall - this.offset) / 1000, this.lastOutTime)
    const want = Math.max(0, end - durationSec)
    const segs = (await this.segments()).filter((s) => s.end > want && s.start < end)
    if (!segs.length) throw new Error('el buffer está vacío')

    // Never open before the oldest segment still on disk.
    const startAt = Math.max(want, segs[0].start)
    const keyframe = Math.floor(startAt / KEYFRAME_SEC + 1e-6) * KEYFRAME_SEC

    // Copy fast, before the ring wraps around onto these files.
    const parts = []
    for (const s of segs) parts.push(await fs.readFile(path.join(this.dir, s.name)).catch(() => null))
    if (parts.some((p) => !p)) throw new Error('un segmento desapareció mientras se copiaba')
    await fs.writeFile(outTs, Buffer.concat(parts))

    return {
      vRel: keyframe - segs[0].start,
      dur: end - keyframe,
      startWall: this.offset + keyframe * 1000,
    }
  }
}

// --- public --------------------------------------------------------------------

async function available() {
  if (process.platform !== 'win32') return false
  // Escape hatch for diagnosing: forces the Chromium capture path.
  if (process.env.CLIPPER_NO_NATIVE === '1') return false
  const outputs = await listOutputs().catch(() => [])
  if (!outputs.length) return false
  return Boolean(await pickEncoder())
}

async function start(sessionId, { displayId, width, height, fps, bitrateMbps, maxSeconds }) {
  await stop(sessionId)
  const encoder = await pickEncoder()
  if (!encoder) throw new Error('sin encoder')
  const outputIdx = await outputForDisplay(displayId, width, height)
  if (outputIdx === null) throw new Error(`no encontré la salida DXGI de ${width}x${height}`)
  const ring = new Ring(sessionId, { outputIdx, fps, bitrateMbps, maxSeconds, encoder })
  rings.set(sessionId, ring)
  try {
    await ring.start()
  } catch (err) {
    rings.delete(sessionId)
    await ring.stop()
    throw err
  }
  return { encoder: encoder.label, outputIdx }
}

async function stop(sessionId) {
  const ring = rings.get(sessionId)
  if (!ring) return
  rings.delete(sessionId)
  await ring.stop()
}

async function stopAll() {
  await Promise.all([...rings.keys()].map((id) => stop(id)))
}

function isRunning(sessionId) {
  return rings.has(sessionId)
}

async function cut(sessionId, endWall, durationSec, outTs) {
  const ring = rings.get(sessionId)
  if (!ring) throw new Error('la sesión no está grabando')
  return ring.cut(endWall, durationSec, outTs)
}

/** Leftovers from a crash: rings are only ever valid for the process that wrote them. */
async function cleanStale() {
  const entries = await fs.readdir(RING_ROOT).catch(() => [])
  for (const e of entries) {
    if (!e.includes(`-${process.pid}-`)) await fs.rm(path.join(RING_ROOT, e), { recursive: true, force: true }).catch(() => {})
  }
}

module.exports = { available, start, stop, stopAll, isRunning, cut, cleanStale, invalidateOutputs, pickEncoder }
