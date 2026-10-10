const { app } = require('electron')
const { execFile } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function binary() {
  // ffmpeg-static ships a platform binary; electron-builder unpacks it from the asar.
  const p = require('ffmpeg-static')
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(binary(), ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve()
    })
  })
}

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipper-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

const isMp4 = (p) => path.extname(p).toLowerCase() === '.mp4'

/**
 * Stitches independently recorded segments and drops the leading `trimStartSec`.
 *
 * H.264 segments (recorded into Matroska) remux straight into MP4 with the video
 * stream copied, so this stays near-instant; only the Opus audio is converted to
 * AAC so the result plays everywhere. VP9 segments stay in WebM, also copied.
 * The cut lands on the nearest keyframe (<=1s off).
 */
async function concatAndTrim(parts, trimStartSec, outPath, inputExt = 'webm') {
  await withTempDir(async (dir) => {
    const files = []
    for (let i = 0; i < parts.length; i++) {
      const file = path.join(dir, `part-${i}.${inputExt}`)
      await fs.writeFile(file, Buffer.from(parts[i]))
      files.push(file)
    }
    const list = path.join(dir, 'list.txt')
    await fs.writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))

    const args = ['-y', '-fflags', '+genpts', '-f', 'concat', '-safe', '0', '-i', list]
    if (trimStartSec > 0.25) args.push('-ss', trimStartSec.toFixed(2))

    if (isMp4(outPath)) args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart')
    else args.push('-c', 'copy')

    args.push(outPath)
    await run(args)
  })
}

/**
 * Joins slices of ONE encoder stream. They are pieces of a single file, so they
 * are glued byte for byte (header first) rather than fed to the concat demuxer.
 * The kept pieces still sit at their original place on the encoder's timeline,
 * so the result opens with a dead stretch that `trimStartSec` cuts away.
 */
async function concatRaw(parts, trimStartSec, outPath, inputExt = 'mkv', audioOnly = false) {
  await withTempDir(async (dir) => {
    const joined = path.join(dir, `stream.${inputExt}`)
    await fs.writeFile(joined, Buffer.concat(parts.map((p) => Buffer.from(p))))

    const args = ['-y']
    if (trimStartSec > 0.05) args.push('-ss', trimStartSec.toFixed(3))
    args.push('-fflags', '+genpts', '-i', joined)

    if (audioOnly) {
      args.push('-vn', '-c:a', 'aac', '-b:a', '160k')
    } else if (isMp4(outPath)) {
      args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart')
    } else {
      args.push('-c', 'copy')
    }

    args.push(outPath)
    await run(args)
  })
}

/**
 * Concatenates the microphone segments into a standalone AAC sidecar. Kept as a
 * separate file rather than a second track inside the MP4 because browsers only
 * play the first audio track, and the editor needs both layers at once.
 */
async function concatAudio(parts, trimStartSec, outPath, inputExt = 'webm') {
  await withTempDir(async (dir) => {
    const files = []
    for (let i = 0; i < parts.length; i++) {
      const file = path.join(dir, `mic-${i}.${inputExt}`)
      await fs.writeFile(file, Buffer.from(parts[i]))
      files.push(file)
    }
    const list = path.join(dir, 'mic.txt')
    await fs.writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))

    const args = ['-y', '-fflags', '+genpts', '-f', 'concat', '-safe', '0', '-i', list]
    if (trimStartSec > 0.25) args.push('-ss', trimStartSec.toFixed(2))
    args.push('-c:a', 'aac', '-b:a', '160k', outPath)
    await run(args)
  })
}

/** Exact encoded duration in seconds, or null if ffmpeg cannot tell. */
function probeDuration(input) {
  return new Promise((resolve) => {
    execFile(binary(), ['-hide_banner', '-i', input], { maxBuffer: 8 * 1024 * 1024 }, (_err, _out, stderr) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(String(stderr || ''))
      if (!m) return resolve(null)
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
    })
  })
}

/**
 * The microphone runs in its own recorder, so its buffer can start a fraction of
 * a second later than the video's. Both end at the moment you press the key, so
 * the fix is to pad the front of the mic track until the two lengths match —
 * otherwise the voice plays early for the whole clip.
 */
async function alignAudioToVideo(videoPath, audioPath) {
  const [videoDur, audioDur] = await Promise.all([probeDuration(videoPath), probeDuration(audioPath)])
  if (!videoDur || !audioDur) return 0
  const delayMs = Math.round((videoDur - audioDur) * 1000)
  if (delayMs < 40) return 0 // below this nobody can hear it

  const tmp = audioPath.replace(/\.m4a$/, '.aligned.m4a')
  await run(['-y', '-i', audioPath, '-af', `adelay=${delayMs}:all=1`, '-c:a', 'aac', '-b:a', '160k', tmp])
  await fs.rename(tmp, audioPath)
  return delayMs
}

