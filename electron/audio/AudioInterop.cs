using System;
using System.Runtime.InteropServices;

internal static class AudioNative {
  [DllImport("Mmdevapi.dll", CharSet=CharSet.Unicode, PreserveSig=true)]
  internal static extern int ActivateAudioInterfaceAsync(string device, ref Guid iid, IntPtr parameters, IActivateCompletion callback, out IActivateOperation operation);
  [DllImport("kernel32.dll")] internal static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] internal static extern bool QueryFullProcessImageName(IntPtr process,uint flags,System.Text.StringBuilder name,ref uint size);
  [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] internal static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] internal static extern bool Process32First(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] internal static extern bool Process32Next(IntPtr snapshot,ref ProcessEntry entry);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] internal struct ProcessEntry {
    internal uint size,usage,pid;internal UIntPtr heap;internal uint module,threads,parent;internal int priority;internal uint flags;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]internal string exe;
  }
  [StructLayout(LayoutKind.Sequential,Pack=2)] internal struct WaveFormat {
    internal ushort tag,channels;internal uint rate,bytesPerSecond;internal ushort blockAlign,bits,extra;
  }
  internal static void Check(int hr){if(hr<0)Marshal.ThrowExceptionForHR(hr);}
  internal static void Release(object value){if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
}
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]internal class DeviceEnumeratorClass{}
[ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface IDeviceEnumerator {
  [PreserveSig]int EnumAudioEndpoints(int flow,uint state,out IDeviceCollection devices);
  [PreserveSig]int GetDefaultAudioEndpoint(int flow,int role,out IDevice device);
  [PreserveSig]int GetDevice([MarshalAs(UnmanagedType.LPWStr)]string id,out IDevice device);
  [PreserveSig]int RegisterEndpointNotificationCallback(IntPtr callback);
  [PreserveSig]int UnregisterEndpointNotificationCallback(IntPtr callback);
}
[ComImport,Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface IDeviceCollection {
  [PreserveSig]int GetCount(out uint count);[PreserveSig]int Item(uint index,out IDevice device);
}
[ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface IDevice {
  [PreserveSig]int Activate(ref Guid iid,uint context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)]out object result);
  [PreserveSig]int OpenPropertyStore(uint access,out IntPtr store);
  [PreserveSig]int GetId([MarshalAs(UnmanagedType.LPWStr)]out string id);[PreserveSig]int GetState(out uint state);
}
[ComImport,Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface ISessionManager {
  [PreserveSig]int GetAudioSessionControl(IntPtr guid,uint flags,out IntPtr control);
  [PreserveSig]int GetSimpleAudioVolume(IntPtr guid,uint flags,out IntPtr volume);
  [PreserveSig]int GetSessionEnumerator(out ISessionEnumerator sessions);
  [PreserveSig]int RegisterSessionNotification(IntPtr callback);[PreserveSig]int UnregisterSessionNotification(IntPtr callback);
}
[ComImport,Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface ISessionEnumerator {
  [PreserveSig]int GetCount(out int count);
  [PreserveSig]int GetSession(int index,[MarshalAs(UnmanagedType.IUnknown)]out object session);
}
[ComImport,Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface ISessionControl {
  [PreserveSig]int GetState(out int state);[PreserveSig]int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)]out string name);
  [PreserveSig]int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)]string name,IntPtr context);
  [PreserveSig]int GetIconPath([MarshalAs(UnmanagedType.LPWStr)]out string path);
  [PreserveSig]int SetIconPath([MarshalAs(UnmanagedType.LPWStr)]string path,IntPtr context);
  [PreserveSig]int GetGroupingParam(out Guid group);[PreserveSig]int SetGroupingParam(ref Guid group,IntPtr context);
  [PreserveSig]int RegisterAudioSessionNotification(IntPtr callback);[PreserveSig]int UnregisterAudioSessionNotification(IntPtr callback);
  [PreserveSig]int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)]out string id);
  [PreserveSig]int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)]out string id);
  [PreserveSig]int GetProcessId(out uint pid);[PreserveSig]int IsSystemSoundsSession();[PreserveSig]int SetDuckingPreference(bool optOut);
}
[ComImport,Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface IAudioClient {
  [PreserveSig]int Initialize(int mode,uint flags,long duration,long periodicity,ref AudioNative.WaveFormat format,IntPtr session);
  [PreserveSig]int GetBufferSize(out uint frames);[PreserveSig]int GetStreamLatency(out long latency);[PreserveSig]int GetCurrentPadding(out uint frames);
  [PreserveSig]int IsFormatSupported(int mode,IntPtr format,out IntPtr closest);[PreserveSig]int GetMixFormat(out IntPtr format);
  [PreserveSig]int GetDevicePeriod(out long normal,out long minimum);[PreserveSig]int Start();[PreserveSig]int Stop();[PreserveSig]int Reset();
  [PreserveSig]int SetEventHandle(IntPtr handle);[PreserveSig]int GetService(ref Guid iid,[MarshalAs(UnmanagedType.IUnknown)]out object service);
}
[ComImport,Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]internal interface ICaptureClient {
  [PreserveSig]int GetBuffer(out IntPtr data,out uint frames,out uint flags,out ulong position,out ulong qpc);
  [PreserveSig]int ReleaseBuffer(uint frames);[PreserveSig]int GetNextPacketSize(out uint frames);
}
[ComVisible(true),Guid("41D949AB-9862-484A-80F6-C261334DA5EB"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]public interface IActivateCompletion {
  [PreserveSig]int ActivateCompleted(IActivateOperation operation);
}
[ComImport,Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]public interface IActivateOperation {
  [PreserveSig]int GetActivateResult(out int result,[MarshalAs(UnmanagedType.IUnknown)]out object activated);
}
[ComVisible(true),Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]public interface IAgileObject {}
