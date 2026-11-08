const {execFileSync}=require('node:child_process')
const {existsSync}=require('node:fs')
const path=require('node:path')
if(process.platform!=='win32'){console.log('Process audio is Windows-only; skipping.');process.exit(0)}
const root=path.resolve(__dirname,'..')
const compiler=process.env.CLIPPER_CSC||['Framework64','Framework'].map(f=>path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET',f,'v4.0.30319/csc.exe')).find(existsSync)
if(!compiler)throw Error('Building process audio requires the .NET Framework C# compiler.')
execFileSync(compiler,['/nologo','/optimize+','/platform:x64','/target:exe','/reference:System.Web.Extensions.dll',`/out:${path.join(root,'electron/audio/AudioWorker.exe')}`,path.join(root,'electron/audio/AudioInterop.cs'),path.join(root,'electron/audio/AudioWorker.cs')],{windowsHide:true,stdio:'inherit'})
console.log('Built electron/audio/AudioWorker.exe')
