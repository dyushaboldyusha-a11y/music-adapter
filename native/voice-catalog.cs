using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Text.RegularExpressions;

public static class LibertyVoiceCatalog {
    [DataContract] sealed class Entry {
        [DataMember(Name = "id")] public string Id = "";
        [DataMember(Name = "ru")] public string[] Russian = null;
        [DataMember(Name = "en")] public string[] English = null;
    }
    [DataContract] sealed class Catalog {
        [DataMember(Name = "version")] public int Version = 0;
        [DataMember(Name = "commands")] public Entry[] Commands = null;
    }
    static readonly HashSet<string> actions = new HashSet<string> { "pause", "resume", "next", "previous", "volumeUp", "volumeDown", "mute", "unmute" };
    static readonly Dictionary<string, string> aliases = new Dictionary<string, string>();
    static readonly Dictionary<string, List<string>> phrases = new Dictionary<string, List<string>>();
    static string Clean(string text, bool foldYo) {
        if (text == null || text.Length > 200) return "";
        text = text.ToLowerInvariant();
        var words = Regex.Matches(foldYo ? text.Replace('ё', 'е') : text, @"[\p{L}\p{Nd}]+");
        var parts = new List<string>(); foreach (Match word in words) parts.Add(word.Value);
        return String.Join(" ", parts);
    }
    public static string Normalize(string text) {
        // The dynamic decoder can select the standalone nominative "пауза"
        // inside "на паузу". Repair that case ending before exact lookup.
        return (" " + Clean(text, true) + " ").Replace(" на пауза ", " на паузу ").Trim();
    }
    public static void Load(string filename) {
        if (aliases.Count > 0) return;
        Catalog catalog;
        using (var file = File.OpenRead(filename)) {
            if (file.Length > 65536) throw new InvalidOperationException("Слишком большой словарь голосовых команд.");
            catalog = (Catalog)new DataContractJsonSerializer(typeof(Catalog)).ReadObject(file);
        }
        if (catalog.Version != 1 || catalog.Commands == null || catalog.Commands.Length != 8) throw new InvalidOperationException("Некорректный словарь голосовых команд.");
        var seen = new HashSet<string>(); phrases["ru"] = new List<string>(); phrases["en"] = new List<string>();
        foreach (var entry in catalog.Commands) {
            if (!actions.Contains(entry.Id) || !seen.Add(entry.Id)) throw new InvalidOperationException("Некорректное действие голосовой команды.");
            Add(entry.Id, entry.Russian, "ru", "пожалуйста"); Add(entry.Id, entry.English, "en", "please");
        }
    }
    static void Add(string action, string[] values, string language, string polite) {
        if (values == null || values.Length == 0 || values.Length > 100) throw new InvalidOperationException("В словаре отсутствуют синонимы.");
        foreach (var value in values) {
            string phrase = Clean(value, false);
            if (phrase == "") throw new InvalidOperationException("Пустая голосовая команда.");
            foreach (var alias in new [] { phrase, polite + " " + phrase, phrase + " " + polite }) {
                string previous;
                string normalized = Normalize(alias);
                if (aliases.TryGetValue(normalized, out previous) && previous != action) throw new InvalidOperationException("Одна фраза назначена разным действиям: " + alias);
                aliases[normalized] = action;
                // The English acoustic dictionary spells this spoken word as
                // two tokens. Keep the natural spelling in the UI/catalog.
                string spoken = language == "en" ? alias.Replace("unmute", "un mute") : alias;
                aliases[Normalize(spoken)] = action;
                if (!phrases[language].Contains(spoken)) phrases[language].Add(spoken);
            }
        }
    }
    public static bool HasWake(string text) { return Regex.IsMatch(Normalize(text), @"^(?:wave|вейв|вэйв)(?: |$)"); }
    public static string StripWake(string text) { return Regex.Replace(Normalize(text), @"^(?:wave|вейв|вэйв)(?: |$)", ""); }
    public static string Resolve(string text) {
        if (Regex.IsMatch(text ?? "", @"-\s*\d")) return "";
        text = StripWake(text); string action;
        return aliases.TryGetValue(text, out action) ? action : LibertyVoiceVolume.Resolve(text);
    }
    public static string[] Phrases(string language) { return phrases[language].ToArray(); }
    public static bool NegatesCommand(string text) {
        string phrase = " " + StripWake(text) + " ";
        return phrase.Contains(" не ") ||
            phrase.Contains(" do not ") || phrase.Contains(" don t ") ||
            (phrase.StartsWith(" not ") && Resolve(phrase.Substring(5)) != "") ||
            (phrase.StartsWith(" please not ") && Resolve(phrase.Substring(12)) != "") || phrase.StartsWith(" never ");
    }
    public static double Similarity(string first, string second) {
        first = Normalize(first); second = Normalize(second);
        if (first == "" || second == "") return 0;
        int[] previous = new int[second.Length + 1]; for (int j = 0; j <= second.Length; j++) previous[j] = j;
        for (int i = 1; i <= first.Length; i++) {
            int[] current = new int[second.Length + 1]; current[0] = i;
            for (int j = 1; j <= second.Length; j++) current[j] = Math.Min(Math.Min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + (first[i - 1] == second[j - 1] ? 0 : 1));
            previous = current;
        }
        return 1 - (double)previous[second.Length] / Math.Max(first.Length, second.Length);
    }
    public static byte[] Grammar(string language, bool wake = false) {
        var words = new List<string>(phrases[language]);
        if (wake) foreach (string prefix in language == "ru" ? new [] { "вейв", "вэйв", "весь", "вес", "век" } : new [] { "wave", "wait", "wake", "weave", "way" }) {
            words.Add(prefix);
            foreach (string phrase in phrases[language]) words.Add(prefix + " " + phrase);
        }
        words.Add("[unk]");
        using (var stream = new MemoryStream()) {
            new DataContractJsonSerializer(typeof(string[])).WriteObject(stream, words.ToArray());
            stream.WriteByte(0); return stream.ToArray();
        }
    }
    public static int CheckAliases() {
        foreach (var pair in aliases) if (Resolve(pair.Key) != pair.Value) throw new InvalidOperationException("Синоним не распознан: " + pair.Key);
        foreach (string text in new [] { "не надо переключать музыку", "do not skip", "don't stop", "это не пауза", "please do not stop", "next pause", "привет" }) if (Resolve(text) != "") throw new InvalidOperationException("Посторонняя фраза стала командой: " + text);
        foreach (string text in new [] { "не переключай музыку", "пожалуйста не останавливай", "do not skip", "please don't stop", "never skip", "not louder" }) if (!NegatesCommand(text)) throw new InvalidOperationException("Отрицание не распознано: " + text);
        foreach (string text in new [] { "пауза", "next", "unmute", "first off no problem", "not sure" }) if (NegatesCommand(text)) throw new InvalidOperationException("Ложное отрицание: " + text);
        var examples = new Dictionary<string, string> { { "  Пожалуйста, ВПЕРЁД! ", "next" }, { "NEXT TRACK, please!", "next" }, { " UNMUTE!", "unmute" }, { "un mute", "unmute" }, { "ВКЛЮЧИ ЗВУК", "unmute" }, { "Сделай ПОТИШЕ.", "volumeDown" }, { "Поставь на пауза, пожалуйста", "pause" } };
        foreach (var pair in examples) if (Resolve(pair.Key) != pair.Value) throw new InvalidOperationException("Ошибка нормализации команды: " + pair.Key);
        return aliases.Count;
    }
}
