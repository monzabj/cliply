'use strict'

/**
 * Reads an old Medal library and hands it over to Clipper.
 *
 * Medal keeps no database — no .db, no index, no library JSON. Everything we can
 * recover therefore comes from four places: the file name (which embeds the game
 * and a millisecond timestamp), the parent folder (the game, spelled properly),
 * the .Thumbnails folder next to the clips, and the video file itself.
 */

const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { createReadStream } = require('node:fs')

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg'])

/**
 * Medal's folder for "I could not tell which game this was". Roughly 90% of a
 * library lands here, so it must never be treated as a game name.
 */
const UNKNOWN_GAME_DIR = 'Screen Recording'

/** Sections of a Medal install, by the folder name Medal gives them. */
const SECTIONS = {
  Clips: 'clip',
  Screenshots: 'shot',
  Edits: 'edit',
}

/**
 * Medal's "Reels" folder holds no video: it is one "<clip>.filmreel.jpg" contact
 * sheet per clip, derived from clips we are already importing. There is nothing
 * to bring over, so the folder is not treated as a section.
 */
const DERIVED_DIRS = new Set(['Reels', 'Thumbnails', '.Thumbnails'])

/**
 * "MedalTVEASportsFC2620260501214649034.mp4" carries the game with its spaces
 * stripped followed by YYYYMMDDHHMMSSmmm. Older captures use the same shape
 * without the milliseconds, and some carry a trailing marker — "-<epoch>" when Medal
 * had to avoid overwriting a name, or "_Game"/"_Mic" when it recorded the two
 * audio tracks to separate files — so all of those are accepted.
 *
 * The 14/17 split is unambiguous: a 17-digit stamp cannot be read as a 14-digit
 * one, because that would leave three stray digits the pattern does not allow.
 *
 * The game is read from the parent folder instead — same name, properly spelled —
 * so all we take from here is the timestamp.
 */
function parseMedalName(fileName) {
  const base = path.basename(fileName, path.extname(fileName))
  const m = /^MedalTV(.*?)(\d{14}|\d{17})(?:[-_][A-Za-z0-9]+)*$/.exec(base)
  if (!m) return { date: null, approx: true, slug: null }

  const [, slug, digits] = m
  const n = (from, len) => Number(digits.slice(from, from + len))
  const date = new Date(n(0, 4), n(4, 2) - 1, n(6, 2), n(8, 2), n(10, 2), n(12, 2), digits.length > 14 ? n(14, 3) : 0)

  // A name can carry 17 digits and still be nonsense (a clip of a game whose own
  // title ends in numbers). Reject anything that is not a plausible capture date.
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2015 || date > new Date(Date.now() + 86400000)) {
    return { date: null, approx: true, slug }
  }
  return { date, approx: false, slug }
}

/**
 * The game, taken from the folder the clip sits in. Returns null for Medal's
 * "Screen Recording" bucket: that is an admission that Medal did not know, and
 * guessing here would fill the library with a game the user never played.
 */
function gameFromPath(fileFullPath, sectionRoot) {
  const rel = path.relative(sectionRoot, fileFullPath)
  const parts = rel.split(path.sep)
  if (parts.length < 2) return null
  const folder = parts[0]
  if (!folder || folder === UNKNOWN_GAME_DIR || folder.startsWith('.')) return null
  return folder
}

/**
 * Identity of a file's contents, without reading 40 MB of it. Head and tail plus
 * the exact size separate two clips reliably; identical video files agree on all
 * three. This matters because the two Medal installs reuse file names for
 * different clips, so comparing names alone would drop real captures.
 */
async function contentKey(fullPath, size) {
  const CHUNK = 256 * 1024
  const hash = crypto.createHash('sha1')
  hash.update(String(size))

  const readAt = (start, end) =>
    new Promise((resolve, reject) => {
      const stream = createReadStream(fullPath, { start, end })
      stream.on('data', (d) => hash.update(d))
      stream.on('end', resolve)
      stream.on('error', reject)
    })

  await readAt(0, Math.min(CHUNK, size) - 1)
  if (size > CHUNK * 2) await readAt(size - CHUNK, size - 1)
  return hash.digest('hex')
}

