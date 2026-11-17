const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const compiler = process.env.CLIPPER_CSC || path.join(
  process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe',
)
if (!existsSync(compiler)) throw new Error('The online installer requires the Windows .NET Framework C# compiler.')

const dist = path.join(root, 'dist')
mkdirSync(dist, { recursive: true })
execFileSync(compiler, [
  '/nologo', '/optimize+', '/codepage:65001', '/target:winexe',
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
  `/win32icon:${path.join(root, 'build/icon.ico')}`,
  `/out:${path.join(dist, 'Clipper-Installer.exe')}`,
  path.join(root, 'packaging/ClipperInstaller.cs'),
], { windowsHide: true, stdio: 'inherit' })
console.log('Built dist/Clipper-Installer.exe')
