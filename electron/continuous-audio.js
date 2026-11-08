const {spawn}=require('node:child_process')
const path=require('node:path'),os=require('node:os')
const {createHash}=require('node:crypto')
// One encoder per audible application. Silence is supplied on its recording
// clock, not buffered for the whole recording. Output survives a process crash.
class AudioArchive {
  constructor(folder,start,ffmpeg){this.folder=folder;this.start=start;this.ffmpeg=ffmpeg;this.tracks=new Map();this.errors=[];this.closed=false}
  push(info,data){
    if(this.closed||info.startWall+data.length/192> Date.now()+5000)return
    const key=info.id;let track=this.tracks.get(key)
    if(!track){
      if(this.tracks.size>=8){this.problem('Se alcanzó el límite de 8 pistas de aplicación para esta grabación.');return}
      const file=`app-${createHash('sha256').update(key).digest('hex').slice(0,12)}.m4a`,first=Math.max(this.start,info.startWall)
      const child=spawn(this.ffmpeg.binary(),['-hide_banner','-loglevel','error','-y','-f','s16le','-ar','48000','-ac','2','-i','pipe:0','-c:a','aac','-b:a','128k','-threads','1','-movflags','frag_keyframe+empty_moov',path.join(this.folder,file)],{windowsHide:true,stdio:['pipe','ignore','pipe']})
      track={id:createHash('sha256').update(key).digest('hex').slice(0,12),name:info.name,exe:info.exe,file,startWall:first,child,cursor:0,queued:0,chain:Promise.resolve(),error:null}
      this.tracks.set(key,track)
      child.stdin.on('error',e=>{track.error=e.message})
      child.stderr.on('data',b=>{track.stderr=String(b).slice(-1000)})
      child.on('error',e=>{track.error=e.message})
      track.exited=new Promise(resolve=>{child.once('close',code=>{if(code!==0)track.error=track.stderr||`Audio encoder exited (${code})`;resolve()})})
      try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL)}catch{}
    }
    if(track.error)return
    const offset=Math.round((info.startWall-track.startWall)*48),from=Math.max(0,track.cursor-offset),gap=Math.max(0,offset-track.cursor),pcm=data.subarray(Math.min(data.length,from*4))
    track.cursor=Math.max(track.cursor,offset+data.length/4);track.queued+=pcm.length+Math.min(gap*4,2*1024*1024)
    if(track.queued>4*1024*1024){track.error='No se pudo escribir el audio por aplicación a tiempo.';return}
    track.chain=track.chain.then(async()=>{
      if(track.error)return
      let silence=gap*4
      while(silence>0){const n=Math.min(silence,65536);await this.write(track,Buffer.alloc(n));silence-=n}
      await this.write(track,pcm)
    }).catch(e=>{track.error=e.message}).finally(()=>{track.queued-=pcm.length+Math.min(gap*4,2*1024*1024)})
  }
  async write(track,buffer){
    if(!buffer.length||track.error)return
    if(!track.child.stdin.write(buffer))await new Promise((resolve,reject)=>{
      const stream=track.child.stdin,done=error=>{clearTimeout(timer);stream.off('drain',drain);stream.off('error',done);stream.off('close',closed);error?reject(error):resolve()},drain=()=>done(),closed=()=>done(Error('Audio encoder closed'))
      const timer=setTimeout(()=>done(Error('Audio encoder timeout')),10000);timer.unref()
      stream.once('drain',drain);stream.once('error',done);stream.once('close',closed)
    })
  }
  problem(message){if(this.errors.length<10)this.errors.push(message);void this.stop()}
  stop(){
    if(this.stopping)return this.stopping
    this.closed=true
    this.stopping=(async()=>{
    await Promise.all([...this.tracks.values()].map(async t=>{
      await t.chain;t.child.stdin.end()
      let timer;await Promise.race([t.exited,new Promise(resolve=>{timer=setTimeout(()=>{t.child.kill();t.error='Audio encoder timeout';resolve()},15000);timer.unref()})]);clearTimeout(timer)
      if(t.error&&this.errors.length<10)this.errors.push(t.error)
    }))
    return [...this.tracks.values()].map(({id,name,exe,file,startWall})=>({id,name,exe,file,startWall}))
    })()
    return this.stopping
  }
}
module.exports={AudioArchive}
