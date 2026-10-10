const { spawn, execFile } = require('node:child_process')

/**
 * Name of the game / app in the foreground.
 *
 * The naive version spawned a PowerShell per call and re-compiled the P/Invoke
 * shim with Add-Type every time — hundreds of milliseconds and a process launch
 * for something we want to poll every few seconds. Instead we keep one worker
 * alive, compile the shim once, and treat each query as a line in / line out.
 */

const SENTINEL = '<<CLIPPER_EOF>>'

const SETUP = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class FW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
$script:lastPid = -1
$script:lastName = ''
function Get-FW {
  $h = [FW]::GetForegroundWindow()
  $procId = 0
  [FW]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null

  # Resolving the friendly product name costs ~0.7s, so only redo it when the
  # foreground process actually changed. Polling the same window is then free.
  if ($procId -eq $script:lastPid) {
    Write-Output $script:lastName
    Write-Output '${SENTINEL}'
    return
  }

  $sb = New-Object System.Text.StringBuilder 512
  [FW]::GetWindowText($h, $sb, 512) | Out-Null
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  $name = $null
  if ($proc) {
    try { $name = $proc.MainModule.FileVersionInfo.FileDescription } catch { $name = $null }
    if (-not $name) { $name = $proc.ProcessName }
  }
  if (-not $name) { $name = $sb.ToString() }

  $script:lastPid = $procId
  $script:lastName = $name
  Write-Output $name
  Write-Output '${SENTINEL}'
}
`

let worker = null
let buffer = ''
/** @type {{ resolve: (v: string | null) => void, timer: NodeJS.Timeout }[]} */
let pending = []

function settleNext(value) {
  const job = pending.shift()
  if (!job) return
  clearTimeout(job.timer)
  job.resolve(value)
}

function killWorker() {
  if (worker) {
    try {
      worker.kill()
    } catch {
      /* already gone */
    }
  }
  worker = null
  buffer = ''
  while (pending.length) settleNext(null)
}

function ensureWorker() {
  if (worker) return worker
  try {
    worker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
  } catch {
    worker = null
    return null
  }

  worker.stdout.setEncoding('utf8')
  worker.stdout.on('data', (chunk) => {
    buffer += chunk
    let idx
    while ((idx = buffer.indexOf(SENTINEL)) !== -1) {
      const answer = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + SENTINEL.length)
      settleNext(answer || null)
    }
  })

  worker.on('exit', killWorker)
  worker.on('error', killWorker)

  worker.stdin.write(SETUP + '\n')
  return worker
}

function queryWindows() {
  return new Promise((resolve) => {
    const w = ensureWorker()
    if (!w || !w.stdin.writable) return resolve(null)

    // A hung worker must not pile up callers; drop it and start clean next time.
    const timer = setTimeout(() => {
      const idx = pending.findIndex((p) => p.timer === timer)
      if (idx !== -1) pending.splice(idx, 1)
      killWorker()
      resolve(null)
    }, 3000)

    pending.push({ resolve, timer })
    try {
      w.stdin.write('Get-FW\n')
    } catch {
      clearTimeout(timer)
      pending.pop()
      resolve(null)
    }
  })
}

function execOnce(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout.toString().trim())
    })
  })
}

/**
 * Best-effort name of the game / app in the foreground. Returns null when it
 * cannot be determined (or when Clipper itself is focused) so callers can fall
 * back to the source name.
 */
async function getForegroundWindow() {
  try {
    if (process.platform === 'win32') {
      const out = await queryWindows()
      return out && !/clipper/i.test(out) ? out : null
    }
    if (process.platform === 'darwin') {
      return execOnce('osascript', [
        '-e',
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ])
    }
    const out = await execOnce('xdotool', ['getactivewindow', 'getwindowname'])
    return out || null
  } catch {
    return null
  }
}

function shutdown() {
  killWorker()
}

module.exports = { getForegroundWindow, shutdown }