/** Every file under `dir`, recursively, skipping nothing but unreadable folders. */
async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/**
 * Finds the Medal sections under a chosen folder. The user picks whatever they
 * have — one install, both, or a parent holding several — so rather than assume
 * a layout we look for the section folders anywhere in the tree.
 */
async function findSections(root, depth = 0, found = []) {
  if (depth > 3) return found
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = path.join(root, entry.name)
    if (SECTIONS[entry.name]) found.push({ kind: SECTIONS[entry.name], dir: full })
    else if (!entry.name.startsWith('.')) await findSections(full, depth + 1, found)
  }
  return found
}

/**
 * Reads a library without writing anything, so the user can see what an import
 * would do before it does it. Deliberately cheap: no ffprobe here, since probing
 * 1,500 files takes minutes and none of it is needed to decide whether to go on.
 */
async function scanMedalLibrary(roots, { onProgress } = {}) {
  const sections = []
  for (const root of roots) {
    const found = await findSections(root)
    // A folder that *is* a section (the user picked "Clips" itself).
    if (!found.length) {
      const name = path.basename(root)
      if (SECTIONS[name]) found.push({ kind: SECTIONS[name], dir: root })
    }
    for (const s of found) sections.push({ ...s, root, install: path.dirname(s.dir) })
  }

  const items = []
  const thumbsByBase = new Map()
  let scanned = 0

  // Medal's thumbnails live in ".Thumbnails" at the root of the install — a
  // sibling of Clips, not a child of it — one .jpg per clip sharing the exact
  // base name. The "Thumbnails" folder without the dot is a different thing: it
  // holds UUID-named stills for Edits and Reels and matches no clip at all.
  for (const install of new Set(sections.map((s) => s.install))) {
    for (const full of await walk(path.join(install, '.Thumbnails'))) {
      if (IMAGE_EXTS.has(path.extname(full).toLowerCase())) {
        thumbsByBase.set(path.basename(full, path.extname(full)), full)
      }
    }
  }

  for (const section of sections) {
    const files = await walk(section.dir)

    for (const full of files) {
      const fileName = path.basename(full)
      const parts = full.split(path.sep)
      if (parts.some((p) => DERIVED_DIRS.has(p))) continue
      if (fileName.endsWith('.filmreel.jpg')) continue

      const ext = path.extname(full).toLowerCase()
      const wantImage = section.kind === 'shot'
      if (wantImage ? !IMAGE_EXTS.has(ext) : !VIDEO_EXTS.has(ext)) continue

      const stat = await fs.stat(full).catch(() => null)
      if (!stat) continue

      const { date, approx } = parseMedalName(fileName)

      items.push({
        path: full,
        fileName,
        kind: section.kind,
        root: section.root,
        sizeBytes: stat.size,
        // A name without a usable timestamp falls back to the file's own mtime,
        // flagged so the library can show the date as approximate.
        createdAt: (date ?? stat.mtime).toISOString(),
        dateApprox: approx,
        game: section.kind === 'shot' || section.kind === 'clip' ? gameFromPath(full, section.dir) : null,
        thumbPath: thumbsByBase.get(path.basename(fileName, path.extname(fileName))) ?? null,
      })

      if (++scanned % 100 === 0) onProgress?.({ phase: 'scan', scanned })
    }
  }

  return { items, sections: sections.map((s) => ({ kind: s.kind, dir: s.dir })) }
}

