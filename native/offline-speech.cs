using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

// The official Vosk runtime and Russian model are shipped as application data.
// No COM registration, system speech package or administrator rights are used.
public static class LibertyOfflineSpeech {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibraryExW(string name, IntPtr file, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr library, string name);
    [DllImport("libdl.so.2")] static extern IntPtr dlopen(string name, int flags);
    [DllImport("libdl.so.2")] static extern IntPtr dlsym(IntPtr library, string name);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void SetLog(int level);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr NewModel(byte[] path);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr NewRecognizer(IntPtr model, float rate, byte[] grammar);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void SetWords(IntPtr recognizer, int enabled);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Accept(IntPtr recognizer, byte[] bytes, int length);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr ReadResult(IntPtr recognizer);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void FreeRecognizer(IntPtr recognizer);
    static readonly object gate = new object();
    static IntPtr library, model;
    static NewRecognizer newRecognizer;
    static SetWords setWords;
    static Accept accept;
    static ReadResult readResult, finalResult;
    static FreeRecognizer freeRecognizer;
    static readonly bool windows = Environment.OSVersion.Platform == PlatformID.Win32NT;
    const string grammar = "[\"пауза\",\"продолжить\",\"следующий трек\",\"предыдущий трек\",\"громче\",\"тише\",\"выключить звук\",\"включить звук\",\"[unk]\"]";
    public static bool Ready { get { return model != IntPtr.Zero; } }
    static byte[] Utf8(string text) { return Encoding.UTF8.GetBytes(text + "\0"); }
    static T Function<T>(string name) where T : class {
        var address = windows ? GetProcAddress(library, name) : dlsym(library, name);
        if (address == IntPtr.Zero) throw new InvalidOperationException("Не найдена функция встроенного распознавателя: " + name);
        return (T)(object)Marshal.GetDelegateForFunctionPointer(address, typeof(T));
    }
    public static void Initialize(string directory) {
        lock (gate) {
            if (Ready) return;
            string modelPath = Path.Combine(directory, "model");
            if (!File.Exists(Path.Combine(modelPath, "am", "final.mdl"))) throw new FileNotFoundException("Встроенная русская модель отсутствует. Переустановите полную сборку Liberty Wave.");
            string filename = Path.Combine(directory, windows ? "win-x64" : "linux-x64", windows ? "libvosk.dll" : "libvosk.so");
            if (!File.Exists(filename)) throw new FileNotFoundException("Библиотека встроенного распознавателя отсутствует. Переустановите полную сборку Liberty Wave.");
            // On Windows, dependencies are resolved from this exact directory
            // and system directories, never from an arbitrary working directory.
            library = windows ? LoadLibraryExW(filename, IntPtr.Zero, 0x1100) : dlopen(filename, 2);
            if (library == IntPtr.Zero) throw new InvalidOperationException("Не удалось загрузить встроенный распознаватель: " + (windows ? new Win32Exception(Marshal.GetLastWin32Error()).Message : filename));
            Function<SetLog>("vosk_set_log_level")(-1);
            newRecognizer = Function<NewRecognizer>("vosk_recognizer_new_grm");
            setWords = Function<SetWords>("vosk_recognizer_set_words");
            accept = Function<Accept>("vosk_recognizer_accept_waveform");
            readResult = Function<ReadResult>("vosk_recognizer_result");
            finalResult = Function<ReadResult>("vosk_recognizer_final_result");
            freeRecognizer = Function<FreeRecognizer>("vosk_recognizer_free");
            // Vosk's Windows build opens model files through narrow C paths.
            // Set this isolated helper's working directory with the Unicode
            // Windows API, then use only ASCII relative model paths. This also
            // supports Cyrillic Windows user names without system changes.
            Environment.CurrentDirectory = Path.GetFullPath(directory);
            model = Function<NewModel>("vosk_model_new")(Utf8("model"));
            if (!Ready) throw new InvalidOperationException("Не удалось открыть встроенную русскую модель. Переустановите полную сборку Liberty Wave.");
        }
    }
    [DataContract] sealed class Word { [DataMember(Name = "conf")] public double Confidence = 0; }
    [DataContract] sealed class NativeResult { [DataMember(Name = "text")] public string Text = ""; [DataMember(Name = "result")] public Word[] Words = null; }
    public sealed class Result { public string Text; public float Confidence; }
    static NativeResult Decode(IntPtr pointer) {
        if (pointer == IntPtr.Zero) throw new InvalidOperationException("Распознаватель не вернул результат.");
        int size = 0; while (size < 65536 && Marshal.ReadByte(pointer, size) != 0) size++;
        if (size == 65536) throw new InvalidOperationException("Слишком большой ответ распознавателя.");
        byte[] bytes = new byte[size]; Marshal.Copy(pointer, bytes, 0, size);
        using (var stream = new MemoryStream(bytes)) return (NativeResult)new DataContractJsonSerializer(typeof(NativeResult)).ReadObject(stream);
    }
    public static Result Recognize(byte[] wave) {
        if (!Ready) throw new InvalidOperationException("Русский распознаватель ещё не готов.");
        if (wave.Length < 44 || wave.Length > 1024 * 1024 || Encoding.ASCII.GetString(wave, 0, 4) != "RIFF" || Encoding.ASCII.GetString(wave, 8, 4) != "WAVE") throw new InvalidOperationException("Некорректный буфер микрофона.");
        int offset = 12, start = -1, length = 0; bool validFormat = false;
        while (offset + 8 <= wave.Length) {
            string chunk = Encoding.ASCII.GetString(wave, offset, 4); uint count = BitConverter.ToUInt32(wave, offset + 4); offset += 8;
            if (count > wave.Length - offset) throw new InvalidOperationException("Повреждённый буфер микрофона.");
            if (chunk == "fmt " && count >= 16) validFormat = BitConverter.ToUInt16(wave, offset) == 1 && BitConverter.ToUInt16(wave, offset + 2) == 1 && BitConverter.ToInt32(wave, offset + 4) == 16000 && BitConverter.ToUInt16(wave, offset + 14) == 16;
            if (chunk == "data") { start = offset; length = (int)count; }
            offset += (int)count + ((int)count & 1);
        }
        if (!validFormat || start < 0 || length % 2 != 0) throw new InvalidOperationException("Микрофон должен передавать PCM 16 кГц, 16 бит, моно.");
        IntPtr recognizer = newRecognizer(model, 16000, Utf8(grammar));
        if (recognizer == IntPtr.Zero) throw new InvalidOperationException("Не удалось подготовить русские голосовые команды.");
        try {
            setWords(recognizer, 1);
            var parts = new List<NativeResult>();
            for (int i = 0; i < length; i += 4000) {
                int count = Math.Min(4000, length - i); byte[] bytes = new byte[count]; Array.Copy(wave, start + i, bytes, 0, count);
                int result = accept(recognizer, bytes, count);
                if (result < 0) throw new InvalidOperationException("Не удалось обработать звук микрофона.");
                if (result == 1) parts.Add(Decode(readResult(recognizer)));
            }
            parts.Add(Decode(finalResult(recognizer)));
            var texts = new List<string>(); double confidence = 0; int words = 0;
            foreach (var part in parts) {
                if (!String.IsNullOrWhiteSpace(part.Text)) texts.Add(part.Text.Trim());
                if (part.Words != null) foreach (var word in part.Words) { confidence += word.Confidence; words++; }
            }
            return new Result { Text = String.Join(" ", texts), Confidence = words == 0 ? 0 : (float)(confidence / words) };
        } finally { freeRecognizer(recognizer); }
    }
}
