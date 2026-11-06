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
    static byte[] russianGrammar, englishGrammar, russianWakeGrammar, englishWakeGrammar, russianVolumeGrammar, englishVolumeGrammar, russianWakeVolumeGrammar, englishWakeVolumeGrammar;
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
                russianWakeGrammar = LibertyVoiceCatalog.Grammar("ru", true); englishWakeGrammar = LibertyVoiceCatalog.Grammar("en", true);
                russianVolumeGrammar = LibertyVoiceVolume.Grammar("ru", false); englishVolumeGrammar = LibertyVoiceVolume.Grammar("en", false);
                russianWakeVolumeGrammar = LibertyVoiceVolume.Grammar("ru", true); englishWakeVolumeGrammar = LibertyVoiceVolume.Grammar("en", true);
                ValidateGrammar(russian, russianWakeGrammar); ValidateGrammar(english, englishWakeGrammar);
                ValidateGrammar(russian, russianVolumeGrammar); ValidateGrammar(english, englishVolumeGrammar);
                var find = Function<FindWord>("vosk_model_find_word");
                foreach (string wake in new [] { "вейв", "вэйв" }) if (find(russian, Utf8(wake)) < 0) throw new InvalidOperationException("В модели отсутствует обращение: " + wake);
                if (find(english, Utf8("wave")) < 0) throw new InvalidOperationException("В модели отсутствует обращение Wave.");
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
    static void ValidateGrammar(IntPtr handle, byte[] grammar) {
        string[] phrases;
        using (var stream = new MemoryStream(grammar, 0, grammar.Length - 1)) phrases = (string[])new DataContractJsonSerializer(typeof(string[])).ReadObject(stream);
        var find = Function<FindWord>("vosk_model_find_word"); var seen = new HashSet<string>();
        foreach (string phrase in phrases) foreach (string word in phrase.Split(' ')) if (word != "[unk]" && seen.Add(word) && find(handle, Utf8(word)) < 0) throw new InvalidOperationException("Слово отсутствует во встроенной модели: " + word);
    }
    [DataContract] sealed class Word {
        [DataMember(Name = "conf")] public double Confidence = 0;
        [DataMember(Name = "word")] public string Text = "";
    }
    [DataContract] sealed class NativeResult { [DataMember(Name = "text")] public string Text = ""; [DataMember(Name = "result")] public Word[] Words = null; }
    public sealed class Result { public string Text; public float Confidence; public string Diagnostics; public bool Activated; public float WakeConfidence, NumberConfidence; }
    static NativeResult Decode(IntPtr pointer) {
        if (pointer == IntPtr.Zero) throw new InvalidOperationException("Распознаватель не вернул результат.");
        int size = 0; while (size < 65536 && Marshal.ReadByte(pointer, size) != 0) size++;
        if (size == 65536) throw new InvalidOperationException("Слишком большой ответ распознавателя.");
        byte[] bytes = new byte[size]; Marshal.Copy(pointer, bytes, 0, size);
        using (var stream = new MemoryStream(bytes)) return (NativeResult)new DataContractJsonSerializer(typeof(NativeResult)).ReadObject(stream);
    }
    public static Result Recognize(byte[] wave, bool requireWake = false) {
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
        Result russian = RecognizeModel(model, requireWake ? russianWakeGrammar : russianGrammar, wave, start, length);
        Result english = RecognizeModel(englishModel, requireWake ? englishWakeGrammar : englishGrammar, wave, start, length);
        Result openRu = RecognizeModel(model, null, wave, start, length);
        Result openEn = RecognizeModel(englishModel, null, wave, start, length);
        string diagnostics = "RU: " + russian.Text + " (" + russian.Confidence + "); EN: " + english.Text + " (" + english.Confidence + "); open RU: " + openRu.Text + "; open EN: " + openEn.Text;
        russian.Diagnostics = english.Diagnostics = openRu.Diagnostics = openEn.Diagnostics = diagnostics;
        bool ruWake = ConfirmWake(russian, openRu), enWake = ConfirmWake(english, openEn);
        string originalRu = openRu.Text, originalEn = openEn.Text;
        if (requireWake) { if (ruWake) openRu.Text = CanonicalWake(openRu.Text, "вейв"); if (enWake) openEn.Text = CanonicalWake(openEn.Text, "wave"); }
        russian.Activated = ruWake; english.Activated = enWake; openRu.Activated = ruWake; openEn.Activated = enWake;
        string openRuAction = Resolve(openRu.Text), openEnAction = Resolve(openEn.Text);
        bool ruVolume = LibertyVoiceVolume.IsVolume(openRuAction) && openRu.Confidence >= .45f && (!requireWake || ruWake) && Allowed(openRu, openEn, openRuAction);
        bool enVolume = LibertyVoiceVolume.IsVolume(openEnAction) && openEn.Confidence >= .45f && (!requireWake || enWake) && Allowed(openEn, openRu, openEnAction);
        if (ruVolume || enVolume) {
            if (ruVolume && enVolume && openRuAction != openEnAction) return new Result { Text = "", Confidence = 0, Diagnostics = diagnostics };
            return ruVolume ? openRu : openEn;
        }
        // Confirmed legacy requests take precedence over a foreign-language
        // volume cue, while malformed numeric requests never fall back to them.
        string baseRu = Resolve(russian.Text), baseEn = Resolve(english.Text);
        bool confirmedRu = baseRu != "" && baseRu == openRuAction && russian.Confidence >= .45f && (!requireWake || ruWake && LibertyVoiceCatalog.HasWake(russian.Text)) && Allowed(openRu, openEn, baseRu);
        bool confirmedEn = baseEn != "" && baseEn == openEnAction && english.Confidence >= .45f && (!requireWake || enWake && LibertyVoiceCatalog.HasWake(english.Text)) && Allowed(openEn, openRu, baseEn);
        if (confirmedRu && confirmedEn && baseRu != baseEn) return new Result { Text = "", Confidence = 0, Diagnostics = diagnostics };
        if (confirmedRu) return russian;
        if (confirmedEn) return english;
        bool numeric = LibertyVoiceVolume.LooksNumeric(openRu.Text) || LibertyVoiceVolume.LooksNumeric(openEn.Text) || openRuAction == "" && LibertyVoiceVolume.VolumeCue(openRu.Text) || openEnAction == "" && LibertyVoiceVolume.VolumeCue(openEn.Text);
        bool scale = System.Text.RegularExpressions.Regex.IsMatch(openRu.Text + " " + openEn.Text, @"(?:двое|половин|halve|half|double|har volume)");
        if (numeric || scale) {
            var volumeRu = RecognizeModel(model, requireWake ? russianWakeVolumeGrammar : russianVolumeGrammar, wave, start, length);
            var volumeEn = RecognizeModel(englishModel, requireWake ? englishWakeVolumeGrammar : englishVolumeGrammar, wave, start, length);
            string ruAction = Resolve(volumeRu.Text), enAction = Resolve(volumeEn.Text);
            bool wakeRu = ConfirmWake(volumeRu, new Result { Text = originalRu, Confidence = openRu.Confidence }), wakeEn = ConfirmWake(volumeEn, new Result { Text = originalEn, Confidence = openEn.Confidence });
            volumeRu.Activated = wakeRu; volumeEn.Activated = wakeEn;
            bool ruOk = LibertyVoiceVolume.Corroborates(ruAction, openRu.Text, volumeRu.Text, volumeRu.NumberConfidence) && volumeRu.Confidence >= .65f && (!requireWake || wakeRu && LibertyVoiceCatalog.HasWake(volumeRu.Text)) && Allowed(openRu, openEn, ruAction);
            bool enOk = LibertyVoiceVolume.Corroborates(enAction, openEn.Text, volumeEn.Text, volumeEn.NumberConfidence) && volumeEn.Confidence >= .65f && (!requireWake || wakeEn && LibertyVoiceCatalog.HasWake(volumeEn.Text)) && Allowed(openEn, openRu, enAction);
            diagnostics += "; volume RU: " + volumeRu.Text + " (" + volumeRu.Confidence + "); volume EN: " + volumeEn.Text + " (" + volumeEn.Confidence + ")";
            volumeRu.Diagnostics = volumeEn.Diagnostics = diagnostics;
            if (ruOk && enOk && ruAction != enAction) return new Result { Text = "", Confidence = 0, Diagnostics = diagnostics };
            if (ruOk) return volumeRu;
            if (enOk) return volumeEn;
            return new Result { Text = "", Confidence = 0, Diagnostics = diagnostics, Activated = requireWake && (wakeRu || wakeEn) };
        }
        string ru = Resolve(russian.Text), en = Resolve(english.Text);
        bool ruValid = ru != "" && russian.Confidence >= .45f && (!requireWake || ruWake && LibertyVoiceCatalog.HasWake(russian.Text)) && Allowed(openRu, openEn, ru);
        bool enValid = en != "" && english.Confidence >= .45f && (!requireWake || enWake && LibertyVoiceCatalog.HasWake(english.Text)) && Allowed(openEn, openRu, en);
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
        return new Result { Text = "", Confidence = 0, Diagnostics = diagnostics, Activated = requireWake && (ruWake || enWake) };
    }
    static bool Allowed(Result own, Result other, string action) {
        return !LibertyVoiceCatalog.NegatesCommand(own.Text) && (!LibertyVoiceCatalog.NegatesCommand(other.Text) || Resolve(own.Text) == action);
    }
    static string CanonicalWake(string text, string prefix) {
        if (LibertyVoiceCatalog.HasWake(text)) return text;
        // Preserve signs/decimal punctuation in the body for range validation.
        var first = System.Text.RegularExpressions.Regex.Match(text, @"^\s*\S+\s+");
        return first.Success ? prefix + " " + text.Substring(first.Length) : text;
    }
    static bool ConfirmWake(Result candidate, Result full) {
        string raw = LibertyVoiceCatalog.Normalize(full.Text);
        // /wi:v/ (weave / we've) is a different vowel from the requested /weiv/.
        if (raw.StartsWith("we ve ") || raw.StartsWith("weave ")) return false;
        if (!LibertyVoiceCatalog.HasWake(candidate.Text) || candidate.WakeConfidence < .6f) return false;
        if (LibertyVoiceCatalog.HasWake(full.Text)) return true;
        if (!LibertyVoiceCatalog.HasWake(candidate.Text) || candidate.WakeConfidence < .75f || Resolve(full.Text) != "") return false;
        string normalized = LibertyVoiceCatalog.Normalize(full.Text);
        string first = normalized.StartsWith("we ve ") ? "weve" : normalized.Split(' ')[0];
        double near = 0; foreach (string prefix in new [] { "wave", "вейв", "вэйв" }) near = Math.Max(near, LibertyVoiceCatalog.Similarity(first, prefix));
        return normalized.Contains(" ") && near >= .4;
    }
    static bool Plausible(Result constrained, Result unrestricted) {
        string phrase = " " + LibertyVoiceCatalog.Normalize(constrained.Text) + " ";
        string full = " " + LibertyVoiceCatalog.Normalize(unrestricted.Text) + " ";
        // Polite fillers are easy to hallucinate in foreign-language speech.
        // Require the full decoder to hear the filler or confirm the action.
        foreach (string polite in new [] { " please ", " пожалуйста " }) {
            if (phrase.Contains(polite) && !full.Contains(polite) && Resolve(unrestricted.Text) != Resolve(constrained.Text)) return false;
        }
        if (constrained.Activated && Resolve(unrestricted.Text) != Resolve(constrained.Text) && LibertyVoiceCatalog.Similarity(LibertyVoiceCatalog.StripWake(constrained.Text), LibertyVoiceCatalog.StripWake(unrestricted.Text)) < .65) return false;
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
            var texts = new List<string>(); double confidence = 0; int words = 0, numberWords = 0; float wakeConfidence = 0, numberConfidence = 1;
            foreach (var part in parts) {
                if (!String.IsNullOrWhiteSpace(part.Text)) texts.Add(part.Text.Trim());
                if (part.Words != null) foreach (var word in part.Words) { if (words == 0 && LibertyVoiceCatalog.HasWake(word.Text)) wakeConfidence = (float)word.Confidence; if (LibertyVoiceVolume.NumberWord(word.Text)) { numberWords++; numberConfidence = Math.Min(numberConfidence, (float)word.Confidence); } confidence += word.Confidence; words++; }
            }
            return new Result { Text = String.Join(" ", texts), Confidence = words == 0 ? 0 : (float)(confidence / words), WakeConfidence = wakeConfidence, NumberConfidence = numberWords == 0 ? 0 : numberConfidence };
        } finally { freeRecognizer(recognizer); }
    }
}
