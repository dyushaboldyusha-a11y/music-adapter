# Wave activation and exact-volume audio fixtures

These 41 synthetic speech recordings and two generated signals test both local Vosk models, strict activation,
exact percentages, relative changes, scale changes and rejection of unrelated
speech, similar words, misplaced wake words, negations and out-of-range values.
The 51 previous fixtures remain unchanged in `../voice`.

Generation uses Piper 1.3.0, CPU ONNX Runtime 1.31.1, seed 42 per language,
`intra_op_num_threads=2`, `inter_op_num_threads=1`, length scale 1.0 and other
default synthesis settings. Each language is generated in manifest order.
`text` in `samples.json` is the exact synthesis input. FFmpeg converts the
22,050 Hz output to 16 kHz signed 16-bit mono PCM. Silence and fixed-seed white noise are copied unchanged from the previous suite. No microphone recordings or
personal data are included. Only finished WAV files are tracked.

Voice sources (Piper voices revision `e7229f7d33a10e145e109b886d661984201ac3c4`):

- Russian: `ru/ru_RU/denis/medium/ru_RU-denis-medium.onnx`.
  SHA-256 `15fab56e11a097858ee115545d0f697fc2a316c41a291a5362349fb870411b0a`.
  The [model card](https://huggingface.co/rhasspy/piper-voices/blob/e7229f7d33a10e145e109b886d661984201ac3c4/ru/ru_RU/denis/medium/MODEL_CARD) identifies the dataset as CC0.
- English: `en/en_US/ljspeech/high/en_US-ljspeech-high.onnx`.
  SHA-256 `5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a`.
  The [model card](https://huggingface.co/rhasspy/piper-voices/blob/e7229f7d33a10e145e109b886d661984201ac3c4/en/en_US/ljspeech/high/MODEL_CARD) identifies the LJSpeech dataset as public domain.

Piper and these TTS models are fixture-generation tools. The application uses
bundled Vosk for recognition. Tests require no synthesizer or microphone.

`mode: wake` first runs the same activity segmenter used by continuous input,
feeding 2048-byte microphone-sized frames followed by silence. Every positive
must produce one source-bindable utterance and one confirmed activation/action;
negative samples must produce no action. `mode: hold` verifies exact volume
without requiring a wake word. These checks establish behavior and packaging,
not recognition accuracy across all human voices or noisy microphones.
