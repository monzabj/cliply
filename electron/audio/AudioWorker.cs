// Windows process loopback. PCM is sent to the parent, kept in a bounded RAM
// ring and encoded only when a clip is saved. The worker never changes volumes.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

[ComVisible(true),ClassInterface(ClassInterfaceType.None)]public class Activation : IActivateCompletion,IAgileObject {
  internal readonly ManualResetEvent Completed=new ManualResetEvent(false);
  internal IAudioClient Client;internal Exception Error;
  public int ActivateCompleted(IActivateOperation operation){try{int hr;object result;AudioNative.Check(operation.GetActivateResult(out hr,out result));AudioNative.Check(hr);Client=(IAudioClient)result;}catch(Exception e){Error=e;}finally{Completed.Set();}return 0;}
}
internal sealed class ProcessCapture : IDisposable {
  readonly uint pid;readonly string id,name,exe;readonly double wallOffset;
  readonly double discovered=AudioWorker.Now-500;
  internal volatile bool Running=true;internal long Seen=AudioWorker.Monotonic;
  readonly Thread thread;
  internal ProcessCapture(uint process,string key,string label,string file){pid=process;id=key;name=label;exe=file;wallOffset=AudioWorker.Now-Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency;thread=new Thread(Run);thread.IsBackground=true;thread.SetApartmentState(ApartmentState.MTA);thread.Start();}
  void Run(){
    IAudioClient client=null;object service=null;IActivateOperation operation=null;IntPtr parameters=IntPtr.Zero,variant=IntPtr.Zero;Activation activation=new Activation();
    try{
      parameters=Marshal.AllocHGlobal(12);Marshal.WriteInt32(parameters,0,1);Marshal.WriteInt32(parameters,4,(int)pid);Marshal.WriteInt32(parameters,8,0);
      variant=Marshal.AllocHGlobal(24);for(int i=0;i<24;i++)Marshal.WriteByte(variant,i,0);Marshal.WriteInt16(variant,0,65);Marshal.WriteInt32(variant,8,12);Marshal.WriteIntPtr(variant,16,parameters);
      Guid iid=typeof(IAudioClient).GUID;
      AudioNative.Check(AudioNative.ActivateAudioInterfaceAsync("VAD\\Process_Loopback",ref iid,variant,activation,out operation));
      // Keep all unmanaged activation parameters and callback alive until completion.
      Stopwatch activationClock=Stopwatch.StartNew();
      while(!activation.Completed.WaitOne(200)) { if(!AudioWorker.ParentAlive())Environment.Exit(0);if(activationClock.ElapsedMilliseconds>10000){AudioWorker.Send(new{type="fatal",error="Windows no respondió al iniciar la captura por aplicación."},null);Environment.Exit(2);} }
      if(activation.Error!=null)throw activation.Error;client=activation.Client;
      AudioNative.WaveFormat format=new AudioNative.WaveFormat{tag=1,channels=2,rate=48000,bytesPerSecond=192000,blockAlign=4,bits=16,extra=0};
      AudioNative.Check(client.Initialize(0,0x20000|0x40000,200000,0,ref format,IntPtr.Zero));
      using(AutoResetEvent ready=new AutoResetEvent(false)){
        AudioNative.Check(client.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle()));iid=typeof(ICaptureClient).GUID;
        AudioNative.Check(client.GetService(ref iid,out service));ICaptureClient capture=(ICaptureClient)service;AudioNative.Check(client.Start());
        AudioWorker.Send(new{type="capture",id=id,pid=pid,name=name,exe=exe},null);
        AudioWorker.Send(new{type="coverage-gap",name=name,start=discovered,end=AudioWorker.Now},null);
        bool firstPacket=true;
        while(Running){
          ready.WaitOne(100);uint available;
          while(Running){AudioNative.Check(capture.GetNextPacketSize(out available));if(available==0)break;
            IntPtr ptr;uint frames,flags;ulong position,qpc;AudioNative.Check(capture.GetBuffer(out ptr,out frames,out flags,out position,out qpc));
            if(!firstPacket&&(flags&1)!=0)AudioWorker.Send(new{type="error",id=id,name=name,error="Windows informó una interrupción en esta pista de audio."},null);firstPacket=false;
            byte[] data=new byte[frames*4];try{if((flags&2)==0)Marshal.Copy(ptr,data,0,data.Length);}finally{capture.ReleaseBuffer(frames);}
            int peak=0;for(int i=0;i<data.Length;i+=2){int sample=(short)(data[i]|data[i+1]<<8);peak=Math.Max(peak,Math.Abs(sample));}
            if(peak>3){double start=(flags&4)==0?qpc/10000.0+wallOffset:AudioWorker.Now-frames/48.0;AudioWorker.Send(new{type="pcm",id=id,name=name,exe=exe,startWall=start,frames=frames,peak=peak/32768.0},data);}
          }
        }
        client.Stop();
      }
    }catch(Exception error){AudioWorker.Send(new{type="error",id=id,name=name,error=error.Message},null);}
    finally{Running=false;AudioNative.Release(service);AudioNative.Release(client);AudioNative.Release(operation);if(parameters!=IntPtr.Zero)Marshal.FreeHGlobal(parameters);if(variant!=IntPtr.Zero)Marshal.FreeHGlobal(variant);GC.KeepAlive(activation);}
  }
  public void Dispose(){Running=false;thread.Join(1500);}
}
internal class AudioWorker {
  static readonly object outputLock=new object();static readonly Stream output=Console.OpenStandardOutput();static readonly JavaScriptSerializer json=new JavaScriptSerializer();
  static int parent;static HashSet<uint> targets;
  internal static long Monotonic{get{return (long)(Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency);}}
  internal static double Now{get{return (DateTime.UtcNow.Ticks-621355968000000000)/10000.0;}}
  internal static bool ParentAlive(){try{return !Process.GetProcessById(parent).HasExited;}catch{return false;}}
  internal static void Send(object info,byte[] data){lock(outputLock){byte[] header=Encoding.UTF8.GetBytes(json.Serialize(info));try{output.Write(BitConverter.GetBytes(header.Length),0,4);output.Write(BitConverter.GetBytes(data==null?0:data.Length),0,4);output.Write(header,0,header.Length);if(data!=null)output.Write(data,0,data.Length);output.Flush();}catch{Environment.Exit(0);}}}
  static string Image(uint pid){IntPtr process=AudioNative.OpenProcess(0x1000,false,pid);if(process==IntPtr.Zero)return null;try{uint size=2048;StringBuilder name=new StringBuilder((int)size);return AudioNative.QueryFullProcessImageName(process,0,name,ref size)?name.ToString():null;}finally{AudioNative.CloseHandle(process);}}
  static Dictionary<uint,uint> Parents(){Dictionary<uint,uint> result=new Dictionary<uint,uint>();IntPtr snapshot=AudioNative.CreateToolhelp32Snapshot(2,0);if(snapshot.ToInt64()==-1)return result;try{AudioNative.ProcessEntry entry=new AudioNative.ProcessEntry();entry.size=(uint)Marshal.SizeOf(entry);if(AudioNative.Process32First(snapshot,ref entry))do{result[entry.pid]=entry.parent;}while(AudioNative.Process32Next(snapshot,ref entry));}finally{AudioNative.CloseHandle(snapshot);}return result;}
  static uint Root(uint pid,Dictionary<uint,uint> parents,Dictionary<uint,string> images){string path=GetImage(pid,images);for(int i=0;i<32;i++){uint p;if(!parents.TryGetValue(pid,out p)||p==pid||p==0)break;string other=GetImage(p,images);if(path==null||!String.Equals(path,other,StringComparison.OrdinalIgnoreCase))break;pid=p;}return pid;}
  static string GetImage(uint pid,Dictionary<uint,string> images){string image;if(!images.TryGetValue(pid,out image)){image=Image(pid);images[pid]=image;}return image;}
  static bool Own(uint pid,Dictionary<uint,uint> parents){for(int i=0;i<64;i++){if(pid==(uint)parent||pid==(uint)Process.GetCurrentProcess().Id)return true;uint p;if(!parents.TryGetValue(pid,out p)||p==pid)break;pid=p;}return false;}
  static HashSet<uint> Discover(){
    HashSet<uint> result=new HashSet<uint>();IDeviceEnumerator enumerator=null;IDeviceCollection devices=null;
    try{enumerator=(IDeviceEnumerator)new DeviceEnumeratorClass();AudioNative.Check(enumerator.EnumAudioEndpoints(0,1,out devices));uint count;AudioNative.Check(devices.GetCount(out count));
      for(uint d=0;d<count;d++){IDevice device=null;object managerObject=null;ISessionEnumerator sessions=null;
        try{AudioNative.Check(devices.Item(d,out device));Guid iid=typeof(ISessionManager).GUID;AudioNative.Check(device.Activate(ref iid,23,IntPtr.Zero,out managerObject));ISessionManager manager=(ISessionManager)managerObject;AudioNative.Check(manager.GetSessionEnumerator(out sessions));int n;AudioNative.Check(sessions.GetCount(out n));
          for(int i=0;i<n;i++){object session=null;try{if(sessions.GetSession(i,out session)<0)continue;ISessionControl control=(ISessionControl)session;uint pid;int state;if(control.GetProcessId(out pid)>=0&&pid!=0&&control.GetState(out state)>=0&&state!=2)result.Add(pid);}finally{AudioNative.Release(session);}}
        }catch(Exception e){Send(new{type="discovery-error",error=e.Message},null);}finally{AudioNative.Release(sessions);AudioNative.Release(managerObject);AudioNative.Release(device);}
      }
    }finally{AudioNative.Release(devices);AudioNative.Release(enumerator);}return result;
  }
  [MTAThread]static void Main(string[] args){
    Dictionary<uint,ProcessCapture> captures=new Dictionary<uint,ProcessCapture>();Dictionary<uint,long> retry=new Dictionary<uint,long>();Dictionary<string,string> names=new Dictionary<string,string>();
    try{parent=Int32.Parse(args[0]);if(args.Length>1){targets=new HashSet<uint>();foreach(string part in args[1].Split(','))targets.Add(UInt32.Parse(part));}
      Send(new{type="ready",rate=48000,channels=2,bits=16},null);
      while(ParentAlive()){
        Dictionary<uint,uint> parents=Parents();Dictionary<uint,string> images=new Dictionary<uint,string>();HashSet<uint> found=new HashSet<uint>();
        foreach(uint sessionPid in Discover()){uint pid=Root(sessionPid,parents,images);if(targets==null?Own(pid,parents):!targets.Contains(pid))continue;found.Add(pid);ProcessCapture existing;
          if(captures.TryGetValue(pid,out existing)){existing.Seen=AudioWorker.Monotonic;if(existing.Running)continue;existing.Dispose();captures.Remove(pid);retry[pid]=(long)AudioWorker.Monotonic+10000;}
          long due;if(retry.TryGetValue(pid,out due)&&AudioWorker.Monotonic<due)continue;
          string image=GetImage(pid,images);if(image==null)continue;string exe=Path.GetFileName(image),label;
          if(!names.TryGetValue(image,out label)){try{label=FileVersionInfo.GetVersionInfo(image).FileDescription;}catch{label=null;}if(String.IsNullOrWhiteSpace(label))label=Path.GetFileNameWithoutExtension(image);names[image]=label;}
          if(captures.Count>=24){Send(new{type="error",id=pid.ToString(),name=label,error="Too many audio applications"},null);continue;}
          // Start time distinguishes a reused PID from a previous app instance.
          try{string key=pid.ToString()+"-"+Process.GetProcessById((int)pid).StartTime.ToUniversalTime().Ticks.ToString();captures[pid]=new ProcessCapture(pid,key,label,exe);}catch(ArgumentException){/* process closed during discovery */}
        }
        List<uint> remove=new List<uint>();foreach(var item in captures)if(!parents.ContainsKey(item.Key))remove.Add(item.Key);
        foreach(uint pid in remove){captures[pid].Dispose();captures.Remove(pid);}Thread.Sleep(500);
      }
    }catch(Exception error){Send(new{type="fatal",error=error.Message},null);Environment.ExitCode=1;}
    finally{foreach(var capture in captures.Values)capture.Dispose();}
  }
}
