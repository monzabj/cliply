const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{once}=require('node:events')
const media=require('../electron/media-files')
test('overwrite waits for existing encoders and rejects new readers or a second write',async()=>{
  let finish,entered=false
  const reading=media.readJob('busy-test',()=>new Promise(r=>{finish=r}))
  await Promise.resolve()
  const editing=media.edit('busy-test',async()=>{entered=true;await assert.rejects(media.readJob('busy-test',()=>{}),/guardando/)})
  await Promise.resolve();assert.equal(entered,false)
  await assert.rejects(media.edit('busy-test',()=>{}),/guardando/)
  finish();await reading;await editing;assert.equal(entered,true)
  assert.equal(await media.readJob('busy-test',()=>42),42)
})
test('protocol cancellation and replacement close real file streams and unblock the paths afterward',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipper-stream-')),file=path.join(dir,'video.mp4')
  try{
    await fs.writeFile(file,Buffer.alloc(1024*1024))
    const stream=media.open(file,{highWaterMark:16});await once(stream,'open')
    await media.release([file],async()=>{assert.equal(stream.closed,true);assert.equal(media.isBlocked(file),true)})
    assert.equal(media.isBlocked(file),false)
    const controller=new AbortController(),next=media.open(file,{},controller.signal);await once(next,'open')
    const closing=once(next,'close');controller.abort();await closing;assert.equal(next.closed,true)
    await assert.rejects(media.release([file],async()=>{throw Error('failed')}),/failed/)
    assert.equal(media.isBlocked(file),false)
  }finally{await fs.rm(dir,{recursive:true,force:true})}
})
test('atomic overwrite retries transient Windows locks while preserving the original until commit',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipper-replace-')),old=path.join(dir,'original.mp4'),temp=path.join(dir,'trim.mp4')
  try{
    await fs.writeFile(old,'original');await fs.writeFile(temp,'trimmed');let calls=0,waits=0
    await media.replaceFile(temp,old,async(a,b)=>{assert.equal(await fs.readFile(old,'utf8'),'original');if(++calls<3)throw Object.assign(Error('locked'),{code:'EPERM'});await fs.rename(a,b)},async()=>{waits++})
    assert.equal(calls,3);assert.equal(waits,2);assert.equal(await fs.readFile(old,'utf8'),'trimmed')
    await fs.writeFile(temp,'next')
    await assert.rejects(media.replaceFile(temp,old,async()=>{throw Object.assign(Error('locked'),{code:'EACCES'})},async()=>{}),/original se conservó/)
    assert.equal(await fs.readFile(old,'utf8'),'trimmed');assert.equal(await fs.readFile(temp,'utf8'),'next')
  }finally{await fs.rm(dir,{recursive:true,force:true})}
})
