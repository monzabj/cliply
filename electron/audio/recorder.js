const {spawn}=require('node:child_process')
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os')
const {createHash}=require('node:crypto')
const {Decoder,AudioTimeline,windowPcm}=require('./timeline')
const log=require('../log')
let app,store,ffmpeg,settings={},armed=false,worker=null,readyAt=null,lastError=null,retry=null
let timeline=new AudioTimeline()
const subscribers=new Set()
const subscribe=listener=>{subscribers.add(listener);return()=>subscribers.delete(listener)}
const supported=()=>process.platform==='win32'&&Number(os.release().split('.')[2])>=20348
const wanted=()=>supported()&&armed&&settings.captureSystemAudio&&settings.captureAppAudio
function status(){return {enabled:!!settings.captureAppAudio,recording:!!worker&&readyAt!==null,supported:supported(),error:lastError,bufferedBytes:timeline.bytes,applications:timeline.tracks.size}}
function stop(){clearTimeout(retry);retry=null;const old=worker;worker=null;readyAt=null;if(old)old.kill()}
function reconcile(){
  if(!wanted()){stop();timeline=new AudioTimeline(timeline.retainMs);lastError=null;return}
  if(worker||retry)return
  const file=path.join(__dirname,'AudioWorker.exe').replace('app.asar','app.asar.unpacked')
  const args=[String(process.pid)]
  if(process.env.CLIPPER_TEST_DATA&&process.env.CLIPPER_AUDIO_TEST_PIDS)args.push(process.env.CLIPPER_AUDIO_TEST_PIDS)
  const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});worker=child;readyAt=null;lastError=null
  const decoder=new Decoder((info,pcm)=>{
    if(worker!==child)return
    for(const listener of subscribers){try{listener(info,pcm)}catch(e){log.write('audio-apps',e.message)}}
    if(info.type==='ready')readyAt=Date.now()
    if(info.type==='pcm')timeline.push(info,pcm)
    if(info.type==='coverage-gap')timeline.problem(info.end,`${info.name}: la pista se inició durante el clip.`,info.start)
    if(['error','fatal','discovery-error'].includes(info.type)){lastError=`${info.name||'Audio'}: ${info.error}`;timeline.problem(Date.now(),lastError);log.write('audio-apps',lastError)}
  })
  const failed=message=>{if(worker!==child)return;lastError=message;timeline.problem(Date.now(),message);for(const listener of subscribers)listener({type:'error',error:message},Buffer.alloc(0));stop();if(wanted())retry=setTimeout(()=>{retry=null;reconcile()},10000)}
  child.stdout.on('data',data=>{try{decoder.push(data)}catch(e){failed(e.message)}})
  child.stderr.on('data',data=>log.write('audio-apps',String(data).slice(-1000)))
  child.on('error',e=>failed(e.message));child.on('exit',code=>failed(`Se detuvo la captura por aplicación (${code}).`))
  try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL)}catch{}
}
function configure(value){if(settings.captureAppAudio&&(!value.captureAppAudio||!value.captureSystemAudio))for(const listener of subscribers){try{listener({type:'error',error:'Se desactivó la captura de audio por aplicación durante la grabación.'},Buffer.alloc(0))}catch{}}settings=value;timeline.retainMs=(Math.min(300,Math.max(30,...(settings.hotkeys||[]).map(h=>Number(h.durationSec)||0)))+10)*1000;reconcile()}
function setArmed(value){armed=!!value;reconcile()}
function snapshot(start,end){
  if(!settings.captureSystemAudio||!settings.captureAppAudio)return null
  const result=timeline.snapshot(start,end)
  if(!readyAt||readyAt>start+100)result.problems.push({time:start,message:'La captura por aplicación todavía no cubría todo este clip.'})
  return result
}
async function save(clipsDir,fileName,snapshot){
  if(!snapshot)return {audioApps:[],audioWarning:null}
  // Preserve the existing computer mix when isolation had a gap or failure.
  // Never present partially isolated audio as the complete computer soundtrack.
  if(snapshot.problems.length)return {audioApps:[],audioWarning:'Se conservó Computadora completa: '+snapshot.problems[0].message}
  const base=fileName.replace(/\.[^.]+$/,''),files=[],groups=new Map()
  try{
    for(const track of snapshot.tracks){
      const groupKey=track.exe.toLowerCase()||track.id
      if(!groups.has(groupKey))groups.set(groupKey,[]);groups.get(groupKey).push(track)
    }
    for(const [group,tracks] of groups){
      const id=createHash('sha256').update(group).digest('hex').slice(0,12),file=`${base}.app-${id}.m4a`
      const pcm=windowPcm(tracks[0],snapshot.start,snapshot.end)
      // Different independent roots of the same executable share one app fader.
      for(const track of tracks.slice(1)){const other=windowPcm(track,snapshot.start,snapshot.end);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(Math.max(-32768,Math.min(32767,pcm.readInt16LE(i)+other.readInt16LE(i))),i)}
      const full=path.join(clipsDir,file);files.push(full);await ffmpeg.encodePcm(pcm,full)
      files[files.length-1]=full
      tracks[0].saved={id,name:tracks[0].name,exe:tracks[0].exe,file}
    }
    return {audioApps:[...groups.values()].map(t=>t[0].saved),audioWarning:null}
  }catch(e){await Promise.all(files.map(file=>fs.rm(file,{force:true}).catch(()=>{})));log.write('audio-apps',`No se pudo guardar la separación: ${e.message}`);return {audioApps:[],audioWarning:'Se conservó Computadora completa: no se pudieron guardar las pistas por aplicación.'}}
}
async function install(context){app=context.app;store=context.store;ffmpeg=context.ffmpeg;configure(await store.getSettings());context.ipcMain.handle('audio-apps:status',()=>status())}
module.exports={install,configure,setArmed,stop,status,snapshot,save,subscribe,killForTest:()=>{if(process.env.CLIPPER_TEST_DATA)worker?.kill()}}
