These 49 speech recordings were synthesized for integration tests: 47 with
eSpeak NG 1.52.0 and two with Piper 1.3.0. FFmpeg converts the output to 16 kHz
signed 16-bit mono PCM. They contain no microphone recordings or personal data.
Silence and fixed-seed white noise are generated signals. The 8 original
Russian command recordings are preserved unchanged.

## eSpeak recordings

Synthesis: `espeak-ng -v VOICE -s RATE -w raw.wav TEXT`, followed by
`ffmpeg -i raw.wav -ar 16000 -ac 1 -acodec pcm_s16le output.wav`.

- Original 8 Russian commands: `ru`, 135 words/minute.
- New Russian positives and negatives: `ru`, 135 words/minute, except:
  - `ru-forward.wav`: `ru+m3`, 160 words/minute.
  - `ru-dalshe.wav` and `ru-nazad.wav`: Piper, described below.
- New English positives and negatives: `en-us`, 135 words/minute, except:
  - `en-quieter.wav`: `en-us+m3`, 160 words/minute.
  - `en-volume-down.wav`: `en-us+f3`, 160 words/minute.
  - `en-sound-on.wav`: `en-us+m3`, 190 words/minute.

## Piper recordings

`ru-dalshe.wav` and `ru-nazad.wav` contain exactly the same command words as
before: "Дальше." and "Назад.". They were generated with Piper 1.3.0 and
`ru_RU-denis-medium`, CPU ONNX Runtime 1.31.1, seed 42, length scale 1.0 and
other default synthesis settings, then converted with FFmpeg as above. Clearer
synthesis replaces the earlier robotic recordings, which were not reliably
intelligible to the full Russian decoder. Expected actions are unchanged.

Model repository: https://huggingface.co/rhasspy/piper-voices
Revision: `e7229f7d33a10e145e109b886d661984201ac3c4`
Path: `ru/ru_RU/denis/medium/ru_RU-denis-medium.onnx`
SHA-256: `15fab56e11a097858ee115545d0f697fc2a316c41a291a5362349fb870411b0a`
The model card identifies the Denis dataset as CC0:
https://huggingface.co/rhasspy/piper-voices/blob/e7229f7d33a10e145e109b886d661984201ac3c4/ru/ru_RU/denis/medium/MODEL_CARD

Only the finished WAV files are tracked; synthesizers and TTS models are used
for fixture generation. Runtime speech recognition uses the bundled Vosk models.

## Assertions

`samples.json` records the phrase and expected action for all 51 samples.
The real bundled native decoder must recognize every positive sample and
reject negations, unrelated speech, silence and noise. Native checks also
validate every catalog alias, polite form, punctuation/case normalization and
rejection of sentences containing a command word.

These recordings verify integration and packaging; they do not measure
recognition accuracy across human speakers, microphones or background noise.
