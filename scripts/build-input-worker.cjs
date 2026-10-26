const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

if (process.platform !== 'win32') {
  console.log('Global input recording is Windows-only; skipping the input worker.')
  process.exit(0)
}

const root = path.resolve(__dirname, '..')
const windows = process.env.WINDIR || 'C:\\Windows'
const candidates = ['Framework64', 'Framework'].map(folder =>
  path.join(windows, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe'),
)
const compiler = process.env.CLIPPER_CSC || candidates.find(existsSync)
if (!compiler) throw new Error('Building the input worker requires the .NET Framework C# compiler (or CLIPPER_CSC).')

execFileSync(compiler, [
  '/nologo', '/optimize+', '/platform:x64', '/target:exe', '/reference:System.Windows.Forms.dll',
  `/out:${path.join(root, 'electron/input/InputWorker.exe')}`,
  path.join(root, 'electron/input/InputWorker.cs'),
], { windowsHide: true, stdio: 'inherit' })
console.log('Built electron/input/InputWorker.exe')
