The eight Russian command recordings were synthesized for these tests with
eSpeak NG 1.52.0 (`-v ru -s 135`) and converted to 16 kHz, signed 16-bit mono PCM
with FFmpeg. They contain no microphone recordings or personal data. Silence
and fixed-seed white noise are generated test signals.

`samples.json` records the expected command. The real bundled native decoder
must recognize every positive sample and reject both negative samples. These
recordings verify integration and packaging; they do not measure recognition
accuracy across human speakers, microphones or background noise.
