These 49 speech recordings were synthesized for integration tests with eSpeak
NG 1.52.0 and converted using FFmpeg to 16 kHz signed 16-bit mono PCM. They
contain no microphone recordings or personal data. Silence and fixed-seed white
noise are generated signals. The 8 original Russian command recordings are
preserved unchanged.

Speech synthesis: `espeak-ng -v VOICE -s RATE -w raw.wav TEXT`, followed by
`ffmpeg -i raw.wav -ar 16000 -ac 1 -acodec pcm_s16le output.wav`.

- Original 8 Russian commands: `ru`, 135 words/minute.
- New Russian positives and negatives: `ru`, 135 words/minute, except:
  - `ru-dalshe.wav` and `ru-forward.wav`: `ru+m3`, 160 words/minute.
  - `ru-nazad.wav`: `ru+f3`, 160 words/minute.
- New English positives and negatives: `en-us`, 135 words/minute, except:
  - `en-quieter.wav`: `en-us+m3`, 160 words/minute.
  - `en-sound-on.wav`: `en-us+m3`, 190 words/minute.

`samples.json` records the phrase and expected action for all 51 samples.
The real bundled native decoder must recognize every positive sample and
reject negations, unrelated speech, silence and noise. Native checks also
validate every catalog alias, polite form, punctuation/case normalization and
rejection of sentences containing a command word.

These recordings verify integration and packaging; they do not measure
recognition accuracy across human speakers, microphones or background noise.
