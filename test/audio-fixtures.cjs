const fs=require('node:fs/promises'),path=require('node:path'),cp=require('node:child_process')
const pause=ms=>new Promise(r=>setTimeout(r,ms))
async function tones(folder,seconds=20){
  await fs.mkdir(folder,{recursive:true})
  const source=path.join(folder,'Tone.cs')
  await fs.writeFile(source,'using System;using System.Media;using System.Threading;class Tone {static void Main(string[] a){Thread.Sleep(1000);var s=new SoundPlayer(a[0]);s.Load();s.PlaySync();Thread.Sleep(1000);}}')
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const children=[]
  for(const [name,hz] of [['ToneA',440],['ToneB',880],['Silent',0]]){
    const exe=path.join(folder,name+'.exe'),wav=path.join(folder,name+'.wav'),n=48000*seconds,b=Buffer.alloc(44+n*4)
    b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*4,40)
    for(let i=0;i<n;i++){const v=Math.round(Math.sin(2*Math.PI*hz*i/48000)*1000);b.writeInt16LE(v,44+i*4);b.writeInt16LE(v,46+i*4)}
    await fs.writeFile(wav,b)
    cp.execFileSync(compiler,['/nologo','/out:'+exe,source],{windowsHide:true})
    children.push(cp.spawn(exe,[wav],{windowsHide:true,stdio:'ignore'}))
  }
  return children
}
function amplitude(pcm,hz,rate=48000){const count=Math.min(Math.floor(pcm.length/4),rate),start=Math.min(Math.floor(pcm.length/4)-count,rate/2);let re=0,im=0;for(let i=0;i<count;i++){const v=pcm.readInt16LE((start+i)*4)/32768;re+=v*Math.cos(2*Math.PI*hz*i/rate);im+=v*Math.sin(2*Math.PI*hz*i/rate)}return Math.hypot(re,im)*2/count}
function ffmpeg(args){return cp.execFileSync(require('ffmpeg-static'),['-hide_banner','-loglevel','error',...args],{windowsHide:true,maxBuffer:32*1024*1024})}
function decode(file){return ffmpeg(['-i',file,'-f','s16le','-ar','48000','-ac','2','pipe:1'])}
module.exports={tones,amplitude,ffmpeg,decode,pause}
