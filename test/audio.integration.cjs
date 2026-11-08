// Real Windows process isolation, then the actual Electron save/player/trim path.
// Only generated tone processes are captured, never the user's applications.
const {chromium}=require(process.env.CLIPPER_PLAYWRIGHT_MODULE||'playwright')
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const {spawn,execFileSync}=require('node:child_process')
const {tones,amplitude,ffmpeg,decode,pause}=require('./audio-fixtures.cjs')
const root=path.resolve(__dirname,'..'),artifacts=path.join(root,'.test-artifacts/audio-integration')
let profile,child,browser,page,children=[],logs=''
const invoke=(channel,...args)=>page.evaluate(([c,a])=>window.clipper.invoke(c,...a),[channel,args])
async function waitFor(check,label,timeout=30000){const until=Date.now()+timeout;while(Date.now()<until){if(await check())return;await pause(100)}throw Error(label)}
async function main(){
  profile=await fs.mkdtemp(path.join(os.tmpdir(),'clipper-audio-test-'));const clipsDir=path.join(profile,'clips');await fs.mkdir(clipsDir);await fs.mkdir(artifacts,{recursive:true})
  const video=path.join(profile,'source.webm'),mic=path.join(profile,'microphone.webm')
  ffmpeg(['-y','-f','lavfi','-i','color=c=0x192234:s=640x360:r=12:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-f','lavfi','-i','sine=frequency=880:duration=2','-filter_complex','[1:a][2:a]amix=inputs=2:normalize=0[a]','-map','0:v','-map','[a]','-c:v','libvpx','-deadline','realtime','-c:a','libopus',video])
  ffmpeg(['-y','-f','lavfi','-i','sine=frequency=1320:duration=2','-c:a','libopus',mic])
  await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({setupDone:true,launchOnStartup:false,startMinimized:false,clipsDir,hotkeys:[],sessions:[{id:'test',name:'Test',source:null,autoArm:false}],captureSystemAudio:true,captureMic:true,language:'es'}))
  await fs.writeFile(path.join(profile,'migrations.json'),'["mic-on-1.3"]')
  children=await tones(path.join(profile,'tones'),30)
  child=spawn(process.env.CLIPPER_ELECTRON_PATH||require('electron'),[root,'--remote-debugging-port=0','--hidden'],{env:{...process.env,CLIPPER_TEST_DATA:profile,CLIPPER_AUDIO_TEST_PIDS:children.map(c=>c.pid).join(',')},windowsHide:true,stdio:['ignore','ignore','pipe']})
  child.stderr.on('data',b=>logs+=b);child.on('error',e=>logs+=e.stack)
  await waitFor(()=>/DevTools listening on (ws:\/\/\S+)/.test(logs),'Electron debugging endpoint')
  browser=await chromium.connectOverCDP(/DevTools listening on (ws:\/\/\S+)/.exec(logs)[1])
  await waitFor(()=>{page=browser.contexts()[0].pages().find(p=>p.url().startsWith('app:'));return !!page},'Renderer')
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')console.log('Renderer console:',msg.text())})
  await page.locator('aside').getByText(/^escritorio$/i).waitFor()
  const runtime=await invoke('test:paths');if(process.env.CLIPPER_ELECTRON_PATH)assert.ok(runtime.appPath.endsWith('app.asar'),'Packaged test must load the ASAR');console.log('Runtime:',runtime.appPath)
  assert.equal((await invoke('settings:get')).captureAppAudio,true,'Isolation is enabled by default for existing settings')
  await waitFor(async()=>{await invoke('tray:state',true,'Audio test');const s=await invoke('audio-apps:status');return s.recording&&s.applications===2&&s.bufferedBytes>500000},'Two real sound-producing processes captured; silent process excluded')
  await pause(1300)
  const before=await invoke('audio-apps:status');console.log('Capture status:',before)
  const processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter "Name = 'AudioWorker.exe'" | Where-Object ParentProcessId -eq ${child.pid} | ForEach-Object { Get-Process -Id $_.ProcessId | Select-Object Id,CPU,WorkingSet64 } | ConvertTo-Json -Compress`],{windowsHide:true,encoding:'utf8'})||'null');console.log('Worker measurements:',processes)
  async function save(title){const end=Date.now()-150,start=end-2000;const vb=[...await fs.readFile(video)],mb=[...await fs.readFile(mic)]
    return page.evaluate(({vb,mb,title,start,end})=>window.clipper.invoke('clips:save',{parts:[new Uint8Array(vb).buffer],container:'webm',continuous:false,mimeType:'video/webm',trimStartSec:0,durationSec:2,inputStartWall:start,inputEndWall:end,endWall:end,title,source:{type:'screen',name:title},mic:{parts:[new Uint8Array(mb).buffer],container:'webm',startWall:start}}),{vb,mb,title,start,end})
  }
  const clip=await save('Layered audio test')
  assert.equal(clip.audioWarning,null,JSON.stringify(clip));assert.equal(clip.audioApps.length,2)
  const a=clip.audioApps.find(t=>t.exe==='ToneA.exe'),b=clip.audioApps.find(t=>t.exe==='ToneB.exe');assert.ok(a&&b)
  const pcmA=decode(path.join(clipsDir,a.file)),pcmB=decode(path.join(clipsDir,b.file))
  assert.ok(amplitude(pcmA,440)>.005&&amplitude(pcmA,880)<.0001,'A contains only 440 Hz')
  assert.ok(amplitude(pcmB,880)>.005&&amplitude(pcmB,440)<.0001,'B contains only 880 Hz')
  if(process.env.CLIPPER_TEST_NATIVE==='1'){
    const source=(await invoke('sources:list')).find(s=>s.type==='screen')
    assert.equal(await invoke('native:available'),true)
    assert.equal((await invoke('native:start','audio-test',{displayId:source.displayId,width:source.width,height:source.height,fps:30,bitrateMbps:2,maxSeconds:10})).ok,true)
    await pause(3500)
    const end=Date.now(),mb=[...await fs.readFile(mic)],vb=[...await fs.readFile(mic)]
    const nativeClip=await page.evaluate(({source,end,mb,vb})=>window.clipper.invoke('native:save',{sessionId:'audio-test',endWall:end,durationSec:2,source:{type:'screen',name:'Native audio test'},audio:{parts:[new Uint8Array(vb).buffer],container:'webm',startWall:end-2000},mic:{parts:[new Uint8Array(mb).buffer],container:'webm',startWall:end-2000}}),{source,end,mb,vb})
    await invoke('native:stop','audio-test')
    assert.equal(nativeClip.audioWarning,null,JSON.stringify(nativeClip));assert.equal(nativeClip.audioApps.length,2)
    for(const track of nativeClip.audioApps){const pcm=decode(path.join(clipsDir,track.file));assert.ok(amplitude(pcm,track.exe==='ToneA.exe'?440:880)>.005)}
    await invoke('clips:delete',nativeClip.id)
    console.log('PASS actual native screen save and wall-clock application audio sidecars')
  }
  children.forEach(c=>c.kill())
  await invoke('test:kill-audio');await waitFor(async()=>!(await invoke('audio-apps:status')).recording,'Audio worker stops after fault')
  const fallback=await save('Fallback audio test');assert.deepEqual(fallback.audioApps,[]);assert.ok(fallback.audioWarning);assert.ok(amplitude(decode(path.join(clipsDir,fallback.fileName)),440)>.01,'Worker failure retains the whole-computer soundtrack')
  const settings=await invoke('settings:get');await invoke('settings:save',{...settings,captureAppAudio:false})
  const stopped=await invoke('audio-apps:status');assert.equal(stopped.recording,false);assert.equal(stopped.bufferedBytes,0)
  const basic=await save('Simple audio test');assert.deepEqual(basic.audioApps,[]);assert.ok(basic.micFile);assert.equal(basic.audioWarning,null)
  console.log('PASS real WASAPI isolation, default-on, silent process filtering, separate AAC sidecars and optional two-layer mode')
  await page.reload();await page.waitForSelector('.ci-settings')
  await page.evaluate(()=>{
    window.__audioProbes=[]
    const create=AudioContext.prototype.createMediaElementSource,make=AudioContext.prototype.createGain
    let last
    AudioContext.prototype.createMediaElementSource=function(media){last=media;const n=create.call(this,media),analyser=this.createAnalyser();n.connect(analyser);window.__audioProbes.push({media,analyser});return n}
    AudioContext.prototype.createGain=function(){const gain=make.call(this);const p=window.__audioProbes.findLast(p=>p.media===last);if(p)p.gain=gain;return gain}
  })
  await page.getByRole('button',{name:clip.title,exact:true}).click({force:true})
  await page.locator('[data-audio-mixer]').waitFor()
  const sliders=page.locator('[data-audio-mixer] input[type=range]')
  assert.equal(await sliders.nth(0).getAttribute('aria-label'),'Micrófono');assert.equal(await sliders.nth(1).getAttribute('aria-label'),'Computadora')
  const expand=page.getByRole('button',{name:'Expandir audio de aplicaciones'});assert.equal(await expand.getAttribute('aria-expanded'),'false');await expand.click()
  const scroller=page.getByRole('region',{name:'Volúmenes de aplicaciones de este clip'})
  assert.ok(await scroller.evaluate(el=>el.scrollWidth>el.clientWidth),'App controls scroll horizontally')
  await page.getByRole('button',{name:'Reproducir',exact:true}).click()
  await page.getByRole('slider',{name:'Computadora',exact:true}).fill('0.5')
  await page.getByRole('button',{name:a.name,exact:true}).click()
  await waitFor(()=>page.evaluate(()=>{const sources=window.__audioProbes.filter(p=>p.media.dataset.audioLayer);return sources.length===3&&sources.every(p=>{const d=new Float32Array(p.analyser.fftSize);p.analyser.getFloatTimeDomainData(d);return d.some(x=>Math.abs(x)>.00001)})}),'Cross-origin audio sources reach Web Audio without silence').catch(async error=>{console.log('Audio diagnostics:',await page.evaluate(()=>window.__audioProbes.map(p=>{const d=new Float32Array(p.analyser.fftSize);p.analyser.getFloatTimeDomainData(d);return {id:p.media.dataset.audioLayer,time:p.media.currentTime,paused:p.media.paused,ready:p.media.readyState,context:p.gain.context.state,gain:p.gain.gain.value,peak:Math.max(...d)}})));throw error})
  await waitFor(()=>page.evaluate(({a,b})=>{const gain=id=>window.__audioProbes.findLast(p=>p.media.dataset.audioLayer===id)?.gain.gain.value;return gain(a)===0&&gain(b)===.5&&gain('microphone')===1},{a:a.id,b:b.id}),'Computer master, app mute and independent microphone applied live')
  await page.screenshot({path:path.join(artifacts,'mixer-expanded.png')})
  await waitFor(async()=>{const m=(await invoke('clips:list')).find(c=>c.id===clip.id)?.mix;return m?.apps?.[a.id]?.muted&&m.game===.5},'Mix persisted')
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:clip.title,exact:true}).click()
  await page.locator('[data-audio-mixer]').waitFor()
  assert.equal(await page.getByRole('slider',{name:'Computadora',exact:true}).inputValue(),'0.5')
  const renamed=await invoke('clips:rename-file',clip.id,'layered-renamed');for(const t of renamed.audioApps){assert.ok(t.file.startsWith('layered-renamed.app-'));await fs.access(path.join(clipsDir,t.file))}
  const cut=await invoke('clips:trim',{id:clip.id,startSec:.1,endSec:1.9,mode:'new'}),mixed=decode(path.join(clipsDir,cut.fileName))
  assert.ok(amplitude(mixed,440)<.0003,'Muted app absent from rendered trim')
  assert.ok(amplitude(mixed,880)>.005&&Math.abs(amplitude(mixed,880)/amplitude(pcmB,880)-.5)<.12,'Other app retains half volume')
  assert.ok(amplitude(mixed,1320)>.03,'Microphone stays independent of computer master')
  assert.deepEqual(cut.audioApps,[]);assert.equal(cut.micFile,null)
  const overwritten=await invoke('clips:trim',{id:clip.id,startSec:.1,endSec:1.9,mode:'overwrite'});assert.deepEqual(overwritten.audioApps,[])
  for(const t of renamed.audioApps)await assert.rejects(fs.access(path.join(clipsDir,t.file)))
  await invoke('clips:delete',basic.id);await invoke('clips:delete',cut.id);await invoke('clips:delete',clip.id)
  await invoke('clips:delete',fallback.id)
  assert.deepEqual(errors,[])
  console.log('PASS microphone/computer order, expander, horizontal scroll, live independent gains, audible playback, persistence, rename, rendered mix and sidecar cleanup')
}
main().catch(e=>{console.error(e,logs.slice(-4000));process.exitCode=1}).finally(async()=>{try{if(page)await invoke('test:quit')}catch{}if(child){await pause(1200);child.kill()}children.forEach(c=>c.kill());if(browser)await browser.close().catch(()=>{});console.log('Isolated audio profile:',profile)})
