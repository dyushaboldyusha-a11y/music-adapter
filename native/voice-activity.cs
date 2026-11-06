using System;
using System.IO;
using System.Text;

// Audio-only utterance boundaries. Bounded RAM; no files or network access.
public sealed class LibertySpeechActivity {
    public const int MaxBytes = 8 * 32000;
    readonly MemoryStream speech = new MemoryStream();
    readonly byte[] pre = new byte[9600];
    int preCount, silence, voiced;
    public bool Speaking { get; private set; }
    public int BufferedBytes { get { return (int)speech.Length + preCount; } }
    void Remember(byte[] data) {
        int count = Math.Min(pre.Length, data.Length), keep = Math.Min(preCount, pre.Length - count);
        if (keep > 0) Buffer.BlockCopy(pre, preCount - keep, pre, 0, keep);
        Buffer.BlockCopy(data, data.Length - count, pre, keep, count); preCount = keep + count;
    }
    public byte[] Add(byte[] data, out bool started) {
        started = false;
        if (data.Length == 0) return null;
        if (data.Length > 32000 || data.Length % 2 != 0) throw new InvalidOperationException("Invalid microphone frame");
        double sum = 0;
        for (int i = 0; i < data.Length; i += 2) { double value = BitConverter.ToInt16(data, i) / 32768.0; sum += value * value; }
        bool sound = Math.Sqrt(sum / (data.Length / 2)) >= .006;
        if (!Speaking) {
            if (!sound) { Remember(data); return null; }
            Speaking = started = true; speech.SetLength(0); speech.Write(pre, 0, preCount); preCount = 0; silence = voiced = 0;
        }
        speech.Write(data, 0, Math.Min(data.Length, MaxBytes - (int)speech.Length));
        if (sound) { silence = 0; voiced += data.Length; } else silence += data.Length;
        if (silence < 24000 && speech.Length < MaxBytes) return null;
        byte[] result = voiced >= 3200 ? speech.ToArray() : null;
        Reset(); Remember(data); return result;
    }
    public void Reset() { speech.SetLength(0); Speaking = false; preCount = silence = voiced = 0; }
    public static byte[] Wave(byte[] pcm) {
        using (var stream = new MemoryStream()) using (var writer = new BinaryWriter(stream, Encoding.ASCII, true)) {
            writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write(pcm.Length + 36); writer.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
            writer.Write(16); writer.Write((ushort)1); writer.Write((ushort)1); writer.Write(16000); writer.Write(32000); writer.Write((ushort)2); writer.Write((ushort)16);
            writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write(pcm.Length); writer.Write(pcm); writer.Flush(); return stream.ToArray();
        }
    }
    public static byte[][] SegmentWave(byte[] wave) {
        if (wave.Length < 44 || wave.Length > 1024 * 1024 || Encoding.ASCII.GetString(wave, 0, 4) != "RIFF" || Encoding.ASCII.GetString(wave, 8, 4) != "WAVE") throw new InvalidOperationException("Invalid activity test wave");
        int offset = 12, start = -1, length = 0; bool valid = false;
        while (offset + 8 <= wave.Length) {
            string id = Encoding.ASCII.GetString(wave, offset, 4); uint count = BitConverter.ToUInt32(wave, offset + 4); offset += 8;
            if (count > wave.Length - offset) throw new InvalidOperationException("Truncated activity test wave");
            if (id == "fmt " && count >= 16) valid = BitConverter.ToUInt16(wave, offset) == 1 && BitConverter.ToUInt16(wave, offset + 2) == 1 && BitConverter.ToInt32(wave, offset + 4) == 16000 && BitConverter.ToUInt16(wave, offset + 14) == 16;
            if (id == "data") { start = offset; length = (int)count; }
            offset += (int)count + ((int)count & 1);
        }
        if (!valid || start < 0 || length % 2 != 0) throw new InvalidOperationException("Activity requires PCM 16 kHz, 16 bit, mono");
        var activity = new LibertySpeechActivity(); var results = new System.Collections.Generic.List<byte[]>(); bool started;
        for (int i = 0; i < length + 32000; i += 2048) {
            var frame = new byte[Math.Min(2048, length + 32000 - i)];
            if (i < length) Array.Copy(wave, start + i, frame, 0, Math.Min(frame.Length, length - i));
            byte[] pcm = activity.Add(frame, out started); if (pcm != null) results.Add(Wave(pcm));
        }
        return results.ToArray();
    }
    public static void Check() {
        var activity = new LibertySpeechActivity(); bool started;
        for (int i = 0; i < 2000; i++) if (activity.Add(new byte[1600], out started) != null || started || activity.BufferedBytes > 9600) throw new InvalidOperationException("Silence must stay bounded");
        var signal = new byte[1600]; for (int i = 0; i < signal.Length; i += 2) { signal[i] = 0; signal[i + 1] = 32; }
        int starts = 0, complete = 0;
        for (int i = 0; i < 20; i++) { if (activity.Add(signal, out started) != null) complete++; if (started) starts++; }
        for (int i = 0; i < 20; i++) { if (activity.Add(new byte[1600], out started) != null) complete++; if (started) starts++; }
        if (starts != 1 || complete != 1 || activity.Speaking) throw new InvalidOperationException("One utterance must have one start and one endpoint");
        for (int i = 0; i < 500; i++) { activity.Add(signal, out started); if (activity.BufferedBytes > MaxBytes + 9600) throw new InvalidOperationException("Continuous sound exceeded memory bound"); }
    }
}
