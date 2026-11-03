using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Collections.Concurrent;
using System.IO;
using System.Text;
using System.Threading;

// Poll completed WinMM buffers on the controller thread. No managed code runs
// in a driver callback, and no microphone remains open during recognition.
public sealed class LibertyMicrophone : IDisposable {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Caps { public ushort mid, pid; public uint version; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string name; public uint formats; public ushort channels, reserved; }
    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct Format { public ushort tag, channels; public uint rate, bytes; public ushort align, bits, extra; }
    [StructLayout(LayoutKind.Sequential)]
    struct Header { public IntPtr data; public uint length, recorded; public UIntPtr user; public uint flags, loops; public IntPtr next; public UIntPtr reserved; }
    [DllImport("winmm.dll")] static extern uint waveInGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern uint waveInGetDevCapsW(UIntPtr id, out Caps caps, uint size);
    [DllImport("winmm.dll")] static extern uint waveInOpen(out IntPtr handle, uint device, ref Format format, IntPtr callback, IntPtr instance, uint flags);
    [DllImport("winmm.dll")] static extern uint waveInPrepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] static extern uint waveInUnprepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] static extern uint waveInAddBuffer(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] static extern uint waveInStart(IntPtr handle);
    [DllImport("winmm.dll")] static extern uint waveInStop(IntPtr handle);
    [DllImport("winmm.dll")] static extern uint waveInReset(IntPtr handle);
    [DllImport("winmm.dll")] static extern uint waveInClose(IntPtr handle);
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern uint waveInGetErrorTextW(uint code, StringBuilder text, uint length);
    readonly IntPtr[] headers = new IntPtr[4], data = new IntPtr[4];
    readonly bool[] prepared = new bool[4];
    readonly MemoryStream audio = new MemoryStream();
    readonly uint headerSize = (uint)Marshal.SizeOf(typeof(Header));
    IntPtr handle;
    public double Level, Peak;
    public static string[] Devices() {
        string[] names = new string[waveInGetNumDevs()];
        for (uint i = 0; i < names.Length; i++) { Caps caps; Check(waveInGetDevCapsW(new UIntPtr(i), out caps, (uint)Marshal.SizeOf(typeof(Caps)))); names[i] = caps.name; }
        return names;
    }
    static void Check(uint result) {
        if (result == 0) return;
        var text = new StringBuilder(256); waveInGetErrorTextW(result, text, 256);
        throw new InvalidOperationException("Микрофон: " + text + " (" + result + ")");
    }
    public static uint Validate(string selected) {
        uint device = UInt32.MaxValue;
        if (selected != "default" && (!UInt32.TryParse(selected, out device) || device >= waveInGetNumDevs())) throw new InvalidOperationException("Выбранный микрофон отключён. Обновите список и выберите устройство.");
        if (waveInGetNumDevs() == 0) throw new InvalidOperationException("Микрофон не найден. Подключите устройство и разрешите доступ к микрофону для классических приложений Windows.");
        return device;
    }
    public LibertyMicrophone(string selected) {
        uint device = Validate(selected);
        var format = new Format { tag = 1, channels = 1, rate = 16000, bytes = 32000, align = 2, bits = 16 };
        try {
            Check(waveInOpen(out handle, device, ref format, IntPtr.Zero, IntPtr.Zero, 0));
            for (int i = 0; i < headers.Length; i++) {
                data[i] = Marshal.AllocHGlobal(2048); headers[i] = Marshal.AllocHGlobal((int)headerSize);
                Marshal.StructureToPtr(new Header { data = data[i], length = 2048 }, headers[i], false);
                Check(waveInPrepareHeader(handle, headers[i], headerSize)); prepared[i] = true;
                Check(waveInAddBuffer(handle, headers[i], headerSize));
            }
            Check(waveInStart(handle));
        } catch { Dispose(); throw; }
    }
    public void Pump(bool requeue) {
        double level = 0;
        for (int i = 0; i < headers.Length; i++) {
            if (headers[i] == IntPtr.Zero) continue;
            Header header = (Header)Marshal.PtrToStructure(headers[i], typeof(Header));
            if ((header.flags & 1) == 0) continue; // WHDR_DONE
            if (header.recorded > 0) {
                byte[] bytes = new byte[header.recorded]; Marshal.Copy(header.data, bytes, 0, bytes.Length);
                audio.Write(bytes, 0, bytes.Length);
                for (int j = 0; j + 1 < bytes.Length; j += 2) level = Math.Max(level, Math.Abs((double)BitConverter.ToInt16(bytes, j)) / 32768);
                header.recorded = 0; Marshal.StructureToPtr(header, headers[i], false);
            }
            if (requeue) Check(waveInAddBuffer(handle, headers[i], headerSize));
        }
        Level = Math.Max(level, Level * .75); Peak = Math.Max(Peak, level);
    }
    public MemoryStream Finish() {
        Check(waveInStop(handle)); Check(waveInReset(handle)); Pump(false); Close();
        var wave = new MemoryStream(); var writer = new BinaryWriter(wave, Encoding.ASCII, true);
        writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write((int)audio.Length + 36); writer.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
        writer.Write(16); writer.Write((ushort)1); writer.Write((ushort)1); writer.Write(16000); writer.Write(32000); writer.Write((ushort)2); writer.Write((ushort)16);
        writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write((int)audio.Length); writer.Write(audio.ToArray()); writer.Flush(); writer.Dispose(); wave.Position = 0;
        return wave;
    }
    void Close() {
        if (handle != IntPtr.Zero) waveInReset(handle);
        for (int i = 0; i < headers.Length; i++) {
            if (prepared[i]) { waveInUnprepareHeader(handle, headers[i], headerSize); prepared[i] = false; }
            if (headers[i] != IntPtr.Zero) { Marshal.FreeHGlobal(headers[i]); headers[i] = IntPtr.Zero; }
            if (data[i] != IntPtr.Zero) { Marshal.FreeHGlobal(data[i]); data[i] = IntPtr.Zero; }
        }
        if (handle != IntPtr.Zero) { waveInClose(handle); handle = IntPtr.Zero; }
    }
    public void Dispose() { Close(); audio.Dispose(); }
}

