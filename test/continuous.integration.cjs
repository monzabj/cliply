// Real MediaRecorder -> streaming IPC -> disk -> ffmpeg -> library/player.
// All media is generated; the user's desktop, microphone and library are untouched.
const {chromium}=require(process.env.CLIPPER_PLAYWRIGHT_MODULE||'playwright')
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process')
const {ffmpeg,pause,decode,amplitude}=require('./audio-fixtures.cjs')
const root=path.resolve(__dirname,'..'),artifacts=path.join(root,'.test-artifacts/continuous-integration')
let profile,child,browser,page,logs='',external,library
const invoke=(c,...a)=>page.evaluate(([c,a])=>window.clipper.invoke(c,...a),[c,a])
async function waitFor(check,label,timeout=30000){const until=Date.now()+timeout;while(Date.now()<until){if(await check())return;await pause(100)}throw Error(label)}
async function launch(){
  logs='';child=spawn(process.env.CLIPPER_ELECTRON_PATH||require('electron'),[root,'--remote-debugging-port=0','--hidden'],{env:{...process.env,CLIPPER_TEST_DATA:profile},windowsHide:true,stdio:['ignore','ignore','pipe']});child.stderr.on('data',b=>logs+=b)
  await waitFor(()=>/DevTools listening on (ws:\/\/\S+)/.test(logs),'DevTools endpoint')
  browser=await chromium.connectOverCDP(/DevTools listening on (ws:\/\/\S+)/.exec(logs)[1]);await waitFor(()=>{page=browser.contexts()[0].pages().find(p=>p.url().startsWith('app:'));return !!page},'Renderer')
  await page.locator('[data-testid=continuous-controls]').waitFor()
}
async function fakeCapture(){
  await page.evaluate(()=>{
    const audio=new AudioContext(),canvas=document.createElement('canvas');canvas.width=640;canvas.height=360
    const ctx=canvas.getContext('2d');let frame=0
    setInterval(()=>{ctx.fillStyle=frame++%2?'#24395b':'#284f3a';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='32px monospace';ctx.fillText(`Test ${frame}`,30,100)},80)
    const tone=frequency=>{const osc=audio.createOscillator(),gain=audio.createGain(),dest=audio.createMediaStreamDestination();osc.frequency.value=frequency;gain.gain.value=.12;osc.connect(gain).connect(dest);osc.start();return dest.stream.getAudioTracks()[0]}
    navigator.mediaDevices.getDisplayMedia=async()=>{await audio.resume();const s=canvas.captureStream(12);s.addTrack(tone(440));return s}
    navigator.mediaDevices.getUserMedia=async()=>{await audio.resume();return new MediaStream([tone(1320)])}
  })
}
async function main(){
  profile=await fs.mkdtemp(path.join(os.tmpdir(),'clipper-continuous-test-'));external=path.join(profile,'chosen destination');library=path.join(profile,'clips');await fs.mkdir(external);await fs.mkdir(library);await fs.mkdir(artifacts,{recursive:true})
  await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({setupDone:true,launchOnStartup:false,startMinimized:false,clipsDir:library,hotkeys:[{id:'clip',accelerator:'F8',action:'clip',durationSec:2,sessionId:'test'}],sessions:[{id:'test',name:'Test',source:null,autoArm:false}],captureSystemAudio:true,captureMic:true,captureAppAudio:false,fps:12,videoBitrateMbps:2,language:'es'}))
  await fs.writeFile(path.join(profile,'migrations.json'),'["mic-on-1.3"]')
  await launch();const errors=[];page.on('pageerror',e=>errors.push(e.message));const runtime=await invoke('test:paths');console.log('Runtime:',runtime.appPath)
  const defaults=await invoke('settings:get');assert.equal(defaults.continuousToggleKey,'');assert.equal(defaults.continuousMarkerKey,'');assert.equal((await invoke('continuous:status')).status,'idle')
  await fakeCapture()
  await page.getByRole('button',{name:'Grabación continua',exact:true}).click()
  await page.getByLabel('Nombre del archivo',{exact:true}).fill('Mi sesión')
  await page.getByLabel('Carpeta de destino',{exact:true}).fill(external)
  const source=(await invoke('sources:list')).find(s=>s.type==='screen');assert.ok(source)
  await page.getByLabel('Fuente de grabación').selectOption(source.id)
  const key=page.getByRole('button',{name:'Marcar destacado (opcional)',exact:true});await key.click();await key.press('F10')
  await waitFor(async()=> (await invoke('settings:get')).continuousMarkerKey==='F10','Marker shortcut persisted')
  const toggle=page.getByRole('button',{name:'Iniciar / detener (opcional)',exact:true});await toggle.click();await toggle.press('F11')
  await waitFor(async()=> (await invoke('settings:get')).continuousToggleKey==='F11','Start/stop shortcut persisted')
  await waitFor(async()=>{const keys=await invoke('test:registered-hotkeys');return keys.includes('F10')&&keys.includes('F11')},'Both configured shortcuts are actually registered in Windows')
  await page.getByRole('button',{name:'Iniciar grabación',exact:true}).click()
  await waitFor(async()=> (await invoke('continuous:status')).status==='recording','Capture started from the button')
  await pause(1300);await invoke('test:hotkey','F10');await pause(400);await page.getByRole('button',{name:/^Destacar/}).click()
  const live=await invoke('continuous:status');assert.equal(live.markers.length,2);assert.ok(live.markers[0].timeSec>=1)
  // Save a normal short clip through its unmodified route, while continuous data keeps flowing.
  const short=path.join(profile,'short.webm');ffmpeg(['-y','-f','lavfi','-i','color=c=blue:s=320x180:r=12:d=1.5','-c:v','libvpx','-deadline','realtime',short])
  const vb=[...await fs.readFile(short)];await page.evaluate(vb=>window.clipper.invoke('clips:save',{parts:[new Uint8Array(vb).buffer],container:'webm',continuous:false,mimeType:'video/webm',trimStartSec:0,durationSec:1.5,title:'Clip durante la grabación',source:{type:'screen',name:'Test'}}),vb)
  assert.equal((await invoke('continuous:status')).id,live.id);assert.equal((await invoke('continuous:status')).status,'recording')
  await waitFor(async()=> (await invoke('continuous:status')).bytes>10000,'Chunks streamed to disk')
  await page.screenshot({path:path.join(artifacts,'recording.png')})
  await invoke('test:hotkey','F11')
  await waitFor(async()=> (await invoke('continuous:status')).status==='idle','Shortcut stops and flushes every final chunk')
  const recording=(await invoke('clips:list')).find(c=>c.recording);assert.ok(recording);assert.equal(recording.storageDir,external);assert.equal(recording.markers.length,2);assert.ok(recording.durationSec>2);assert.ok(recording.micFile)
  await fs.access(path.join(external,recording.fileName));await fs.access(path.join(external,recording.markerFile));assert.ok(amplitude(decode(path.join(external,recording.fileName)),440)>.01);assert.ok(amplitude(decode(path.join(external,recording.micFile)),1320)>.01)
  await page.getByRole('button',{name:recording.title,exact:true}).click({force:true})
  await page.getByLabel('Momentos destacados',{exact:true}).getByRole('button',{name:/^Destacado 2 ·/}).click()
  await waitFor(()=>page.locator('.clip-stage-video video').evaluate((v,t)=>Math.abs(v.currentTime-t)<.15,recording.markers[1].timeSec),'Highlight click seeks to the saved timestamp')
  await page.screenshot({path:path.join(artifacts,'player-highlights.png')})
  await page.getByRole('button',{name:'Close',exact:true}).click()
  const renamed=await invoke('clips:rename-file',recording.id,'Sesión renombrada');assert.ok(renamed.markerFile.startsWith('Sesión renombrada.'));await fs.access(path.join(external,renamed.micFile))
  const cut=await invoke('clips:trim',{id:recording.id,startSec:1,endSec:recording.durationSec-.1,mode:'new'});assert.equal(cut.storageDir,null);assert.equal(cut.recording,false);assert.equal(cut.markers.length,2);assert.ok(Math.abs(cut.markers[0].timeSec-(recording.markers[0].timeSec-1))<.01);await fs.access(path.join(library,cut.fileName))
  // A shortcut starts a NEW file using the saved choices, without reopening the dialog.
  await invoke('test:hotkey','F11');await waitFor(async()=> (await invoke('continuous:status')).status==='recording','Shortcut starts with saved name/directory/physical source')
  await pause(1800);await invoke('test:hotkey','F10');await page.reload()
  await page.locator('[data-testid=continuous-controls]').waitFor()
  // Simulate a renderer loss: main must salvage the already-streamed data.
  // A real reload triggers did-start-navigation recovery as well.
  const interrupted=await invoke('continuous:status')
  if(interrupted.id)await invoke('continuous:finish',interrupted.id)
  await waitFor(async()=> (await invoke('clips:list')).filter(c=>c.recording).length===2,'Interrupted recording retained')
  const pending=await invoke('continuous:prepare',{name:'Recuperada',directory:external,source,container:'webm'})
  const wall=Date.now()-1200;await invoke('continuous:started',pending.id,wall)
  await page.evaluate(({id,vb})=>window.clipper.invoke('continuous:append',id,'video',new Uint8Array(vb).buffer),{id:pending.id,vb})
  await invoke('continuous:mark',wall+700)
  child.kill();await pause(1500);await browser.close().catch(()=>{})
  await launch()
  await waitFor(async()=> (await invoke('clips:list')).some(c=>c.title==='Recuperada'),'Abrupt main-process termination recovers streaming video and markers on next launch')
  const recovered=(await invoke('clips:list')).find(c=>c.title==='Recuperada');assert.equal(recovered.markers[0].timeSec,.7)
  const longSource=path.join(profile,'long.mkv');ffmpeg(['-y','-f','lavfi','-i','color=c=navy:s=320x180:r=1:d=306','-c:v','libx264','-preset','ultrafast',longSource])
  const lc=await invoke('continuous:prepare',{name:'Sesión larga',directory:external,source,container:'mkv'}),ls=Date.now()-306000
  await invoke('continuous:started',lc.id,ls)
  await page.evaluate(({id,vb})=>window.clipper.invoke('continuous:append',id,'video',new Uint8Array(vb).buffer),{id:lc.id,vb:[...await fs.readFile(longSource)]})
  await invoke('continuous:mark',ls+100000)
  const longMeta=await invoke('continuous:finish',lc.id);assert.ok(longMeta.durationSec>=306)
  assert.ok(await invoke('clips:filmstrip',longMeta.id,6),'Long timelines sample frames by seeking')
  await invoke('clips:preview',longMeta.id)
  const proxy=path.join(library,'.thumbs',longMeta.id+'-preview.mp4')
  await waitFor(()=>fs.stat(proxy).then(()=>true,()=>false),'Long recording preview generated')
  const probe=require('node:child_process').spawnSync(require('ffmpeg-static'),['-hide_banner','-i',proxy],{windowsHide:true,encoding:'utf8'}).stderr
  assert.match(probe,/Duration: 00:00:10\./,'Hover proxy is limited to ten seconds instead of encoding the whole session')
  const all=await invoke('clips:list');for(const clip of all)await invoke('clips:delete',clip.id)
  assert.deepEqual((await fs.readdir(external)).filter(f=>!f.startsWith('.')),[])
  assert.deepEqual(errors,[])
  console.log('PASS button-only defaults, filename/directory, independent optional hotkeys, streaming chunks, markers, simultaneous clip save, final flush, external playback/microphone, marker seek, rename, trim and cleanup')
}
main().catch(e=>{console.error(e,logs.slice(-4000));process.exitCode=1}).finally(async()=>{try{if(page)await invoke('test:quit')}catch{}if(child){await pause(1200);child.kill()}if(browser)await browser.close().catch(()=>{});console.log('Isolated profile:',profile)})
