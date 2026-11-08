const fs=require('node:fs/promises'),path=require('node:path')
const {constants}=require('node:fs')
const {randomUUID}=require('node:crypto')
const {AudioArchive}=require('./continuous-audio')
const cleanName=value=>String(value||'').trim().replace(/\.(mp4|webm|mkv)$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'').replace(/[. ]+$/,'').slice(0,120)
let context,active=null,last=null,writeRegistry=Promise.resolve()
const registry=()=>path.join(context.app.getPath('userData'),'continuous-pending.json')
async function read(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}}
async function json(file,value){const tmp=file+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(tmp,JSON.stringify(value));await fs.rename(tmp,file)}
function state(){return active?{id:active.id,status:active.status,name:active.name,directory:active.directory,startWall:active.startWall,elapsedSec:active.startWall?Math.max(0,((active.endWall||Date.now())-active.startWall)/1000):0,markers:active.markers,error:active.error||null,bytes:active.bytes,source:active.source}:last||{status:'idle',markers:[]}}
function emit(){context.send('continuous:state',state());context.onActive?.(!!active&&['preparing','recording','stopping'].includes(active.status))}
function journal(item){
  if(item.archive)item.appTakes=[...item.archive.tracks.values()].map(({id,name,exe,file,startWall})=>({id,name,exe,file,startWall}))
  const snapshot={...item,archive:undefined,detach:undefined,files:undefined,queue:undefined,journalQueue:undefined,finalizing:undefined,timer:undefined}
  item.journalQueue=(item.journalQueue||Promise.resolve()).catch(()=>{}).then(()=>json(path.join(item.work,'journal.json'),snapshot))
  return item.journalQueue
}
function validWork(item){return item.id&&path.resolve(item.work)===path.resolve(item.directory,'.clipper-recordings',item.id)&&/^[a-f0-9-]{36}$/.test(item.id)}

