const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Tiny append-only log. Exists so hotkey problems can be diagnosed after the
 * fact — while a game is fullscreen there is no toast, tray tooltip or window
 * the user can actually see, so the evidence has to land on disk.
 */

const MAX_BYTES = 512 * 1024

let filePath = null

function target() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'clipper.log')
  return filePath
}

function rotateIfBig(file) {
  try {
    const stat = fs.statSync(file)
    if (stat.size > MAX_BYTES) fs.renameSync(file, file + '.old')
  } catch {
    /* no file yet */
  }
}

function write(tag, message) {
  try {
    const file = target()
    rotateIfBig(file)
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 23)
    fs.appendFileSync(file, `${stamp}  [${tag}] ${message}\n`)
  } catch {
    /* logging must never break the app */
  }
}

function logPath() {
  return target()
}

module.exports = { write, logPath }
