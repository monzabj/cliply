// Windows regression: replace through the real editor with video/audio loaded,
// a gallery preview and a separate process holding the file against deletion.
const {chromium}=require(process.env.CLIPPER_PLAYWRIGHT_MODULE||'playwright')
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto')
const {ffmpeg,decode,amplitude,pause}=require('./audio-fixtures.cjs'),{neutral}=require('../electron/input/timeline')
const root=path.resolve(__dirname,'..'),artifacts=path.join(root,'.test-artifacts/trim-integration')
let profile,child,browser,page,logs='',locks=[]
const invoke=(c,...a)=>page.evaluate(([c,a])=>window.clipper.invoke(c,...a),[c,a])
async function until(fn,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await pause(80)}throw Error(label)}
async function hold(file,ms){
  const script=`$f=[IO.File]::Open('${file.replace(/'/g,"''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);Write-Output 'READY';Start-Sleep -Milliseconds ${ms};$f.Dispose()`
  const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});locks.push(p);let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b)
  await until(()=>output.includes('READY'),'Exclusive Windows file reader ready');return p
}
async function main(){
  profile=await fs.mkdtemp(path.join(os.tmpdir(),'clipper-trim-test-'));const clips=path.join(profile,'clips');await fs.mkdir(clips);await fs.mkdir(artifacts,{recursive:true})
  const fileName='Original recording.mp4',full=path.join(clips,fileName),mic='Original recording.mic.m4a',app='Original recording.app-tone.m4a'
  ffmpeg(['-y','-f','lavfi','-i','testsrc2=s=960x540:r=24:d=8','-f','lavfi','-i','sine=frequency=440:duration=8','-c:v','libx264','-preset','ultrafast','-crf','24','-c:a','aac',full])
  ffmpeg(['-y','-f','lavfi','-i','sine=frequency=1320:duration=8','-c:a','aac',path.join(clips,mic)])
  ffmpeg(['-y','-f','lavfi','-i','sine=frequency=440:duration=8','-c:a','aac',path.join(clips,app)])
  const markers=[{id:'one',label:'Destacado 1',timeSec:2.5},{id:'two',label:'Destacado 2',timeSec:6}]
  const baseComputer=amplitude(decode(path.join(clips,app)),440),baseMic=amplitude(decode(path.join(clips,mic)),1320)
  const original={id:'original',fileName,title:'Overwrite regression',displayName:'Original recording',createdAt:new Date().toISOString(),durationSec:8,sizeBytes:(await fs.stat(full)).size,source:{type:'screen',name:'Generated'},format:'mp4',micFile:mic,audioApps:[{id:'tone',name:'Tone',exe:'anything.exe',file:app}],inputsFile:'Original recording.inputs.json',markerFile:'Original recording.highlights.json',markers,mix:{game:1,mic:1,gameMuted:false,micMuted:false}}
  const held=neutral();held.keys=[87];held.mouse.buttons=[3,4]
  await fs.writeFile(path.join(clips,original.inputsFile),JSON.stringify({version:1,durationMs:8000,frames:[{t:0,state:neutral()},{t:1500,state:held},{t:3000,state:neutral()}]}))
  await fs.writeFile(path.join(clips,original.markerFile),JSON.stringify({version:1,durationSec:8,markers}));await fs.writeFile(path.join(clips,'index.json'),JSON.stringify([original]))
  await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({setupDone:true,clipsDir:clips,launchOnStartup:false,captureMic:false,captureSystemAudio:false,captureAppAudio:false,language:'es',hotkeys:[],sessions:[{id:'none',source:null,autoArm:false}]}));await fs.writeFile(path.join(profile,'migrations.json'),'["mic-on-1.3"]')
  child=spawn(process.env.CLIPPER_ELECTRON_PATH||require('electron'),[root,'--hidden','--remote-debugging-port=0'],{env:{...process.env,CLIPPER_TEST_DATA:profile},windowsHide:true,stdio:['ignore','ignore','pipe']});child.stderr.on('data',b=>logs+=b)
  await until(()=>/DevTools listening on (ws:\/\/\S+)/.test(logs),'Electron endpoint');browser=await chromium.connectOverCDP(/DevTools listening on (ws:\/\/\S+)/.exec(logs)[1])
  await until(()=>{page=browser.contexts()[0].pages().find(p=>p.url().startsWith('app:'));return !!page},'Renderer')
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('.ci-settings').waitFor()
  const runtime=await invoke('test:paths');if(process.env.CLIPPER_ELECTRON_PATH)assert.ok(runtime.appPath.endsWith('app.asar'));console.log('Runtime:',runtime.appPath)
  const card=page.getByRole('button',{name:original.title,exact:true});await card.hover();await pause(500);await card.click()
  const video=page.locator('.clip-stage-video video');await until(()=>video.evaluate(v=>v.readyState>=2&&v.duration>7.8),'Original media loaded')
  await page.getByRole('button',{name:'Expandir audio de aplicaciones'}).click()
  await page.getByRole('slider',{name:'Computadora',exact:true}).fill('0.5');await page.getByRole('slider',{name:'Micrófono',exact:true}).fill('0.8');await page.getByRole('slider',{name:'Tone',exact:true}).fill('0.7')
  await page.getByRole('slider',{name:'Inicio',exact:true}).press('Shift+ArrowRight');await page.getByRole('slider',{name:'Inicio',exact:true}).press('Shift+ArrowRight');await page.getByRole('slider',{name:'Fin',exact:true}).press('Shift+ArrowLeft')
  await page.getByRole('button',{name:'Reproducir',exact:true}).click()
  await until(()=>video.evaluate(v=>!v.paused),'Playback active before overwrite')
  await video.evaluate(v=>{window.__emptied=0;v.addEventListener('emptied',()=>window.__emptied++)})
  const lock=await hold(full,3500)
  await page.getByRole('button',{name:'Guardar recorte',exact:true}).click();await page.getByRole('button',{name:'Pisar este clip',exact:true}).click()
  await until(()=>page.evaluate(()=>window.__emptied>0),'Loaded decoder released during replacement')
  await until(async()=>!!(await invoke('clips:list'))[0].mediaRevision,'Overwrite committed',45000)
  const saved=(await invoke('clips:list'))[0];assert.equal(saved.id,original.id);assert.equal(saved.fileName,fileName);assert.ok(Math.abs(saved.durationSec-5)<.12);assert.equal(saved.micFile,null);assert.deepEqual(saved.audioApps,[]);assert.equal(saved.mix.game,1);assert.equal(saved.mix.mic,1)
  assert.deepEqual(saved.markers.map(m=>m.timeSec),[.5,4]);const inputs=JSON.parse(await fs.readFile(path.join(clips,saved.inputsFile)));assert.equal(inputs.durationMs,5000);assert.deepEqual(inputs.frames[0].state.keys,[87])
  const pcm=decode(full);assert.ok(Math.abs(amplitude(pcm,440)/baseComputer-.35)<.06,'Computer/app volumes baked exactly once');assert.ok(Math.abs(amplitude(pcm,1320)/baseMic-.8)<.08,'Microphone mix retained')
  await until(()=>video.evaluate((v,revision)=>v.readyState>=2&&Math.abs(v.duration-5)<.12&&v.currentSrc.includes(revision),saved.mediaRevision),'Player reloads the trimmed file with a new media revision')
  await pause(900);assert.equal((await invoke('clips:list'))[0].mix.game,1,'Old UI volumes do not get persisted again')
  await page.screenshot({path:path.join(artifacts,'overwrite-success.png')});lock.kill()
  await page.getByRole('slider',{name:'Inicio',exact:true}).press('Shift+ArrowRight')
  await page.getByRole('button',{name:'Guardar recorte',exact:true}).click();await page.getByRole('button',{name:'Pisar este clip',exact:true}).click()
  await until(async()=> (await invoke('clips:list'))[0].mediaRevision!==saved.mediaRevision,'Second overwrite of the same filename succeeds')
  const second=(await invoke('clips:list'))[0];await until(()=>video.evaluate(v=>v.readyState>=2&&Math.abs(v.duration-4)<.12),'Second trimmed duration visible')
  assert.deepEqual(second.markers.map(m=>m.timeSec),[3]);assert.equal((await invoke('clips:list')).length,1)
  // Permanent external lock: fail safely, keeping both the original and selection.
  const digest=async()=>createHash('sha256').update(await fs.readFile(full)).digest('hex'),before=await digest()
  await page.getByRole('slider',{name:'Inicio',exact:true}).press('Shift+ArrowRight')
  const permanent=await hold(full,20000)
  await page.getByRole('button',{name:'Guardar recorte',exact:true}).click();await page.getByRole('button',{name:'Pisar este clip',exact:true}).click()
  await page.getByText(/El clip original se conservó/).waitFor({timeout:30000})
  assert.equal(await digest(),before);assert.equal((await invoke('clips:list'))[0].mediaRevision,second.mediaRevision)
  await until(()=>video.evaluate(v=>v.readyState>=2),'Original playback restored after a failed replacement')
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  assert.equal(await page.getByRole('slider',{name:'Inicio',exact:true}).getAttribute('aria-valuetext'),'0:01.0')
  assert.equal((await fs.readdir(clips)).filter(n=>n.includes('.trim.')).length,0);permanent.kill()
  assert.deepEqual(errors,[])
  console.log('PASS real Windows lock, active playback, independent audio, input/marker rebasing, same filename/ID, reload, repeated overwrite and safe failure recovery')
}
main().catch(async error=>{console.error(error,logs.slice(-2500));if(page)await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});process.exitCode=1}).finally(async()=>{locks.forEach(p=>p.kill());try{if(page)await invoke('test:quit')}catch{}if(child){await pause(1200);child.kill()}if(browser)await browser.close().catch(()=>{});console.log('Isolated profile:',profile)})
