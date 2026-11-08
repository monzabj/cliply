const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os')
const {AudioArchive}=require('../electron/continuous-audio')
const {decode,amplitude}=require('./audio-fixtures.cjs')
function pcm(seconds,hz){const data=Buffer.alloc(Math.round(seconds*48000)*4);for(let i=0;i<data.length/4;i++){const n=Math.round(Math.sin(i*2*Math.PI*hz/48000)*6000);data.writeInt16LE(n,i*4);data.writeInt16LE(n,i*4+2)}return data}
test('continuous application AAC streams align clipped starts and later silence without retaining the full PCM history',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'clipper-cont-audio-'))
  const start=Date.now()-3000,archive=new AudioArchive(folder,start,{binary:()=>require('ffmpeg-static')})
  try{
    const info={id:'one',name:'App',exe:'any-application.exe'}
    archive.push({...info,startWall:start-100},pcm(.5,440))
    archive.push({...info,startWall:start+1000},pcm(.8,880))
    const tracks=await archive.stop();assert.deepEqual(archive.errors,[]);assert.equal(tracks.length,1);assert.equal(tracks[0].startWall,start)
    const decoded=decode(path.join(folder,tracks[0].file)),slice=(a,b)=>decoded.subarray(Math.round(a*48000)*4,Math.round(b*48000)*4)
    assert.ok(amplitude(slice(.1,.3),440)>.1,'samples before video start are cut')
    assert.ok(amplitude(slice(.6,.9),440)<.001,'inactive interval remains silent')
    assert.ok(amplitude(slice(1.2,1.6),880)>.1,'later app sound remains on its original clock')
    assert.ok(decoded.length/192000>1.75&&decoded.length/192000<1.9)
    assert.equal([...archive.tracks.values()][0].queued,0)
  }finally{await fs.rm(folder,{recursive:true,force:true})}
})
