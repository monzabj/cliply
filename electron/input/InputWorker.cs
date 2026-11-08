// Windows Raw Input reads physical keys and relative mouse motion without
// injecting code into a game. Only state / button codes are serialized.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Collections.Concurrent;
using System.Windows.Forms;

class InputWorker : Form {
  [StructLayout(LayoutKind.Sequential)] struct Device { public ushort page, usage; public uint flags; public IntPtr target; }
  [StructLayout(LayoutKind.Sequential)] struct Header { public uint type, size; public IntPtr device, param; }
  [StructLayout(LayoutKind.Sequential)] struct Gamepad { public ushort buttons; public byte lt, rt; public short lx, ly, rx, ry; }
  [StructLayout(LayoutKind.Sequential)] struct PadState { public uint packet; public Gamepad pad; }
  [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterRawInputDevices(Device[] devices, uint n, uint size);
  [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size, uint header);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll", EntryPoint="GetRawInputDeviceInfoW")] static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, IntPtr data, ref uint size);
  [DllImport("xinput1_4.dll")] static extern uint XInputGetState(uint index, out PadState state);
  readonly SortedSet<int> keys = new SortedSet<int>();
  readonly SortedSet<int> buttons = new SortedSet<int>();
  readonly ConcurrentQueue<string> queue = new ConcurrentQueue<string>();
  readonly Stopwatch clock = Stopwatch.StartNew();
  readonly long epoch = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
  readonly int parent;
  long lastEmit, lastParentCheck;
  int dx, dy, wheel;
  string pads = "[]", last = "";
  readonly Dictionary<IntPtr,bool> dualSenseDevices = new Dictionary<IntPtr,bool>();
  readonly Dictionary<IntPtr,int> dualSenseIds = new Dictionary<IntPtr,int>();
  readonly SortedDictionary<int,DualSenseInput> dualSensePads = new SortedDictionary<int,DualSenseInput>();
  int nextDualSenseId = 16;
  readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
  InputWorker(int parentId) {
    parent = parentId;
    ShowInTaskbar = false; FormBorderStyle = FormBorderStyle.None;
    for (int key = 8; key < 255; key++) if (key != 16 && key != 17 && key != 18 && (GetAsyncKeyState(key) & 0x8000) != 0) keys.Add(key);
    for (int i=0; i<5; i++) if ((GetAsyncKeyState(new int[]{1,2,4,5,6}[i]) & 0x8000) != 0) buttons.Add(i);
    IntPtr target = Handle;
    Device[] devices = {new Device {page=1,usage=6,flags=0x100,target=target}, new Device {page=1,usage=2,flags=0x100,target=target}};
    if (!RegisterRawInputDevices(devices, (uint)devices.Length, (uint)Marshal.SizeOf(typeof(Device)))) throw new Exception("Raw Input: " + Marshal.GetLastWin32Error());
    // Failure to subscribe to gamepads must not disable keyboard/mouse capture.
    Device[] controllers = {new Device {page=1,usage=5,flags=0x2100,target=target},new Device {page=1,usage=4,flags=0x2100,target=target}};
    RegisterRawInputDevices(controllers, (uint)controllers.Length, (uint)Marshal.SizeOf(typeof(Device)));
    Thread writer = new Thread(delegate() {
      try { while (true) { string line; while(queue.TryDequeue(out line)) Console.WriteLine(line); Thread.Sleep(2); } }
      catch { Environment.Exit(0); }
    }); writer.IsBackground=true; writer.Start();
    Console.WriteLine("{\"ready\":true}");
    timer.Interval=8; timer.Tick += delegate {
      if (clock.ElapsedMilliseconds - lastParentCheck >= 1000) {
        lastParentCheck = clock.ElapsedMilliseconds;
        try { if (Process.GetProcessById(parent).HasExited) Environment.Exit(0); } catch { Environment.Exit(0); }
      }
      PollPads(); Emit(false);
    }; timer.Start(); Emit(true);
  }
  protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
  static string Axis(short value, int deadzone) {
    if (Math.Abs((int)value) < deadzone) return "0";
    return (Math.Round(Math.Max(-1, value / 32767.0) * 50) / 50).ToString(CultureInfo.InvariantCulture);
  }
  void PollPads() {
    StringBuilder s = new StringBuilder("[");
    for(uint i=0;i<4;i++) {
      PadState state;
      if (XInputGetState(i,out state) != 0) continue;
      if(s.Length>1)s.Append(','); Gamepad p=state.pad;
      s.Append("{\"id\":").Append(i).Append(",\"buttons\":").Append(p.buttons)
        .Append(",\"lt\":").Append(p.lt < 30 ? 0 : p.lt).Append(",\"rt\":").Append(p.rt < 30 ? 0 : p.rt)
        .Append(",\"lx\":").Append(Axis(p.lx,7849)).Append(",\"ly\":").Append(Axis(p.ly,7849))
        .Append(",\"rx\":").Append(Axis(p.rx,8689)).Append(",\"ry\":").Append(Axis(p.ry,8689)).Append('}');
    }
    foreach (KeyValuePair<int,DualSenseInput> p in dualSensePads) { if(s.Length>1)s.Append(',');s.Append(p.Value.Json(p.Key)); }
    pads=s.Append(']').ToString();
  }
  bool IsDualSense(IntPtr device) {
    bool known;
    if (dualSenseDevices.TryGetValue(device,out known)) return known;
    uint size=32;IntPtr info=Marshal.AllocHGlobal((int)size);
    try {
      Marshal.WriteInt32(info,(int)size);
      if(GetRawInputDeviceInfo(device,0x2000000b,info,ref size)!=UInt32.MaxValue) {
        int vendor=Marshal.ReadInt32(info,8),product=Marshal.ReadInt32(info,12);
        known=vendor==0x054c && (product==0x0ce6 || product==0x0df2);
      }
    } finally {Marshal.FreeHGlobal(info);}
    dualSenseDevices[device]=known;return known;
  }
  void ReadHid(IntPtr data, IntPtr body, uint size, uint headerSize) {
    IntPtr device=Marshal.ReadIntPtr(data,8);
    if(!IsDualSense(device) || size<headerSize+8)return;
    int reportSize=Marshal.ReadInt32(body),count=Marshal.ReadInt32(body,4);
    if(reportSize<10 || reportSize>512 || count<1 || (long)reportSize*count>size-headerSize-8)return;
    int id;if(!dualSenseIds.TryGetValue(device,out id)){id=nextDualSenseId++;dualSenseIds[device]=id;}
    byte[] report=new byte[reportSize];
    for(int i=0;i<count;i++) {
      Marshal.Copy(IntPtr.Add(body,8+i*reportSize),report,0,reportSize);
      DualSenseInput state=DualSenseInput.Parse(report);
      if(state!=null){dualSensePads[id]=state;PollPads();Emit(false);}
    }
  }
  void Emit(bool force) {
    string state="{\"keys\":["+String.Join(",",keys)+"],\"mouse\":{\"buttons\":["+String.Join(",",buttons)+"],\"dx\":"+dx+",\"dy\":"+dy+",\"wheel\":"+wheel+"},\"pads\":"+pads+"}";
    long now=clock.ElapsedMilliseconds;
    if(force || state!=last || now-lastEmit>=1000) {
      queue.Enqueue("{\"t\":"+(epoch+now)+",\"state\":"+state+"}"); last=state; lastEmit=now;
    }
    dx=dy=wheel=0;
  }
  void SetButton(int index, bool down) { if(down)buttons.Add(index);else buttons.Remove(index); }
  protected override void WndProc(ref Message msg) {
    if(msg.Msg==0xFE && msg.WParam.ToInt64()==2) {
      int id;if(dualSenseIds.TryGetValue(msg.LParam,out id)){dualSensePads.Remove(id);dualSenseIds.Remove(msg.LParam);PollPads();Emit(false);}
      dualSenseDevices.Remove(msg.LParam);
    }
    if(msg.Msg==0xFF) {
      uint size=0, hs=(uint)Marshal.SizeOf(typeof(Header));
      GetRawInputData(msg.LParam,0x10000003,IntPtr.Zero,ref size,hs);
      IntPtr data=Marshal.AllocHGlobal((int)size);
      try {
        if(GetRawInputData(msg.LParam,0x10000003,data,ref size,hs)==size) {
          int type=Marshal.ReadInt32(data); IntPtr body=IntPtr.Add(data,(int)hs);
          if(type==1) {
            int flags=(ushort)Marshal.ReadInt16(body,2), key=(ushort)Marshal.ReadInt16(body,6);
            if(key==16) key=(int)MapVirtualKey((uint)(ushort)Marshal.ReadInt16(body),3);
            if(key==17) key=(flags&2)!=0?163:162;
            if(key==18) key=(flags&2)!=0?165:164;
            if(key==13 && (flags&2)!=0) key=269;
            if(key!=255) { if((flags&1)==0)keys.Add(key);else keys.Remove(key); Emit(false); }
          } else if(type==0) {
            int flags=(ushort)Marshal.ReadInt16(body,4);
            for(int i=0;i<5;i++) { if((flags&(1<<(i*2)))!=0)SetButton(i,true); if((flags&(2<<(i*2)))!=0)SetButton(i,false); }
            if((flags&0x400)!=0)wheel+=(short)Marshal.ReadInt16(body,6);
            if((Marshal.ReadInt16(body)&1)==0) { dx+=Marshal.ReadInt32(body,12);dy+=Marshal.ReadInt32(body,16); }
            if(flags!=0)Emit(false);
          } else if(type==2) ReadHid(data,body,size,hs);
        }
      } finally {Marshal.FreeHGlobal(data);}
    }
    base.WndProc(ref msg);
  }
  [STAThread] static void Main(string[] args) {
    try { Application.Run(new InputWorker(Int32.Parse(args[0]))); }
    catch(Exception e) { Console.Error.WriteLine(e.Message); Environment.Exit(1); }
  }
}
