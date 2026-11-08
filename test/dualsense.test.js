const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {execFileSync}=require('node:child_process')
test('native DualSense report parser handles USB, Bluetooth, basic mode and malformed reports',{skip:process.platform!=='win32'},()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'clipper-hid-parser-'))
  try{
    const source=path.join(folder,'Runner.cs'),exe=path.join(folder,'Runner.exe')
    fs.writeFileSync(source,'using System; class Runner { static void Main(string[] args) { byte[] b=new byte[args[0].Length/2];for(int i=0;i<b.Length;i++)b[i]=Convert.ToByte(args[0].Substring(i*2,2),16);var p=DualSenseInput.Parse(b);Console.WriteLine(p==null?"null":p.Json(16)); } }')
    const compiler=path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe')
    execFileSync(compiler,['/nologo','/out:'+exe,source,path.resolve(__dirname,'../electron/input/DualSenseInput.cs')],{windowsHide:true})
    const parse=b=>JSON.parse(execFileSync(exe,[b.toString('hex')],{windowsHide:true,encoding:'utf8'}))
    for(const [id,length,offset,simple] of [[1,64,1,false],[0x31,78,2,false],[1,10,1,true],[1,78,1,true]]){
      const b=Buffer.alloc(length);b[0]=id;b.set([128,128,255,0],offset)
      b[offset+(simple?7:4)]=128;b[offset+(simple?8:5)]=255
      b.set([0xf1,0xf3,7],offset+(simple?4:7))
      const p=parse(b)
      assert.equal(p.buttons,4096|8192|16384|32768|1|8|256|512|32|16|64|128)
      assert.equal(p.lt,128);assert.equal(p.rt,255);assert.equal(p.lx,0);assert.equal(p.ly,0);assert.equal(p.rx,1);assert.equal(p.ry,1)
      assert.deepEqual(p.extra,{guide:true,touchpad:true,mute:simple?null:true})
    }
    const neutral=Buffer.alloc(64);neutral[0]=1;neutral.fill(128,1,5);neutral[8]=8
    assert.equal(parse(neutral).buttons,0)
    const directions=[1,9,8,10,2,6,4,5,0]
    for(let i=0;i<directions.length;i++){neutral[8]=i;assert.equal(parse(neutral).buttons,directions[i])}
    for(const b of [Buffer.alloc(0),Buffer.from([1,2]),Buffer.alloc(15),Buffer.alloc(64,0x31)])assert.equal(parse(b),null)
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
})
