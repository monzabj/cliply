const { execFile } = require('node:child_process')

function exec(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout.toString().trim())
    })
  })
}

const WIN_SCRIPT = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class FW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
$h=[FW]::GetForegroundWindow()
$sb=New-Object System.Text.StringBuilder 512
[FW]::GetWindowText($h,$sb,512) | Out-Null
$pid=0
[FW]::GetWindowThreadProcessId($h,[ref]$pid) | Out-Null
$proc=Get-Process -Id $pid -ErrorAction SilentlyContinue
$name = if ($proc -and $proc.MainModule) { $proc.MainModule.FileVersionInfo.FileDescription } else { $null }
if (-not $name -and $proc) { $name = $proc.ProcessName }
if (-not $name) { $name = $sb.ToString() }
Write-Output $name
`

/**
 * Best-effort name of the game / app that was in the foreground when the hotkey fired.
 * Returns null when it cannot be determined so callers can fall back to the source name.
 */
async function getForegroundWindow() {
  try {
    if (process.platform === 'win32') {
      const out = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT])
      return out && !/clipper/i.test(out) ? out : null
    }
    if (process.platform === 'darwin') {
      return exec('osascript', [
        '-e',
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ])
    }
    const out = await exec('xdotool', ['getactivewindow', 'getwindowname'])
    return out || null
  } catch {
    return null
  }
}

module.exports = { getForegroundWindow }