function remember(item,remove=false){writeRegistry=writeRegistry.catch(()=>{}).then(async()=>{const list=await read(registry(),[]),next=list.filter(x=>x.id!==item.id);if(!remove)next.push({id:item.id,work:item.work});await json(registry(),next)});return writeRegistry}
async function prepare(options){
  if(active)throw Error('Ya hay una grabación continua en curso o pendiente de guardar.')
  const settings=await context.store.getSettings(),name=cleanName(options.name)
  if(!name||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('Ingresá un nombre de archivo válido.')
  const directory=path.resolve(options.directory||settings.clipsDir),stat=await fs.stat(directory).catch(()=>null)
  if(!stat?.isDirectory())throw Error('La carpeta elegida no existe.')
  const id=randomUUID(),work=path.join(directory,'.clipper-recordings',id)
  await fs.mkdir(work,{recursive:true})
  active={id,work,name,directory,status:'preparing',source:options.source,createdAt:new Date().toISOString(),startWall:null,endWall:null,markers:[],bytes:0,videoContainer:options.container==='mkv'?'mkv':'webm',micStartWall:null,captureAppAudio:!!settings.captureAppAudio&&!!settings.captureSystemAudio,files:new Map(),queue:Promise.resolve(),lastChunkWall:Date.now()}
  try{await journal(active);await remember(active);emit();return state()}
  catch(e){const item=active;active=null;await fs.rm(item.work,{recursive:true,force:true}).catch(()=>{});emit();throw e}
}
function check(id){if(!active||active.id!==id)throw Error('La grabación ya no está activa.');return active}
async function started(id,wall,micWall){const item=check(id);if(item.status!=='preparing')return state();item.startWall=Math.round(wall);item.micStartWall=micWall||null;item.status='recording';if(item.captureAppAudio){if(!context.appAudio.status().recording)item.audioWarning='Se conservó Computadora completa: la captura por aplicación todavía no estaba disponible.';item.archive=new AudioArchive(item.work,item.startWall,context.ffmpeg);item.detach=context.appAudio.subscribe((info,data)=>{if(info.type==='pcm')item.archive.push(info,data);if(['error','fatal','discovery-error','coverage-gap'].includes(info.type))item.archive.problem(info.error||'Se interrumpió el audio por aplicación.')})}await journal(item);item.timer=setInterval(()=>{void journal(item).catch(e=>fail(item,e));if(Date.now()-item.lastChunkWall>15000){item.error='La captura dejó de entregar datos.';context.send('continuous:stop-request',item.id)}},5000);emit();return state()}
function fail(item,error){item.error=error.message||String(error);context.send('continuous:stop-request',item.id);emit()}
async function append(id,kind,buffer){const item=check(id);if(!['video','mic'].includes(kind)||!['preparing','recording','stopping'].includes(item.status))throw Error('Pista no válida.');const data=Buffer.from(buffer);if(data.length>32*1024*1024)throw Error('Bloque de grabación demasiado grande.');const file=path.join(item.work,kind==='video'?`video.${item.videoContainer}`:'mic.webm');const job=item.queue.then(async()=>{if(!item.files.has(kind))item.files.set(kind,await fs.open(file,'a'));let offset=0;while(offset<data.length){const result=await item.files.get(kind).write(data,offset,data.length-offset);if(!result.bytesWritten)throw Error("No se pudo escribir en el disco.");offset+=result.bytesWritten}item.bytes+=data.length;item.lastChunkWall=Date.now()});item.queue=job.catch(e=>{item.writeError=e.message;fail(item,e)});return job}
async function mark(at=Date.now()){if(!active||active.status!=='recording'||!active.startWall)return null;const marker={id:randomUUID(),timeSec:Math.max(0,(at-active.startWall)/1000),label:`Destacado ${active.markers.length+1}`};active.markers.push(marker);await journal(active);emit();return marker}
async function publishBundle(item,staged){
  for(let n=0;n<10000;n++){
    const base=item.name+(n?` (${n+1})`:''),files=staged.map(t=>({...t,file:base+t.suffix})),created=[]
    if((await Promise.all(files.map(t=>fs.stat(path.join(item.directory,t.file)).then(()=>true,()=>false)))).some(Boolean))continue
    item.publishingFiles=files.map(t=>t.file)
    try{
      for(const t of files){const target=path.join(item.directory,t.file);try{await fs.link(t.path,target)}catch(e){if(!['EPERM','ENOTSUP','EXDEV','EACCES'].includes(e.code))throw e;await fs.copyFile(t.path,target,constants.COPYFILE_EXCL)}created.push(target)}
      return files
    }catch(e){for(const file of created)await fs.rm(file,{force:true}).catch(()=>{});if(e.code!=='EEXIST')throw e}
  }
  throw Error('No se pudo elegir un nombre libre.')
}
async function finalize(id,endWall=Date.now()){
  const item=check(id);if(item.finalizing)return item.finalizing
  item.finalizing=(async()=>{
    clearInterval(item.timer);item.detach?.();item.detach=null;item.endWall=item.endWall||endWall;item.status='stopping';emit()
    await item.queue;for(const file of item.files?.values()||[])await file.close().catch(()=>{});item.files=new Map()
    if(item.archive){item.appTakes=await item.archive.stop();if(item.archive.errors.length)item.audioWarning='Se conservó Computadora completa: '+item.archive.errors[0];item.archive=null}
    await journal(item)
    let meta=item.publishedMeta
    if(!meta){
      const video=path.join(item.work,`video.${item.videoContainer}`),format=item.videoContainer==='mkv'?'mp4':'webm',output=path.join(item.work,'final.'+format)
      await context.ffmpeg.finalizeContinuous(video,output)
      const duration=await context.ffmpeg.probeDuration(output)
      if(!duration||duration<.1)throw Error('La grabación no contiene video reproducible. Los datos temporales se conservaron.')
      const staged=[{path:output,suffix:'.'+format,kind:'video'}],micSource=path.join(item.work,'mic.webm')
      if(await fs.stat(micSource).catch(()=>false)){
        const out=path.join(item.work,'final.mic.m4a')
        await context.ffmpeg.cutAudioLayer({file:micSource,rel:((item.startWall||0)-(item.micStartWall||item.startWall))/1000,dur:duration,outPath:out})
        staged.push({path:out,suffix:'.mic.m4a',kind:'mic'})
      }
      if(!item.audioWarning)for(const take of item.appTakes||[]){try{
        const out=path.join(item.work,`final.app-${take.id}.m4a`)
        await context.ffmpeg.cutAudioLayer({file:path.join(item.work,take.file),rel:((item.startWall||0)-take.startWall)/1000,dur:duration,outPath:out})
        staged.push({path:out,suffix:`.app-${take.id}.m4a`,kind:'app',id:take.id,name:take.name,exe:take.exe})
      }catch(e){item.audioWarning='Se conservó Computadora completa: '+e.message;break}}
      if(item.audioWarning)for(let i=staged.length-1;i>=0;i--)if(staged[i].kind==='app')staged.splice(i,1)
      const markers=item.markers.map(m=>({...m,timeSec:Math.min(Math.max(0,duration-.05),m.timeSec)}))
      const markerSource=path.join(item.work,'final.highlights.json');await json(markerSource,{version:1,durationSec:duration,markers})
      staged.push({path:markerSource,suffix:'.highlights.json',kind:'markers'})
      const published=await publishBundle(item,staged),fileName=published.find(t=>t.kind==='video').file
      const stat=await fs.stat(path.join(item.directory,fileName)),library=await context.store.getClipsDir(),thumbnail=item.id+'.jpg'
      const hasThumb=await context.ffmpeg.thumbnail(path.join(item.directory,fileName),path.join(library,'.thumbs',thumbnail)).then(()=>true).catch(()=>false)
      let audioBytes=0;for(const t of published.filter(t=>['mic','app'].includes(t.kind)))audioBytes+=(await fs.stat(path.join(item.directory,t.file))).size
      const audioApps=published.filter(t=>t.kind==='app').map(({id,name,exe,file})=>({id,name,exe,file}))
      meta={id:item.id,fileName,title:item.name,displayName:item.name,createdAt:item.createdAt,durationSec:duration,source:item.source,sizeBytes:stat.size,storageDir:item.directory,recording:true,markers,markerFile:published.find(t=>t.kind==='markers').file,format,micFile:published.find(t=>t.kind==='mic')?.file||null,audioApps,audioBytes,audioWarning:item.audioWarning||null,thumbnail:hasThumb?thumbnail:null,mix:{game:1,mic:1,gameMuted:false,micMuted:false}}
      item.publishedMeta=meta;await journal(item)
    }
    await context.store.upsertClip(meta);await remember(item,true);last={status:'idle',markers:[],saved:meta,error:item.error||null};active=null;emit();context.send('continuous:saved',meta)
    const resolved=path.resolve(item.work),parent=path.resolve(item.directory,'.clipper-recordings')+path.sep
    await item.journalQueue
    if(validWork(item)&&resolved.startsWith(parent))await fs.rm(resolved,{recursive:true,force:true}).catch(()=>{})
    return meta
  })().catch(async e=>{item.status='error';item.error=e.message;item.finalizing=null;await journal(item).catch(()=>{});emit();throw e})
  return item.finalizing
}
async function cancel(id){const item=check(id);if(!['preparing','error'].includes(item.status))return finalize(id);clearInterval(item.timer);item.detach?.();if(item.archive)await item.archive.stop();await item.queue;for(const f of item.files.values())await f.close();await remember(item,true);const resolved=path.resolve(item.work);if(validWork(item)&&resolved.startsWith(path.resolve(item.directory,'.clipper-recordings')+path.sep))await fs.rm(resolved,{recursive:true,force:true});active=null;emit()}
async function shutdown(){
  if(!active)return
  if(active.status==='preparing'){context.send('continuous:stop-request',active.id);return cancel(active.id)}
  if(active.status==='recording'){
    context.send('continuous:stop-request',active.id)
    const until=Date.now()+20000
    while(active?.status==='recording'&&Date.now()<until)await new Promise(r=>setTimeout(r,100))
  }
  if(active)await finalize(active.id).catch(e=>context.log.write('continua','Se conservó la grabación temporal: '+e.message))
}
async function install(value){context=value;value.ipcMain.handle('continuous:status',()=>state());value.ipcMain.handle('continuous:prepare',(_e,o)=>prepare(o));value.ipcMain.handle('continuous:started',(_e,id,wall,mic)=>started(id,wall,mic));value.ipcMain.handle('continuous:append',(_e,id,kind,data)=>append(id,kind,data));value.ipcMain.handle('continuous:mark',(_e,at)=>mark(at));value.ipcMain.handle('continuous:finish',(_e,id,end)=>finalize(id,end));value.ipcMain.handle('continuous:cancel',(_e,id)=>cancel(id));value.ipcMain.handle('continuous:choose-dir',async()=>{const result=await value.dialog.showOpenDialog({properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0]});
  const pending=await read(registry(),[])
  async function recover(){for(const ref of pending){
    const item=await read(path.join(ref.work,'journal.json'),null)
    if(active)break
    if(!item||!validWork(item)){context.log.write('continua','Registro temporal inválido: '+ref.id);continue}
    if(!item.startWall){await remember(item,true);await fs.rm(item.work,{recursive:true,force:true}).catch(()=>{});continue}
    active={...item,files:new Map(),queue:Promise.resolve(),status:'error',endWall:item.endWall||item.lastChunkWall};last=null
    await finalize(item.id,active.endWall).catch(e=>value.log.write('continua','Recuperación pendiente: '+e.message));if(active)break
  }}
  value.app.once('browser-window-created',()=>setTimeout(()=>void recover(),500))
}
function ownsFile(directory,file){return !!active&&path.resolve(active.directory)===path.resolve(directory)&&(active.publishingFiles||[]).includes(file)}
module.exports={ownsFile,install,state,prepare,started,append,mark,finalize,cancel,shutdown,cleanName,active:()=>!!active&&['preparing','recording','stopping'].includes(active.status)}