/** Roll a scan up into the numbers a person needs to decide whether to import. */
function summarize(items) {
  const byKind = {}
  const games = new Map()
  let withDate = 0
  let withThumb = 0
  let noGame = 0
  let bytes = 0

  for (const it of items) {
    byKind[it.kind] = (byKind[it.kind] ?? 0) + 1
    bytes += it.sizeBytes
    if (!it.dateApprox) withDate++
    if (it.thumbPath) withThumb++
    if (it.kind === 'clip') {
      if (it.game) games.set(it.game, (games.get(it.game) ?? 0) + 1)
      else noGame++
    }
  }

  return {
    total: items.length,
    byKind,
    bytes,
    withDate,
    withoutDate: items.length - withDate,
    withThumb,
    noGame,
    games: [...games.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    range: items.length
      ? {
          from: items.reduce((a, b) => (a.createdAt < b.createdAt ? a : b)).createdAt,
          to: items.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).createdAt,
        }
      : null,
  }
}


// --- importing ---------------------------------------------------------------

/** Name of the append-only journal that makes an interrupted import resumable. */
const JOURNAL = '.medal-import.jsonl'

/** Source paths already handled by an earlier, interrupted run. */
async function readJournal(clipsDir) {
  const done = new Set()
  const raw = await fs.readFile(path.join(clipsDir, JOURNAL), 'utf8').catch(() => '')
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      done.add(JSON.parse(line).path)
    } catch {
      // A half-written last line is expected after a hard stop; skip it.
    }
  }
  return done
}

/**
 * Copies the library index aside before the first write. An import touches a
 * thousand entries at once, so there has to be a way back that does not depend
 * on the import itself behaving.
 */
async function backupIndex(clipsDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = path.join(clipsDir, 'index.backup-' + stamp + '.json')
  await fs.copyFile(path.join(clipsDir, 'index.json'), dest).catch(() => null)
  return dest
}

/**
 * Moves a file across volumes. fs.rename cannot cross a drive letter, which is
 * exactly the case here (Medal on C:, the library on D:), so fall back to a copy
 * and only drop the source once the copy is actually there.
 */
async function moveFile(from, to) {
  try {
    await fs.rename(from, to)
  } catch (err) {
    if (err.code !== 'EXDEV') throw err
    await fs.copyFile(from, to)
    await fs.unlink(from)
  }
}

/**
 * Brings a scanned library into Clipper.
 *
 * `mode` is 'copy' (Medal's files stay where they are — safe, but the clips then
 * exist twice on disk) or 'move' (nothing is duplicated; for once the originals
 * are already safe somewhere else). Either way the import is restartable: every
 * finished file is journalled, and a second run skips what the first one did.
 */