public sealed class LibertyAutomation : IDisposable {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    public string Foreground = "", Error = "", Language = "", Phase = "idle", Heard = "";
    public bool Listening, TestMode, SpeechAvailable;
    public double Level, Peak;
    public long Session;
    public string[] Microphones = new string[0];
    public readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>(), Lines = new ConcurrentQueue<string>();
    public volatile bool InputClosed;
    sealed class Result { public long session; public string text, error; public float confidence; }
    readonly ConcurrentQueue<Result> results = new ConcurrentQueue<Result>();
    readonly string voiceDirectory;
    LibertyMicrophone capture;
    bool monitor, voice, armed;
    int[] keys = new int[0];
    string device = "default";
    DateTime started, processing, lastForeground = DateTime.MinValue;
    public void StartInput() {
        var thread = new Thread(() => {
            try { using (var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false), true)) {
                string line; while ((line = reader.ReadLine()) != null) Lines.Enqueue(line);
            } } catch (IOException) { } finally { InputClosed = true; }
        }); thread.IsBackground = true; thread.Start();
    }
    public LibertyAutomation(string directory) { voiceDirectory = directory; }
    public void Probe() {
        Error = ""; Language = "ru-RU";
        try { Microphones = LibertyMicrophone.Devices(); } catch (Exception error) { Error = error.Message; }
        try { LibertyOfflineSpeech.Initialize(voiceDirectory); SpeechAvailable = true; }
        catch (Exception error) { SpeechAvailable = false; Error = error.Message; }
    }
    public void Configure(bool monitorEnabled, bool voiceEnabled, int[] chord, string selected) {
        Cancel(); monitor = monitorEnabled; voice = voiceEnabled; keys = chord;
        device = String.IsNullOrEmpty(selected) ? "default" : selected; armed = false; Probe();
    }
    bool Down() {
        if (keys.Length == 0) return false;
        foreach (int key in keys) {
            if (key == 91) { if ((GetAsyncKeyState(91) & 0x8000) == 0 && (GetAsyncKeyState(92) & 0x8000) == 0) return false; }
            else if ((GetAsyncKeyState(key) & 0x8000) == 0) return false;
        } return true;
    }
    public void Test(bool enabled) { if (enabled) Begin(true); else if (TestMode && capture != null) Finish(); }
    public void Tick() {
        if (monitor && (DateTime.UtcNow - lastForeground).TotalMilliseconds >= 250) {
            lastForeground = DateTime.UtcNow;
            try { uint id; GetWindowThreadProcessId(GetForegroundWindow(), out id); using (var process = Process.GetProcessById((int)id)) Foreground = process.ProcessName + ".exe"; } catch { Foreground = ""; }
        } else if (!monitor) Foreground = "";
        bool down = voice && Down();
        if (!down) armed = true;
        if (capture != null) {
            try {
                capture.Pump(true); Level = capture.Level; Peak = capture.Peak;
                if ((!TestMode && !down) || (DateTime.UtcNow - started).TotalSeconds >= (TestMode ? 3 : 15)) Finish();
            } catch (Exception error) { Fail(error.Message); }
        } else if (down && armed && Phase != "processing") { armed = false; Begin(false); }
        Result result;
        while (results.TryDequeue(out result)) {
            if (result.session != Session || Phase != "processing") continue;
            Heard = result.text ?? ""; Phase = "recognized";
            if (!String.IsNullOrEmpty(result.error)) { Fail(result.error); continue; }
            if (String.IsNullOrEmpty(Heard) || result.confidence < 0.45f || Command(Heard) == "") { Error = "Команда не распознана. Произнесите команду целиком и отпустите клавишу."; continue; }
            Error = "";
            string command = Command(Heard);
            if (!TestMode && command != "") Commands.Enqueue(command);
        }
        if (Phase == "processing" && (DateTime.UtcNow - processing).TotalSeconds > 10) Fail("Распознавание не завершилось. Попробуйте снова.");
    }
    void Begin(bool test) {
        Cancel(); Probe(); TestMode = test; Heard = ""; Peak = Level = 0;
        try {
            if (!test && !SpeechAvailable) { Phase = "error"; return; }
            LibertyMicrophone.Validate(device);
            if (!test && !Down()) return;
            capture = new LibertyMicrophone(device); Session++; Listening = true; Phase = "listening"; started = DateTime.UtcNow;
        } catch (Exception error) { Fail(error.Message); }
    }
    void Finish() {
        try {
            byte[] bytes;
            using (var wave = capture.Finish()) bytes = wave.ToArray();
            Peak = capture.Peak; capture.Dispose(); capture = null; Listening = false; Level = 0;
            if (!SpeechAvailable) { Phase = "tested"; return; }
            long session = Session; Phase = "processing"; processing = DateTime.UtcNow;
            // Capture is closed before decoding the in-memory buffer. No audio
            // is written to disk, and results remain bound to the held session.
            ThreadPool.QueueUserWorkItem(ignored => {
                var result = new Result { session = session };
                try {
                    var decoded = LibertyOfflineSpeech.Recognize(bytes);
                    result.text = decoded.Text; result.confidence = decoded.Confidence;
                } catch (Exception error) { result.error = error.Message; }
                results.Enqueue(result);
            });
        } catch (Exception error) { Fail(error.Message); }
    }
    public static string Command(string text) {
        switch (text.ToLowerInvariant()) {
            case "пауза": case "pause": return "pause";
            case "продолжить": case "resume": return "resume";
            case "следующий трек": case "next track": return "next";
            case "предыдущий трек": case "previous track": return "previous";
            case "громче": case "volume up": return "volumeUp";
            case "тише": case "volume down": return "volumeDown";
            case "выключить звук": case "mute": return "mute";
            case "включить звук": case "unmute": return "unmute";
            default: return "";
        }
    }
    void Fail(string error) { Cancel(); Error = error; Phase = "error"; }
    void Cancel() {
        Listening = false; Phase = "idle"; TestMode = false;
        if (capture != null) { capture.Dispose(); capture = null; }
        Result result; while (results.TryDequeue(out result)) { }
        string ignored; while (Commands.TryDequeue(out ignored)) { }
    }
    public void Dispose() { Cancel(); }
}
