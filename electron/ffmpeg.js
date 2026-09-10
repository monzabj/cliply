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

/**
 * Stitches independently recorded WebM segments and drops the leading `trimStartSec`.
 * Stream copy keeps this near-instant; the cut lands on the nearest keyframe (≤1s off).
 */
async function concatAndTrim(parts, trimStartSec, outPath) {
  await withTempDir(async (dir) => {
    const files = []
    for (let i = 0; i < parts.length; i++) {
      const file = path.join(dir, `part-${i}.webm`)
      await fs.writeFile(file, Buffer.from(parts[i]))
      files.push(file)
    }
    const list = path.join(dir, 'list.txt')
    await fs.writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))

    const args = ['-y', '-fflags', '+genpts', '-f', 'concat', '-safe', '0', '-i', list]
    if (trimStartSec > 0.25) args.push('-ss', trimStartSec.toFixed(2))
    args.push('-c', 'copy', outPath)
    await run(args)
  })
}

/** Frame-accurate trim; re-encodes so the cut is exact. */
async function trim(input, startSec, endSec, outPath) {
  await run([
    '-y',
    '-ss', startSec.toFixed(3),
    '-to', endSec.toFixed(3),
    '-i', input,
    '-c:v', 'libvpx-vp9',
    '-deadline', 'realtime',
    '-cpu-used', '8',
    '-row-mt', '1',
    '-b:v', '0',
    '-crf', '30',
    '-c:a', 'libopus',
    '-b:a', '160k',
    outPath,
  ])
}

async function thumbnail(input, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await run(['-y', '-ss', '1', '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', outPath])
  return outPath
}

module.exports = { concatAndTrim, trim, thumbnail }
