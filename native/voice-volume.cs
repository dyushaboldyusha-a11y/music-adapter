using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Runtime.Serialization.Json;
using System.IO;

// Only complete, bounded volume requests are converted into action tokens.
public static class LibertyVoiceVolume {
    static readonly Dictionary<string, int> numbers = new Dictionary<string, int>();
    static readonly string[] ruSmall = { "ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать" };
    static readonly string[] enSmall = { "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen" };
    static readonly string[] ruTens = { "", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто" };
    static readonly string[] enTens = { "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety" };
    static LibertyVoiceVolume() {
        for (int i = 0; i <= 100; i++) { numbers[Words(i, "ru")] = i; numbers[Words(i, "en")] = i; numbers[i.ToString(System.Globalization.CultureInfo.InvariantCulture)] = i; }
        numbers["нуль"] = 0; numbers["одна"] = 1; numbers["две"] = 2; numbers["one hundred"] = 100;
    }
    public static string Words(int value, string language) {
        if (value < 0 || value > 100) throw new ArgumentOutOfRangeException("value");
        if (value == 100) return language == "ru" ? "сто" : "one hundred";
        var small = language == "ru" ? ruSmall : enSmall; var tens = language == "ru" ? ruTens : enTens;
        return value < 20 ? small[value] : tens[value / 10] + (value % 10 == 0 ? "" : " " + small[value % 10]);
    }
    static string NumberRequest(string text, string pattern, string action, int direction) {
        var match = Regex.Match(text, pattern); int value;
        return match.Success && numbers.TryGetValue(match.Groups[1].Value, out value) ? action + ":" + (direction * value).ToString(System.Globalization.CultureInfo.InvariantCulture) : "";
    }
    public static string Resolve(string text) {
        // Strip one optional polite prefix/suffix, never arbitrary filler words.
        text = Regex.Replace(text, @"^(?:пожалуйста|please) | (?:пожалуйста|please)$", "");
        if (Regex.IsMatch(text, @"^(?:убавь вдвое|убавь наполовину|уменьши наполовину|уменьши громкость наполовину|уменьши вдвое|уменьши громкость вдвое|сделай вдвое тише|громкость наполовину|половина громкости|halve volume|half volume|cut volume in half)$")) return "volumeScale:0.5";
        if (Regex.IsMatch(text, @"^(?:увеличь громкость вдвое|сделай вдвое громче|double volume)$")) return "volumeScale:2";
        string result = NumberRequest(text, @"^(?:сделай громкость на|сделай громкость|установи громкость на|установи громкость|громкость на|громкость|звук на|set the volume to|set volume to|set volume|volume to|volume) (.+?)(?: процент| процента| процентов| percent)?$", "volumeSet", 1);
        if (result != "") return result;
        result = NumberRequest(text, @"^(?:прибавь на|прибавь|добавь|увеличь громкость на|volume up|turn up|increase volume by) (.+?)(?: процент| процента| процентов| percent)?$", "volumeStep", 1);
        if (result != "") return result;
        return NumberRequest(text, @"^(?:убавь|убавь на|уменьши громкость на|volume down|turn down|decrease volume by|lower volume by) (.+?)(?: процент| процента| процентов| percent)?$", "volumeStep", -1);
    }
    public static bool NumberWord(string word) { return numbers.ContainsKey(word) || word == "hundred" || word == "and" || Regex.IsMatch(word, @"^\d+$"); }
    public static int NumberIn(string text) {
        var words = LibertyVoiceCatalog.Normalize(text).Split(' '); var spans = new List<string>();
        string current = "";
        foreach (string word in words) {
            if (NumberWord(word)) current += (current == "" ? "" : " ") + word;
            else if (current != "") { spans.Add(current); current = ""; }
        }
        if (current != "") spans.Add(current);
        int value;
        return spans.Count == 1 && numbers.TryGetValue(spans[0], out value) ? value : -1;
    }
    static string[] Context(string text) {
        var result = new List<string>(); bool number = false;
        foreach (string word in LibertyVoiceCatalog.StripWake(text).Split(' ')) {
            if (NumberWord(word)) { if (!number) result.Add("#"); number = true; }
            else { number = false; if (word != "please" && word != "пожалуйста" && word != "the" && word != "to" && word != "by" && word != "на") result.Add(word); }
        }
        return result.ToArray();
    }
    public static bool Corroborates(string action, string transcript, string candidate, float numberConfidence = 0) {
        if (!IsVolume(action) || Regex.IsMatch(transcript, @"-\s*\d") || Regex.IsMatch(LibertyVoiceCatalog.Normalize(transcript), @"(?:^| )(?:минус|minus|negative)(?: |$)")) return false;
        if (action.StartsWith("volumeScale:")) return LibertyVoiceCatalog.Similarity(transcript, candidate) >= .55 || Regex.IsMatch(transcript, @"(?:вдвое|двое|наполовину|half|halve|double)");
        int number = NumberIn(transcript); string[] parts = action.Split(':'); int proposed;
        if (number < 0) {
            // A number decoder may recover a word omitted by the unrestricted
            // LM. Never do this for malformed/out-of-range numeric sequences.
            foreach (string word in LibertyVoiceCatalog.Normalize(transcript).Split(' ')) if (NumberWord(word)) return false;
            return numberConfidence >= .75f && VolumeCue(transcript) && LibertyVoiceCatalog.Similarity(LibertyVoiceCatalog.StripWake(transcript), LibertyVoiceCatalog.StripWake(candidate)) >= .65;
        }
        var fullContext = Context(transcript); var candidateContext = Context(candidate);
        return number >= 0 && Int32.TryParse(parts[1], out proposed) && Math.Abs(proposed) == number && fullContext.Length == candidateContext.Length && LibertyVoiceCatalog.Similarity(String.Join(" ", fullContext), String.Join(" ", candidateContext)) >= .6;
    }
    public static byte[] Grammar(string language, bool wake) {
        var body = new List<string>();
        for (int n = 0; n <= 100; n++) {
            string number = Words(n, language);
            if (language == "ru") {
                string suffix = n % 10 == 1 && n % 100 != 11 ? "процент" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "процента" : "процентов";
                body.Add("громкость " + number + " " + suffix); body.Add("прибавь " + number); body.Add("убавь " + number + " " + suffix);
            } else {
                body.Add("volume " + number + " percent"); body.Add("set volume to " + number + " percent"); body.Add("increase volume by " + number + " percent"); body.Add("lower volume by " + number + " percent");
            }
        }
        body.AddRange(language == "ru" ? new [] { "убавь вдвое", "уменьши громкость вдвое", "сделай вдвое тише", "громкость наполовину", "сделай вдвое громче", "увеличь громкость вдвое" } : new [] { "halve volume", "half volume", "cut volume in half", "double volume" });
        // Contrast paths keep a missing number from becoming an inferred zero.
        body.AddRange(language == "ru" ? new [] { "громкость", "громкость процентов", "процентов", "прибавь", "убавь" } : new [] { "volume", "volume percent", "percent", "set volume to", "increase volume", "lower volume" });
        var phrases = new List<string>(body);
        if (wake) foreach (string prefix in language == "ru" ? new [] { "вейв", "вэйв", "весь", "вес", "век" } : new [] { "wave", "wait", "wake", "weave", "way" }) foreach (string phrase in body) phrases.Add(prefix + " " + phrase);
        phrases.Add("[unk]");
        using (var stream = new MemoryStream()) { new DataContractJsonSerializer(typeof(string[])).WriteObject(stream, phrases.ToArray()); stream.WriteByte(0); return stream.ToArray(); }
    }
    public static bool VolumeCue(string text) { return Regex.IsMatch(" " + LibertyVoiceCatalog.StripWake(text) + " ", @" (?:громкость|volume) "); }
    public static bool LooksNumeric(string text) {
        text = LibertyVoiceCatalog.StripWake(text);
        if (!Regex.IsMatch(" " + text + " ", @" (?:громкость|громкости|прибавь|убавь|увеличь|уменьши|volume|turn|increase|decrease|lower|процент|процента|процентов|percent) ")) return false;
        foreach (string word in text.Split(' ')) if (numbers.ContainsKey(word) || Regex.IsMatch(word, @"^\d+$")) return true;
        return false;
    }
    public static bool IsVolume(string action) { return action.StartsWith("volumeSet:") || action.StartsWith("volumeStep:") || action.StartsWith("volumeScale:"); }
    public static int Check() {
        int checkedCount = 0;
        for (int n = 0; n <= 100; n++) foreach (var language in new [] { "ru", "en" }) {
            string text = (language == "ru" ? "громкость " : "volume ") + Words(n, language);
            if (Resolve(text) != "volumeSet:" + n) throw new InvalidOperationException("Invalid percentage: " + text);
            checkedCount++;
        }
        foreach (string text in new [] { "volume 101", "volume minus ten", "громкость минус пять", "не громкость тридцать", "volume thirty pause", "volume 1 0", "прибавь сто один" }) if (Resolve(text) != "") throw new InvalidOperationException("Unbounded volume request: " + text);
        if (Resolve("set volume to thirty five percent") != "volumeSet:35" || Resolve("громкость на тридцать процентов") != "volumeSet:30" || Resolve("прибавь на десять") != "volumeStep:10") throw new InvalidOperationException("Invalid long-prefix volume request");
        if (Resolve("прибавь десять") != "volumeStep:10" || Resolve("убавь десять процентов") != "volumeStep:-10" || Resolve("volume fifty percent") != "volumeSet:50" || Resolve("убавь вдвое") != "volumeScale:0.5") throw new InvalidOperationException("Invalid relative volume request");
        if (Corroborates("volumeSet:5", "вейв тонкость ней нас пять процентов", "вейв громкость пять процентов") || Corroborates("volumeSet:5", "wave volume minus five", "wave volume five") || Corroborates("volumeSet:5", "вейв громкость -5", "вейв громкость пять")) throw new InvalidOperationException("Negative percentage was reinterpreted");
        return checkedCount;
    }
}
