param([switch]$InitializeOnly)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech
$references = @('System.dll', 'System.Core.dll', [System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location)
if ($PSVersionTable.PSEdition -eq 'Core') { $references = @((Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll').FullName) + @([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location) }
Add-Type -ReferencedAssemblies $references -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Speech.Recognition;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
public sealed class LibertyAutomation : IDisposable {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    public string Foreground = "", Error = "", Language = "";
    public bool Listening = false;
    public long Session = 0;
    public readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>();
    public readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();
    public volatile bool InputClosed;
    readonly ConcurrentQueue<KeyValuePair<long, string>> phrases = new ConcurrentQueue<KeyValuePair<long, string>>();
    SpeechRecognitionEngine engine;
    bool monitor, voice, armed = false, consumed = false;
    int[] keys = new int[0];
    DateTime started;
    DateTime lastForeground = DateTime.MinValue;
    public void StartInput() {
        // Console.In.ReadLineAsync can block synchronously in Windows PowerShell.
        // A dedicated pipe reader keeps key release and microphone cleanup live.
        var thread = new Thread(() => {
            try { using (var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false), true)) {
                string line; while ((line = reader.ReadLine()) != null) Lines.Enqueue(line);
            } } finally { InputClosed = true; }
        });
        thread.IsBackground = true; thread.Start();
    }
    public void Configure(bool monitorEnabled, bool voiceEnabled, int[] chord) {
        Stop(); monitor = monitorEnabled; voice = voiceEnabled; keys = chord;
        armed = false; Error = ""; Language = "";
    }
    bool Down() {
        if (keys.Length == 0) return false;
        foreach (int key in keys) {
            if (key == 91) { if ((GetAsyncKeyState(91) & 0x8000) == 0 && (GetAsyncKeyState(92) & 0x8000) == 0) return false; }
            else if ((GetAsyncKeyState(key) & 0x8000) == 0) return false;
        }
        return true;
    }
    public void Tick() {
        if (monitor && (DateTime.UtcNow - lastForeground).TotalMilliseconds >= 250) {
            lastForeground = DateTime.UtcNow;
            try { uint id; GetWindowThreadProcessId(GetForegroundWindow(), out id); using (var process = Process.GetProcessById((int)id)) Foreground = process.ProcessName + ".exe"; }
            catch { Foreground = ""; }
        } else if (!monitor) Foreground = "";
        bool down = voice && Down();
        if (!down) { Stop(); armed = true; return; }
        if (armed) { armed = false; Begin(); }
        if (Listening && (DateTime.UtcNow - started).TotalSeconds >= 15) { Stop(); Error = "Лимит 15 секунд. Отпустите клавишу и попробуйте снова."; }
        KeyValuePair<long, string> phrase;
        while (phrases.TryDequeue(out phrase)) {
            if (!Listening || consumed || phrase.Key != Session) continue;
            string command = Command(phrase.Value);
            if (command != "") { consumed = true; Commands.Enqueue(command); }
        }
    }
    void Begin() {
        try {
            RecognizerInfo selected = null;
            foreach (var info in SpeechRecognitionEngine.InstalledRecognizers()) {
                if (info.Culture.TwoLetterISOLanguageName == "ru") { selected = info; break; }
                if (selected == null && info.Culture.TwoLetterISOLanguageName == "en") selected = info;
            }
            if (selected == null) throw new Exception("Установите локальный речевой пакет Windows: русский или английский.");
            engine = new SpeechRecognitionEngine(selected);
            Language = selected.Culture.Name;
            string[] words = selected.Culture.TwoLetterISOLanguageName == "ru"
                ? new [] { "пауза", "продолжить", "следующий трек", "предыдущий трек", "громче", "тише", "выключить звук", "включить звук" }
                : new [] { "pause", "resume", "next track", "previous track", "volume up", "volume down", "mute", "unmute" };
            var builder = new GrammarBuilder(new Choices(words)); builder.Culture = selected.Culture;
            engine.LoadGrammar(new Grammar(builder));
            // Recognizer callbacks run on worker threads. They only enqueue text;
            // the polling thread checks the held key again before emitting it.
            long session = ++Session;
            engine.SpeechRecognized += (sender, args) => { if (args.Result.Confidence >= 0.65f) phrases.Enqueue(new KeyValuePair<long, string>(session, args.Result.Text)); };
            if (!Down()) { Stop(); return; }
            engine.SetInputToDefaultAudioDevice();
            if (!Down()) { Stop(); return; }
            consumed = false; started = DateTime.UtcNow; Error = ""; Listening = true;
            engine.RecognizeAsync(RecognizeMode.Multiple);
        } catch (Exception error) { Stop(); Error = error.Message; }
    }
    static string Command(string text) {
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
    void Stop() {
        Listening = false;
        if (engine != null) {
            try { engine.RecognizeAsyncCancel(); } catch (InvalidOperationException) { }
            finally { engine.Dispose(); engine = null; }
        }
        KeyValuePair<long, string> phrase; while (phrases.TryDequeue(out phrase)) {}
        string ignored; while (Commands.TryDequeue(out ignored)) {}
    }
    public void Dispose() { Stop(); }
}
'@
if ($InitializeOnly) { Write-Output 'PASS: foreground/held-key API and offline speech helper compiled without opening the microphone.'; exit 0 }
$helper = New-Object LibertyAutomation
$previous = ''
$helper.StartInput()
$delay = 200
try {
    while (-not $helper.InputClosed) {
        $line = ''
        while ($helper.Lines.TryDequeue([ref]$line)) {
            $request = $null
            try {
                $request = $line | ConvertFrom-Json
                if ($request.command -ne 'configure') { throw 'Unknown automation command' }
                $value = $request.value
                $helper.Configure(($value.monitor -eq $true), ($value.voice -eq $true), [int[]]@($value.keys))
                $delay = if ($value.voice -eq $true) { 30 } else { 200 }
                @{ type = 'result'; id = $request.id; ok = $true } | ConvertTo-Json -Compress
            } catch { @{ type = 'result'; id = $request.id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }
        }
        $helper.Tick()
        $state = @{ foreground = $helper.Foreground; listening = $helper.Listening; session = $helper.Session; language = $helper.Language; error = $helper.Error; command = '' }
        $key = $state | ConvertTo-Json -Compress
        if ($key -ne $previous) { @{ type = 'state'; state = $state } | ConvertTo-Json -Depth 4 -Compress; $previous = $key }
        $command = ''
        while ($helper.Commands.TryDequeue([ref]$command)) {
            $state.command = $command
            @{ type = 'state'; state = $state } | ConvertTo-Json -Depth 4 -Compress
        }
        Start-Sleep -Milliseconds $delay
    }
} finally { $helper.Dispose() }
