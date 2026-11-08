const { execFile } = require('node:child_process')
// Device interface paths survive DISPLAY1/DISPLAY2 renumbering. No monitor
// serial numbers or desktop contents are sent anywhere.
const script = `
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class ClipperMonitor {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Info { public int size; public int left,top,right,bottom,wl,wt,wr,wb; public uint flags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]public string device; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Device { public int size; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string name; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string label; public uint flags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string id; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string key; }
 public delegate bool Callback(IntPtr m,IntPtr dc,IntPtr r,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr rect,Callback callback,IntPtr p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern bool GetMonitorInfo(IntPtr m,ref Info info);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern bool EnumDisplayDevices(string name,uint index,ref Device device,uint flags);
 public static List<object> Read() {
  var result=new List<object>();
  EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,delegate(IntPtr m,IntPtr dc,IntPtr r,IntPtr p){
   var info=new Info();info.size=Marshal.SizeOf(info);GetMonitorInfo(m,ref info);
   var d=new Device();d.size=Marshal.SizeOf(d);
   if(EnumDisplayDevices(info.device,0,ref d,1)) result.Add(new { devicePath=d.id,label=d.label,x=info.left,y=info.top,width=info.right-info.left,height=info.bottom-info.top });
   return true;
  },IntPtr.Zero);return result;
 }
}
'@
ConvertTo-Json -InputObject @([ClipperMonitor]::Read()) -Compress
`
let cached = null, pending = null, epoch = 0
function invalidate() { cached = null; pending = null; epoch++ }
async function read() {
  if (process.platform !== 'win32') return []
  if (cached) return cached
  if (pending) return pending
  const version = epoch
  const task = new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        let result = []
        try { if (!error) { const parsed = JSON.parse(String(stdout).replace(/^\uFEFF/, '')); result = Array.isArray(parsed) ? parsed : [parsed] } } catch {}
        if (version === epoch) { if (result.length) cached = result; pending = null }
        resolve(result)
      })
  })
  pending = task
  return task
}
function forDisplay(display, monitors, screen) {
  if (!display) return null
  const width = Math.round(display.size.width * display.scaleFactor), height = Math.round(display.size.height * display.scaleFactor)
  const sized = monitors.filter(m => m.width === width && m.height === height)
  if (sized.length === 1) return sized[0]
  if (!sized.length) return null
  const rect = process.platform === 'win32' ? screen.dipToScreenRect(null, display.bounds) : display.bounds
  const positioned = sized.filter(m => m.x === rect.x && m.y === rect.y)
  return positioned.length === 1 ? positioned[0] : null
}
module.exports = { read, invalidate, forDisplay }