async function importMedal(items, opts) {
  const {
    clipsDir,
    mode = 'copy',
    store,
    ffmpeg,
    log = () => {},
    clipTitle,
    uniqueName,
    onProgress = () => {},
    shouldStop = () => false,
  } = opts

  const done = await readJournal(clipsDir)
  const pending = items.filter((it) => !done.has(it.path))
  if (!pending.length) return { imported: 0, skipped: items.length, failed: 0, backup: null }

  const backup = await backupIndex(clipsDir)
  const journal = path.join(clipsDir, JOURNAL)

  // Content identity of everything already imported, so a second pass over the
  // same folder — or a clip present in both Medal installs — adds nothing. Names
  // cannot carry this: two installs can use one name for different clips.
  const seen = new Set()
  for (const c of await store.listClips()) if (c.importKey) seen.add(c.importKey)
  for (const sh of await store.listShots()) if (sh.importKey) seen.add(sh.importKey)

  const thumbsDir = path.join(clipsDir, '.thumbs')
  const shotsDir = path.join(clipsDir, 'Capturas')
  await fs.mkdir(thumbsDir, { recursive: true }).catch(() => {})
  await fs.mkdir(shotsDir, { recursive: true }).catch(() => {})

  let imported = 0
  let skipped = 0
  let failed = 0

  for (const [i, item] of pending.entries()) {
    if (shouldStop()) break
    onProgress({ phase: 'import', done: i, total: pending.length, current: item.fileName, imported, skipped, failed })

    try {
      const key = await contentKey(item.path, item.sizeBytes)
      if (seen.has(key)) {
        skipped++
        await fs.appendFile(journal, JSON.stringify({ path: item.path, skipped: true }) + '\n')
        continue
      }
      seen.add(key)

      const isShot = item.kind === 'shot'
      const destDir = isShot ? shotsDir : clipsDir
      const when = new Date(item.createdAt)
      // An unknown game is labelled by where it came from rather than guessed at;
      // bulk tagging afterwards is what gives these a real name.
      const displayName = item.game ?? 'Medal'
      // uniqueName builds "<name>_<stamp>.<ext>" and adds the dot itself.
      const ext = path.extname(item.fileName).replace(/^\./, '')
      const fileName = await uniqueName(destDir, displayName, when, ext)
      const dest = path.join(destDir, fileName)

      if (mode === 'move') await moveFile(item.path, dest)
      else await fs.copyFile(item.path, dest)

      // Medal already rendered a thumbnail for most clips; reusing it saves
      // decoding a thousand videos for a picture that exists already.
      const id = 'medal-' + when.getTime().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
      const thumbName = id + '.jpg'
      let thumbnail = null
      if (item.thumbPath) {
        thumbnail = await fs
          .copyFile(item.thumbPath, path.join(thumbsDir, thumbName))
          .then(() => thumbName)
          .catch(() => null)
      }
      if (!thumbnail) {
        const make = isShot ? ffmpeg.imageThumbnail : ffmpeg.thumbnail
        thumbnail = await make(dest, path.join(thumbsDir, thumbName))
          .then(() => thumbName)
          .catch(() => null)
      }

      const common = {
        id,
        fileName,
        displayName,
        title: clipTitle(displayName, when),
        createdAt: when.toISOString(),
        sizeBytes: item.sizeBytes,
        thumbnail,
        importKey: key,
        // Flagged so the library can say "around this date" instead of claiming a
        // precision the file name never had.
        dateApprox: item.dateApprox || undefined,
      }

      if (isShot) {
        const size = (await ffmpeg.probeSize(dest).catch(() => null)) || { width: 0, height: 0 }
        await store.upsertShot({
          ...common,
          width: size.width,
          height: size.height,
          // The screen name stays 'Medal' rather than echoing the game: the library
          // filters by screen too, and putting a game there would list every game
          // twice, once as a game and once as a monitor that never existed.
          source: { name: 'Medal', sessionName: null, app: item.game },
        })
      } else {
        const duration = await ffmpeg.probeDuration(dest).catch(() => null)
        await store.upsertClip({
          ...common,
          durationSec: duration ? Math.round(duration) : 0,
          source: { type: 'screen', name: 'Medal', sessionName: null, app: item.game },
          format: ext.toLowerCase() === 'mp4' ? 'mp4' : 'webm',
          micFile: null,
          mix: { game: 1, mic: 1, gameMuted: false, micMuted: false },
        })
      }

      await fs.appendFile(journal, JSON.stringify({ path: item.path, id }) + '\n')
      imported++
    } catch (err) {
      failed++
      log('importacion', 'fallo ' + item.fileName + ': ' + (err && err.message))
    }
  }

  const stopped = shouldStop()
  onProgress({ phase: 'done', done: pending.length, total: pending.length, imported, skipped, failed })
  return { imported, skipped, failed, backup, stopped }
}

/** Forget an import's progress, so the next run starts from the top. */
async function clearJournal(clipsDir) {
  await fs.unlink(path.join(clipsDir, JOURNAL)).catch(() => {})
}

module.exports = {
  parseMedalName,
  gameFromPath,
  contentKey,
  scanMedalLibrary,
  summarize,
  findSections,
  importMedal,
  clearJournal,
  readJournal,
  UNKNOWN_GAME_DIR,
}
