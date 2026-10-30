param([switch]$InitializeOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

# Core Audio reads the output peak without recording audio or opening a microphone.
# Volume writes only touch sessions whose executable/AUMID exactly matches GSMTC.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
namespace LibertyAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevices {
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice {
    [PreserveSig] int Activate(ref Guid iid, int context, IntPtr activation, [MarshalAs(UnmanagedType.IUnknown)] out object result);
    [PreserveSig] int OpenPropertyStore(int mode, out IntPtr properties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }
  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMeter {
    [PreserveSig] int GetPeakValue(out float peak);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IManager {
    [PreserveSig] int GetAudioSessionControl(ref Guid session, uint flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(ref Guid session, uint flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out ISessions sessions);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ISessions {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IControl control);
  }
  [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IControl {
    [PreserveSig] int GetState(out int state);
  }
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
    [PreserveSig] int GetGroupingParam(out Guid grouping);
    [PreserveSig] int SetGroupingParam(ref Guid grouping, ref Guid context);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr notify);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notify);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint pid);
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IVolume {
    [PreserveSig] int SetMasterVolume(float volume, ref Guid context);
    [PreserveSig] int GetMasterVolume(out float volume);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  public sealed class Snapshot {
    public string target;
    public bool available;
    public object volume;
    public bool muted;
  }
  public static class Input {
    public static readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    public static volatile bool Closed;
    public static void Start() {
      var thread = new Thread(() => {
        try { using (var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false), true)) {
          string line; while ((line = reader.ReadLine()) != null) Lines.Enqueue(line);
        } } finally { Closed = true; }
      });
      thread.IsBackground = true; thread.Start();
    }
  }
  public sealed class Output : IDisposable {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr process, ref uint length, StringBuilder id);
    IDevices devices;
    IDevice device;
    IMeter meter;
    IManager manager;
    string deviceId, target = "";
    DateTime refreshed = DateTime.MinValue;
    readonly List<IControl> controls = new List<IControl>();
    readonly List<IVolume> volumes = new List<IVolume>();
    static void Check(int hr) { Marshal.ThrowExceptionForHR(hr); }
    static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    public static bool Matches(string target, string executable, string aumid) {
      if (String.IsNullOrWhiteSpace(target)) return false;
      if (!String.IsNullOrEmpty(aumid) && String.Equals(target, aumid, StringComparison.OrdinalIgnoreCase)) return true;
      // Packaged identities must match the AUMID, never a substring like "music".
      if (target.IndexOf('!') >= 0) return false;
      // Win32 Electron apps can publish an explicit shell ID which the package
      // identity API does not expose. Recognize only known IDs and exact exe names.
      if (String.Equals(target, "Yandex.Music", StringComparison.OrdinalIgnoreCase) ||
          String.Equals(target, "YandexMusic", StringComparison.OrdinalIgnoreCase) ||
          String.Equals(target, "ru.yandex.music", StringComparison.OrdinalIgnoreCase)) {
        return Array.Exists(new[] { "YandexMusic.exe", "Yandex Music.exe", "Yandex.Music.exe", "\u042f\u043d\u0434\u0435\u043a\u0441 \u041c\u0443\u0437\u044b\u043a\u0430.exe" },
          name => String.Equals(name, executable, StringComparison.OrdinalIgnoreCase));
      }
      return String.Equals(Path.GetFileName(target), executable, StringComparison.OrdinalIgnoreCase);
    }
    public void Target(string value) { if (target != value) { target = value ?? ""; refreshed = DateTime.MinValue; ClearSessions(); } }
    void ClearSessions() { volumes.Clear(); foreach (var control in controls) Release(control); controls.Clear(); }
    void ResetDevice() { ClearSessions(); Release(manager); Release(meter); Release(device); manager = null; meter = null; device = null; deviceId = null; }
    void Refresh() {
      if ((DateTime.UtcNow - refreshed).TotalMilliseconds < 1000) return;
      refreshed = DateTime.UtcNow;
      try {
        if (devices == null) devices = (IDevices)new Enumerator();
        IDevice next; Check(devices.GetDefaultAudioEndpoint(0, 1, out next));
        string id; Check(next.GetId(out id));
        if (deviceId != id) {
          ResetDevice(); device = next; deviceId = id;
          object obj; var iid = typeof(IMeter).GUID; Check(device.Activate(ref iid, 23, IntPtr.Zero, out obj)); meter = (IMeter)obj;
          iid = typeof(IManager).GUID; Check(device.Activate(ref iid, 23, IntPtr.Zero, out obj)); manager = (IManager)obj;
        } else Release(next);
        ClearSessions();
        if (String.IsNullOrEmpty(target)) return;
        ISessions sessions; Check(manager.GetSessionEnumerator(out sessions));
        try {
          int count; Check(sessions.GetCount(out count));
          for (int i = 0; i < count; i++) {
            IControl control = null;
            try {
              Check(sessions.GetSession(i, out control));
              int status; Check(control.GetState(out status)); if (status == 2) continue;
              uint pid; Check(((IControl2)control).GetProcessId(out pid)); if (pid == 0) continue;
              string exe = "", aumid = "";
              using (var process = Process.GetProcessById((int)pid)) {
                exe = process.ProcessName + ".exe";
                try { uint length = 0; GetApplicationUserModelId(process.Handle, ref length, null); if (length > 0 && length < 4096) {
                  var text = new StringBuilder((int)length); if (GetApplicationUserModelId(process.Handle, ref length, text) == 0) aumid = text.ToString();
                } } catch { }
              }
              if (!Matches(target, exe, aumid)) continue;
              volumes.Add((IVolume)control); controls.Add(control); control = null;
            } catch { } finally { Release(control); }
          }
        } finally { Release(sessions); }
      } catch { ResetDevice(); }
    }
    public bool Peak(out float value) {
      Refresh(); value = 0;
      if (meter == null) return false;
      if (meter.GetPeakValue(out value) < 0) { ResetDevice(); return false; }
      return true;
    }
    public Snapshot Read() {
      Refresh();
      var state = new Snapshot { target = target, available = false, volume = null, muted = false };
      foreach (var volume in volumes) {
        float value; bool muted;
        if (volume.GetMasterVolume(out value) < 0 || volume.GetMute(out muted) < 0) continue;
        // Multiple audio sessions of the same application are adjusted together.
        if (!state.available) { state.volume = (double)value; state.muted = muted; state.available = true; }
      }
      return state;
    }
    public void Volume(float value) {
      if (Single.IsNaN(value) || Single.IsInfinity(value) || value < 0 || value > 1) throw new ArgumentException("Invalid volume");
      if (!Read().available) throw new InvalidOperationException("Audio session is unavailable");
      var context = Guid.Empty;
      foreach (var volume in volumes) { Check(volume.SetMasterVolume(value, ref context)); if (value > 0) Check(volume.SetMute(false, ref context)); }
    }
    public void Mute(bool value) {
      if (!Read().available) throw new InvalidOperationException("Audio session is unavailable");
      var context = Guid.Empty; foreach (var volume in volumes) Check(volume.SetMute(value, ref context));
    }
    public void Dispose() { ResetDevice(); Release(devices); devices = null; }
  }
}
'@
if ($InitializeOnly) { return }
function Send-Message($message) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $message -Compress -Depth 4)); [Console]::Out.Flush() }
$output = [LibertyAudio.Output]::new()
$target = ''; $enabled = $false; $economy = $false; $lastState = [DateTime]::MinValue
[LibertyAudio.Input]::Start()
try {
    while ($true) {
        $line = ''
        if ([LibertyAudio.Input]::Lines.TryDequeue([ref]$line)) {
            $request = $null
            try {
                $request = ConvertFrom-Json -InputObject $line
                if ($request.command -eq 'configure') {
                    $target = [string]$request.value.target
                    $enabled = $request.value.enabled -eq $true; $economy = $request.value.economy -eq $true
                    $output.Target($target)
                } else {
                    if ([string]$request.sourceId -cne $target -or -not $target) { throw 'Audio source changed.' }
                    switch ($request.command) {
                        'volume' { $output.Volume([float]$request.value) }
                        'mute' { if ($request.value -isnot [bool]) { throw 'Invalid mute value.' }; $output.Mute([bool]$request.value) }
                        default { throw 'Unsupported audio command.' }
                    }
                }
                # Publish the acknowledged volume before resolving its Node request.
                Send-Message @{ type = 'state'; state = $output.Read() }
                Send-Message @{ type = 'result'; id = $request.id; ok = $true }
            } catch { Send-Message @{ type = 'result'; id = $request.id; ok = $false; error = $_.Exception.Message } }
            $lastState = [DateTime]::MinValue
        }
        if ([LibertyAudio.Input]::Closed -and [LibertyAudio.Input]::Lines.IsEmpty) { break }
        if ($enabled) {
            $peak = [float]0; $available = $output.Peak([ref]$peak)
            Send-Message @{ type = 'level'; available = $available; level = [double]$peak }
        }
        if (([DateTime]::UtcNow - $lastState).TotalMilliseconds -ge 400) {
            Send-Message @{ type = 'state'; state = $output.Read() }; $lastState = [DateTime]::UtcNow
        }
        $delay = if (-not $enabled) { 80 } elseif ($economy) { 83 } else { 33 }
        Start-Sleep -Milliseconds $delay
    }
} finally { $output.Dispose() }