const isDefaultMix = (mix) =>
  !mix || (mix.game === 1 && mix.mic === 1 && !mix.gameMuted && !mix.micMuted)

/**
 * Renders the two audio layers down to one track at the chosen levels.
 * `video: 'copy'` keeps the picture untouched, which makes an export near-instant;
 * a trim needs a real re-encode to land the cut on an exact frame.
 */
async function renderMix(input, micInput, mix, outPath, opts = {}) {
  const { startSec, endSec, video = 'copy' } = opts
  const g = mix && mix.gameMuted ? 0 : mix ? mix.game : 1
  const m = mix && mix.micMuted ? 0 : mix ? mix.mic : 1

  const args = ['-y']
  const cut = []
  if (startSec !== undefined) cut.push('-ss', Number(startSec).toFixed(3))
  if (endSec !== undefined) cut.push('-to', Number(endSec).toFixed(3))

  args.push(...cut, '-i', input)
  if (micInput) args.push(...cut, '-i', micInput)

  if (micInput) {
    args.push(
      '-filter_complex',
      `[0:a]volume=${g.toFixed(3)}[a0];[1:a]volume=${m.toFixed(3)}[a1];` +
        `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
      '-map', '0:v',
      '-map', '[aout]',
    )
  } else {
    args.push('-map', '0:v', '-map', '0:a?', '-af', `volume=${g.toFixed(3)}`)
  }

  if (video === 'copy') args.push('-c:v', 'copy')
  else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p')

  args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath)
  await run(args)
}

/** Frame-accurate trim; re-encodes so the cut is exact. */
async function trim(input, startSec, endSec, outPath) {
  const base = ['-y', '-ss', startSec.toFixed(3), '-to', endSec.toFixed(3), '-i', input]

  const args = isMp4(outPath)
    ? [...base,
       '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
       '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outPath]
    : [...base,
       '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1',
       '-b:v', '0', '-crf', '30', '-c:a', 'libopus', '-b:a', '160k', outPath]

  await run(args)
}

/**
 * Produces an MP4 copy for sharing. A clip that is already H.264 is remuxed
 * (instant); a VP9 clip has to be re-encoded.
 */
async function toMp4(input, outPath) {
  if (isMp4(input)) {
    await fs.copyFile(input, outPath)
    return
  }
  try {
    await run(['-y', '-i', input, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outPath])
  } catch {
    // Source video is not H.264 — re-encode it.
    await run([
      '-y', '-i', input,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outPath,
    ])
  }
}

/**
 * Horizontal strip of evenly spaced frames, used as the scrubbing timeline.
 * Generated on demand the first time a clip is opened, then cached on disk, so
 * saving a clip stays fast.
 */
async function filmstrip(input, outPath, durationSec, frames = 14, height = 72) {
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  // Evenly spaced, not "representative": the strip is a ruler, so frame N has to
  // sit at position N in time or scrubbing against it lies.
  const fps = frames / Math.max(durationSec || frames, 1)
  await run([
    '-y',
    '-i', input,
    '-vf', `fps=${fps.toFixed(6)},scale=-2:${height},tile=${frames}x1`,
    '-frames:v', '1',
    '-q:v', '4',
    outPath,
  ])
  return outPath
}

/** Pixel size of a video or image, or null when ffmpeg cannot tell. */
function probeSize(input) {
  return new Promise((resolve) => {
    execFile(binary(), ['-hide_banner', '-i', input], { maxBuffer: 8 * 1024 * 1024 }, (_err, _out, stderr) => {
      const m = /,\s(\d{2,5})x(\d{2,5})[\s,]/.exec(String(stderr || ''))
      resolve(m ? { width: Number(m[1]), height: Number(m[2]) } : null)
    })
  })
}

/** Small JPEG preview of a still, so the library never decodes full PNGs. */
async function imageThumbnail(input, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await run(['-y', '-i', input, '-vf', 'scale=480:-2', '-q:v', '4', outPath])
  return outPath
}

/**
 * Like run(), but at below-normal priority and on two threads: previews are
 * built in the background, often while a game is running, and must never be
 * the reason it drops frames.
 */
function runLow(args) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      binary(),
      ['-hide_banner', '-loglevel', 'error', ...args],
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, _out, stderr) => {
        if (err) reject(new Error(stderr || err.message))
        else resolve()
      },
    )
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      /* priority is a nicety, not a requirement */
    }
  })
}

/**
 * Small 360p copy used for hover previews in the library. Decoding the full
 * 1080p60 file inside a 260px tile is what made those previews stutter; this
 * keeps the frame rate and drops only the pixels nobody can see at that size.
 * The mic layer, if any, is mixed in at the clip's levels so the preview sounds
 * like the clip.
 */
async function previewProxy(input, micInput, mix, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  const tmp = outPath.replace(/\.mp4$/i, '.tmp.mp4')
  const g = mix && mix.gameMuted ? 0 : mix ? mix.game : 1
  const m = mix && mix.micMuted ? 0 : mix ? mix.mic : 1

  const args = ['-y', '-i', input]
  if (micInput) args.push('-i', micInput)

  if (micInput) {
    args.push(
      '-filter_complex',
      `[0:a]volume=${g.toFixed(3)}[a0];[1:a]volume=${m.toFixed(3)}[a1];` +
        `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
      '-map', '0:v',
      '-map', '[aout]',
    )
  } else {
    args.push('-map', '0:v', '-map', '0:a?')
  }

  args.push(
    '-vf', "scale=-2:'min(360,ih)'",
    // Captures are variable-rate; without this the MP4 muxer settles on 30 fps
    // and throws away a quarter of the frames, which is its own stutter.
    '-fps_mode', 'passthrough',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
    // Short GOP so the looping preview restarts without a visible hitch.
    '-g', '30',
    '-threads', '2',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    tmp,
  )

  try {
    await runLow(args)
    // Renamed into place so a half-written file is never served to the library.
    await fs.rename(tmp, outPath)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  return outPath
}

/**
 * Audio input args for a layer that must start `rel` seconds into its file and
 * last `dur`. A negative `rel` means the recording began after the clip did
 * (armed moments before the key), so the front is padded with silence instead.
 */
function audioWindow(file, rel, dur, label) {
  if (rel >= 0) {
    return { input: ['-ss', rel.toFixed(3), '-t', dur.toFixed(3), '-i', file], filter: null }
  }
  const padMs = Math.round(-rel * 1000)
  return {
    input: ['-t', (dur + rel).toFixed(3), '-i', file],
    filter: (idx) => `[${idx}:a]adelay=${padMs}:all=1,apad,atrim=0:${dur.toFixed(3)}[${label}]`,
  }
}

/**
 * Builds a clip from the native ring buffer: `videoTs` is the byte-joined MPEG-TS
 * slice starting on a keyframe, `vRel` the keyframe the clip opens on. Video is
 * copied untouched; the system-audio layer is cut on the same wall-clock window
 * and encoded to AAC, so picture and sound line up without guessing.
 */
async function muxNative({ videoTs, vRel, dur, audio, outPath }) {
  const args = ['-y', '-fflags', '+genpts', '-ss', vRel.toFixed(3), '-t', dur.toFixed(3), '-i', videoTs]
  const maps = ['-map', '0:v']
  const filters = []
  if (audio) {
    const w = audioWindow(audio.file, audio.rel, dur, 'a')
    args.push(...w.input)
    if (w.filter) {
      filters.push(w.filter(1))
      maps.push('-map', '[a]')
    } else {
      maps.push('-map', '1:a')
    }
  }
  if (filters.length) args.push('-filter_complex', filters.join(';'))
  args.push(...maps, '-c:v', 'copy')
  if (audio) args.push('-c:a', 'aac', '-b:a', '160k')
  args.push('-movflags', '+faststart', outPath)
  await run(args)
}

/** Cuts the microphone layer to the clip's window as a standalone AAC sidecar. */
async function cutAudioLayer({ file, rel, dur, outPath }) {
  const w = audioWindow(file, rel, dur, 'a')
  const args = ['-y', ...w.input]
  if (w.filter) args.push('-filter_complex', w.filter(0), '-map', '[a]')
  else args.push('-map', '0:a')
  args.push('-vn', '-c:a', 'aac', '-b:a', '160k', outPath)
  await run(args)
}

async function thumbnail(input, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await run(['-y', '-ss', '1', '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', outPath])
  return outPath
}

module.exports = {
  concatAndTrim,
  concatRaw,
  concatAudio,
  alignAudioToVideo,
  probeDuration,
  renderMix,
  isDefaultMix,
  trim,
  toMp4,
  thumbnail,
  imageThumbnail,
  probeSize,
  filmstrip,
  previewProxy,
  muxNative,
  cutAudioLayer,
  binary,
}
