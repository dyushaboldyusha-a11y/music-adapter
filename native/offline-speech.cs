using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

// The official Vosk runtime and Russian/English models are shipped as application data.
// No COM registration, system speech package or administrator rights are used.
public static class LibertyOfflineSpeech {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibraryExW(string name, IntPtr file, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr library, string name);
    [DllImport("libdl.so.2")] static extern IntPtr dlopen(string name, int flags);
    [DllImport("libdl.so.2")] static extern IntPtr dlsym(IntPtr library, string name);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void SetLog(int level);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr NewModel(byte[] path);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr NewRecognizer(IntPtr model, float rate);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr NewCommandRecognizer(IntPtr model, float rate, byte[] grammar);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void SetWords(IntPtr recognizer, int enabled);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Accept(IntPtr recognizer, byte[] bytes, int length);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr ReadResult(IntPtr recognizer);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void FreeRecognizer(IntPtr recognizer);
    static readonly object gate = new object();
    static IntPtr library, model, englishModel;
    static NewRecognizer newRecognizer;
    static NewCommandRecognizer newCommandRecognizer;
    static byte[] russianGrammar, englishGrammar;
    static SetWords setWords;
    static Accept accept;
    static ReadResult readResult, finalResult;
    static FreeRecognizer freeRecognizer;
    static readonly bool windows = Environment.OSVersion.Platform == PlatformID.Win32NT;
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FindWord(IntPtr model, byte[] word);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void FreeModel(IntPtr model);
    public static bool Ready { get { return model != IntPtr.Zero && englishModel != IntPtr.Zero; } }
    public static string Resolve(string text) { return LibertyVoiceCatalog.Resolve(text); }
    static byte[] Utf8(string text) { return Encoding.UTF8.GetBytes(text + "\0"); }
    static T Function<T>(string name) where T : class {
        var address = windows ? GetProcAddress(library, name) : dlsym(library, name);
        if (address == IntPtr.Zero) throw new InvalidOperationException("Не найдена функция встроенного распознавателя: " + name);
        return (T)(object)Marshal.GetDelegateForFunctionPointer(address, typeof(T));
    }
    public static void Initialize(string directory) {
        lock (gate) {
            if (Ready) return;
            foreach (string folder in new [] { "model", "model-en" }) if (!File.Exists(Path.Combine(directory, folder, "am", "final.mdl"))) throw new FileNotFoundException("Встроенная языковая модель отсутствует. Переустановите полную сборку Liberty Wave.");
            LibertyVoiceCatalog.Load(Path.Combine(directory, "commands.json"));
            string filename = Path.Combine(directory, windows ? "win-x64" : "linux-x64", windows ? "libvosk.dll" : "libvosk.so");
            if (!File.Exists(filename)) throw new FileNotFoundException("Библиотека встроенного распознавателя отсутствует. Переустановите полную сборку Liberty Wave.");
            // On Windows, dependencies are resolved from this exact directory
            // and system directories, never from an arbitrary working directory.
            if (library == IntPtr.Zero) library = windows ? LoadLibraryExW(filename, IntPtr.Zero, 0x1100) : dlopen(filename, 2);
            if (library == IntPtr.Zero) throw new InvalidOperationException("Не удалось загрузить встроенный распознаватель: " + (windows ? new Win32Exception(Marshal.GetLastWin32Error()).Message : filename));
            Function<SetLog>("vosk_set_log_level")(-1);
            newRecognizer = Function<NewRecognizer>("vosk_recognizer_new");
            newCommandRecognizer = Function<NewCommandRecognizer>("vosk_recognizer_new_grm");
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
            IntPtr russian = IntPtr.Zero, english = IntPtr.Zero;
            try {
                var load = Function<NewModel>("vosk_model_new");
                russian = load(Utf8("model")); english = load(Utf8("model-en"));
                if (russian == IntPtr.Zero || english == IntPtr.Zero) throw new InvalidOperationException("Не удалось открыть встроенные языковые модели. Переустановите полную сборку Liberty Wave.");
                ValidateWords(russian, "ru"); ValidateWords(english, "en");
                russianGrammar = LibertyVoiceCatalog.Grammar("ru"); englishGrammar = LibertyVoiceCatalog.Grammar("en");
                model = russian; englishModel = english;
            } catch {
                var free = Function<FreeModel>("vosk_model_free");
                if (russian != IntPtr.Zero) free(russian); if (english != IntPtr.Zero) free(english);
                throw;
            }
        }
    }
    static void ValidateWords(IntPtr handle, string language) {
        var find = Function<FindWord>("vosk_model_find_word"); var seen = new HashSet<string>();
        foreach (string phrase in LibertyVoiceCatalog.Phrases(language)) foreach (string word in phrase.Split(' ')) {
            if (seen.Add(word) && find(handle, Utf8(word)) < 0) throw new InvalidOperationException("Слово отсутствует в акустической модели: " + word);
        }
    }
    [DataContract] sealed class Word { [DataMember(Name = "conf")] public double Confidence = 0; }
    [DataContract] sealed class NativeResult { [DataMember(Name = "text")] public string Text = ""; [DataMember(Name = "result")] public Word[] Words = null; }
    public sealed class Result { public string Text; public float Confidence; public string Diagnostics; }
    static NativeResult Decode(IntPtr pointer) {
        if (pointer == IntPtr.Zero) throw new InvalidOperationException("Распознаватель не вернул результат.");
        int size = 0; while (size < 65536 && Marshal.ReadByte(pointer, size) != 0) size++;
        if (size == 65536) throw new InvalidOperationException("Слишком большой ответ распознавателя.");
        byte[] bytes = new byte[size]; Marshal.Copy(pointer, bytes, 0, size);
        using (var stream = new MemoryStream(bytes)) return (NativeResult)new DataContractJsonSerializer(typeof(NativeResult)).ReadObject(stream);
    }
    public static Result Recognize(byte[] wave) {
        if (!Ready) throw new InvalidOperationException("Голосовые модели ещё не готовы.");
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
        Result russian = RecognizeModel(model, russianGrammar, wave, start, length);
        Result english = RecognizeModel(englishModel, englishGrammar, wave, start, length);
        string ru = Resolve(russian.Text), en = Resolve(english.Text);
        string diagnostics = "RU: " + russian.Text + " (" + russian.Confidence + "); EN: " + english.Text + " (" + english.Confidence + ")";
        russian.Diagnostics = english.Diagnostics = diagnostics;
        bool ruValid = ru != "" && russian.Confidence >= .45f, enValid = en != "" && english.Confidence >= .45f;
        Result openRu = null, openEn = null;
        if (ruValid || enValid) {
            openRu = RecognizeModel(model, null, wave, start, length);
            openEn = RecognizeModel(englishModel, null, wave, start, length);
            diagnostics += "; open RU: " + openRu.Text + "; open EN: " + openEn.Text;
            russian.Diagnostics = english.Diagnostics = diagnostics;
            // A constrained grammar must not discard "do not" / "не" and turn
            // an explicitly negated request into a transport command.
            if (LibertyVoiceCatalog.NegatesCommand(openRu.Text) || LibertyVoiceCatalog.NegatesCommand(openEn.Text)) return new Result { Text = "", Confidence = 0, Diagnostics = diagnostics };
        }
        // Do not collapse a longer unrelated utterance into a command
        // merely because the constrained recognizer assigned it high confidence.
        // This also limits false matches from the other language's acoustic model.
        if (ruValid && !Plausible(russian, openRu)) ruValid = false;
        if (enValid && !Plausible(english, openEn)) enValid = false;
        if (ruValid && enValid) {
            if (ru == en) return russian.Confidence >= english.Confidence ? russian : english;
            bool ruConfirmed = Resolve(openRu.Text) == ru && openRu.Confidence >= .45f;
            bool enConfirmed = Resolve(openEn.Text) == en && openEn.Confidence >= .45f;
            if (ruConfirmed != enConfirmed) return ruConfirmed ? russian : english;
            double ruScore = russian.Confidence + .3 * LibertyVoiceCatalog.Similarity(openRu.Text, russian.Text);
            double enScore = english.Confidence + .3 * LibertyVoiceCatalog.Similarity(openEn.Text, english.Text);
            if (Math.Abs(ruScore - enScore) >= .1) return ruScore >= enScore ? russian : english;
            return new Result { Text = "", Confidence = 0, Diagnostics = diagnostics };
        }
        if (ruValid) return russian;
        if (enValid) return english;
        return new Result { Text = "", Confidence = 0, Diagnostics = diagnostics };
    }
    static bool Plausible(Result constrained, Result unrestricted) {
        string phrase = " " + LibertyVoiceCatalog.Normalize(constrained.Text) + " ";
        string full = " " + LibertyVoiceCatalog.Normalize(unrestricted.Text) + " ";
        // Polite fillers are easy to hallucinate in foreign-language speech.
        // Require the full decoder to hear the filler or confirm the action.
        foreach (string polite in new [] { " please ", " пожалуйста " }) {
            if (phrase.Contains(polite) && !full.Contains(polite) && Resolve(unrestricted.Text) != Resolve(constrained.Text)) return false;
        }
        int heardWords = unrestricted.Text.Split(new [] { ' ' }, StringSplitOptions.RemoveEmptyEntries).Length;
        int commandWords = constrained.Text.Split(new [] { ' ' }, StringSplitOptions.RemoveEmptyEntries).Length;
        double similarity = LibertyVoiceCatalog.Similarity(constrained.Text, unrestricted.Text);
        // Require stronger evidence for a short command when the full decoder
        // hears a different phrase. In particular, foreign speech must not
        // become "back" simply because the small command grammar favors it.
        if (heardWords >= 3 && similarity < .4) return false;
        if (commandWords == 1 && heardWords >= 2 && constrained.Confidence < .9f && similarity < .4) return false;
        return true;
    }
    static Result RecognizeModel(IntPtr handle, byte[] grammar, byte[] wave, int start, int length) {
        IntPtr recognizer = grammar == null ? newRecognizer(handle, 16000) : newCommandRecognizer(handle, 16000, grammar);
        if (recognizer == IntPtr.Zero) throw new InvalidOperationException("Не удалось подготовить голосовые команды.");
        try {
            setWords(recognizer, 1);
            var parts = new List<NativeResult>();
            // A short word may begin immediately at key-down. Give the online
            // feature extractor context without keeping the microphone open.
            byte[] leading = new byte[6400]; accept(recognizer, leading, leading.Length);
            for (int i = 0; i < length; i += 4000) {
                int count = Math.Min(4000, length - i); byte[] bytes = new byte[count]; Array.Copy(wave, start + i, bytes, 0, count);
                int result = accept(recognizer, bytes, count);
                if (result < 0) throw new InvalidOperationException("Не удалось обработать звук микрофона.");
                if (result == 1) parts.Add(Decode(readResult(recognizer)));
            }
            byte[] trailing = new byte[16000];
            if (accept(recognizer, trailing, trailing.Length) == 1) parts.Add(Decode(readResult(recognizer)));
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
