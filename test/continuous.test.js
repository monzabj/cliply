const {test}=require('node:test')
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events')
async function fixture(){
  delete require.cache[require.resolve('../electron/continuous')]
  const service=require('../electron/continuous'),root=await fs.mkdtemp(path.join(os.tmpdir(),'clipper-continuous-')),directory=path.join(root,'external'),library=path.join(root,'library'),clips=[],events=[],handlers=new Map()
  await fs.mkdir(directory);await fs.mkdir(path.join(library,'.thumbs'),{recursive:true})
  const app=new EventEmitter();app.getPath=()=>root
  const settings={clipsDir:library,captureAppAudio:false,captureSystemAudio:true}
  await service.install({app,ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},store:{getSettings:async()=>settings,getClipsDir:async()=>library,upsertClip:async c=>{clips.push(c)}},dialog:{},send:(...e)=>events.push(e),log:{write(){}},appAudio:{},ffmpeg:{finalizeContinuous:fs.copyFile,probeDuration:async()=>5,thumbnail:async(_i,out)=>fs.writeFile(out,'thumb'),cutAudioLayer:async({file,outPath})=>fs.copyFile(file,outPath)}})
  const begin=()=>service.prepare({name:'Sesión',directory,source:{type:'screen',name:'HD'},container:'mkv'})
  return {root,directory,library,service,settings,begin,clips,events,handlers,app,cleanup:()=>fs.rm(root,{recursive:true,force:true})}
}
test('continuous capture streams ordered blocks, persists independent highlights and retains the chosen destination',async()=>{
  const f=await fixture();try{
    assert.equal(f.service.state().status,'idle');assert.equal(await f.service.mark(),null)
    const c=await f.begin();await assert.rejects(f.begin(),/Ya hay/)
    const start=Date.now();await f.service.started(c.id,start)
    await Promise.all([f.service.append(c.id,'video',Buffer.from('first')),f.service.append(c.id,'video',Buffer.from('last')),...[1,2,3].map(n=>f.service.mark(start+n*1000))])
    const [saved,again]=await Promise.all([f.service.finalize(c.id,start+5000),f.service.finalize(c.id,start+5000)])
    assert.equal(saved.id,again.id);assert.equal(f.clips.length,1)
    assert.equal(saved.storageDir,f.directory);assert.equal(saved.recording,true);assert.deepEqual(saved.markers.map(m=>m.timeSec),[1,2,3])
    assert.equal(await fs.readFile(path.join(f.directory,saved.fileName),'utf8'),'firstlast')
    assert.equal(JSON.parse(await fs.readFile(path.join(f.directory,saved.markerFile))).markers.length,3)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root,'continuous-pending.json'))),[])
    assert.equal(f.service.state().status,'idle')
  }finally{await f.cleanup()}
})
test('continuous names never overwrite existing videos or sidecars and reject Windows reserved names',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.service.prepare({name:'NUL.mp4',directory:f.directory}),/válido/)
    await fs.writeFile(path.join(f.directory,'Sesión.highlights.json'),'keep markers')
    await fs.writeFile(path.join(f.directory,'Sesión (2).mp4'),'keep video')
    const c=await f.begin();await f.service.started(c.id,Date.now());await f.service.append(c.id,'video',Buffer.from('new'))
    const meta=await f.service.finalize(c.id);assert.equal(meta.fileName,'Sesión (3).mp4')
    assert.equal(await fs.readFile(path.join(f.directory,'Sesión.highlights.json'),'utf8'),'keep markers')
    assert.equal(await fs.readFile(path.join(f.directory,'Sesión (2).mp4'),'utf8'),'keep video')
  }finally{await f.cleanup()}
})
test('canceling before capture starts clears the pending journal without publishing an empty recording',async()=>{
  const f=await fixture();try{const c=await f.begin();await f.service.cancel(c.id);assert.equal(f.service.state().status,'idle');assert.equal(f.clips.length,0);assert.equal((await fs.readdir(path.join(f.directory,'.clipper-recordings'))).length,0)}finally{await f.cleanup()}
})
test('trimmed highlight timestamps follow the retained video range',()=>{
  const {cutMarkers}=require('../electron/media-paths')
  assert.deepEqual(cutMarkers([{timeSec:1},{timeSec:3},{timeSec:4},{timeSec:6}],2,6),[{timeSec:1},{timeSec:2}])
})
