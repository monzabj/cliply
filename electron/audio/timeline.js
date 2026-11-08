const RATE=48000,ALIGN=4
// Framed binary IPC avoids base64 and keeps PCM outside Electron's renderer.
class Decoder {
  constructor(onMessage){this.pending=Buffer.alloc(0);this.onMessage=onMessage}
  push(data){
    this.pending=this.pending.length?Buffer.concat([this.pending,data]):data
    while(this.pending.length>=8){const h=this.pending.readUInt32LE(0),n=this.pending.readUInt32LE(4)
      if(h>65536||n>4*1024*1024)throw Error('Invalid audio worker frame')
      if(this.pending.length<8+h+n)return
      const info=JSON.parse(this.pending.toString('utf8',8,8+h)),pcm=Buffer.from(this.pending.subarray(8+h,8+h+n))
      this.pending=this.pending.subarray(8+h+n);this.onMessage(info,pcm)
    }
  }
}
class AudioTimeline {
  constructor(retainMs=40000,maxBytes=192*1024*1024){this.retainMs=retainMs;this.maxBytes=maxBytes;this.tracks=new Map();this.bytes=0;this.problems=[]}
  problem(time,message,start=time){this.problems.push({time,message,start});this.prune(time)}
  push(info,data){
    if(!Number.isFinite(info.startWall)||!data.length||data.length%ALIGN)return
    let track=this.tracks.get(info.id)
    if(!track){track={id:info.id,name:String(info.name||info.exe||'Aplicación'),exe:String(info.exe||''),chunks:[]};this.tracks.set(info.id,track)}
    const chunk={start:info.startWall,end:info.startWall+data.length/ALIGN/RATE*1000,data,peak:info.peak||0}
    track.chunks.push(chunk);this.bytes+=data.length;this.prune(chunk.end)
    while(this.bytes>this.maxBytes){let oldest=null;for(const t of this.tracks.values())if(t.chunks.length&&(!oldest||t.chunks[0].start<oldest.chunks[0].start))oldest=t
      if(!oldest)break;const removed=oldest.chunks.shift();this.bytes-=removed.data.length;this.problems.push({time:removed.end,message:'Se alcanzó el límite de memoria del audio separado.'})
    }
  }
  prune(now){const cutoff=now-this.retainMs;for(const [id,t] of this.tracks){while(t.chunks.length&&t.chunks[0].end<cutoff)this.bytes-=t.chunks.shift().data.length;if(!t.chunks.length)this.tracks.delete(id)}this.problems=this.problems.filter(p=>p.time>=cutoff)}
  snapshot(start,end){
    const tracks=[]
    for(const t of this.tracks.values()){const chunks=t.chunks.filter(c=>c.end>start&&c.start<end);if(chunks.length)tracks.push({...t,chunks:[...chunks]})}
    return {start,end,tracks,problems:this.problems.filter(p=>p.time>=start&&(p.start??p.time)<=end)}
  }
}
function windowPcm(track,start,end){
  const output=Buffer.alloc(Math.max(0,Math.round((end-start)*RATE/1000))*ALIGN)
  for(const c of track.chunks){const offset=Math.round((c.start-start)*RATE/1000),from=Math.max(0,-offset),to=Math.min(c.data.length/ALIGN,output.length/ALIGN-offset)
    if(to>from)c.data.copy(output,(offset+from)*ALIGN,from*ALIGN,to*ALIGN)
  }
  return output
}
module.exports={Decoder,AudioTimeline,windowPcm,RATE,ALIGN}
