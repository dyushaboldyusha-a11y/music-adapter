const { test } = require('node:test');
const assert = require('node:assert/strict');
const { heldKeys, VoiceGate, normalizeAutomation } = require('../src/automation.cjs');
const { DEFAULT_BINDINGS, normalizeBindings, readBindings } = require('../src/shared/shortcuts.js');
test('voice binding migrates disabled and supports physical held chords including numpad and modifiers', () => {
  assert.equal(readBindings({ toggleInteraction: 'F8', playPause: '' }).voiceHold, '');
  assert.deepEqual(heldKeys('Ctrl+Shift+V'), [17, 16, 86]);
  assert.deepEqual(heldKeys('Alt+F24'), [18, 135]);
  assert.deepEqual(heldKeys('Super+num8'), [91, 104]);
  assert.deepEqual(heldKeys(''), []);
  assert.throws(() => heldKeys('invalid'));
  assert.throws(() => normalizeBindings({ ...DEFAULT_BINDINGS, voiceHold: DEFAULT_BINDINGS.playPause }));
});
function fixture() {
  let state = { connected: true, source: { id: 'player-a' }, playing: true };
  const calls = [], gate = new VoiceGate(() => state, (...args) => calls.push(args), { step: value => calls.push(['step', value]) });
  const update = (session, command = '', listening = true) => gate.accept({ session, command, listening });
  return { gate, calls, update, change: value => { state = { ...state, ...value }; } };
}
test('voice requires a listening start and routes only one allowed command per held session', async () => {
  const f = fixture();
  await f.update(1, 'next'); assert.deepEqual(f.calls, []);
  await f.update(1); await f.update(1, 'next'); await f.update(1, 'previous');
  assert.deepEqual(f.calls, [['next']]);
  await f.update(1, '', false); await f.update(1, 'next'); assert.equal(f.calls.length, 1);
  await f.update(2); await f.update(2, 'pause'); assert.deepEqual(f.calls.at(-1), ['playPause']);
  await f.update(3); await f.update(3, 'resume'); assert.equal(f.calls.length, 2);
  f.change({ playing: false }); await f.update(4); await f.update(4, 'resume'); assert.equal(f.calls.length, 3);
});
test('releasing, suspending capture or changing the selected source rejects delayed speech', async () => {
  const f = fixture();
  await f.update(1); f.gate.cancel(); await f.update(1, 'next'); assert.equal(f.calls.length, 0);
  await f.update(2); f.change({ source: { id: 'player-b' } }); await f.update(2, 'next'); assert.equal(f.calls.length, 0);
  await f.update(3); await f.update(3, '', false); await f.update(3, 'next'); assert.equal(f.calls.length, 0);
  f.change({ connected: false }); await f.update(4); await f.update(4, 'next'); assert.equal(f.calls.length, 0);
});
test('local voice volume/mute are bounded commands, unrecognized text is never executed', async () => {
  const f = fixture();
  for (const [i, command] of ['volumeUp', 'volumeDown', 'mute', 'unmute', 'cmd.exe /c shutdown'].entries()) {
    await f.update(i + 1); await f.update(i + 1, command);
  }
  assert.deepEqual(f.calls, [['step', .05], ['step', -.05], ['mute', true], ['mute', false]]);
});
test('key release closes capture but does not discard a final result from the same authorized voice session', async () => {
  const f = fixture();
  await f.update(1);
  await f.gate.accept({ session: 1, listening: false, phase: 'processing' });
  await f.gate.accept({ session: 1, listening: false, phase: 'recognized' });
  await f.gate.accept({ session: 1, listening: false, phase: 'recognized', command: 'next' });
  await f.gate.accept({ session: 1, listening: false, phase: 'recognized', command: 'next' });
  assert.deepEqual(f.calls, [['next']]);
});
test('microphone tests and canceled post-release recognition never execute player commands', async () => {
  const f = fixture();
  await f.gate.accept({ session: 1, listening: true, test: true });
  await f.gate.accept({ session: 1, listening: false, phase: 'recognized', test: true, command: 'next' });
  assert.deepEqual(f.calls, []);
  await f.update(2); f.gate.cancel();
  await f.gate.accept({ session: 2, phase: 'recognized', command: 'next' });
  assert.deepEqual(f.calls, []);
  await f.gate.accept({ session: 3, phase: 'recognized', command: 'next' });
  assert.deepEqual(f.calls, []);
});
test('microphone metadata keeps safe device IDs and finite level values', () => {
  const value = normalizeAutomation({ microphones: [{ id: 'default', name: 'System' }, { id: '2', name: 'USB Mic' }, { id: '../file', name: 'Invalid' }, null], level: Infinity, peak: 3, phase: 'processing', test: true });
  assert.deepEqual(value.microphones, [{ id: 'default', name: 'System' }, { id: '2', name: 'USB Mic' }]);
  assert.equal(value.level, 0); assert.equal(value.peak, 1); assert.equal(value.phase, 'processing'); assert.equal(value.test, true);
});
const { voiceAction } = require('../src/automation.cjs');
const { status: voiceStatus } = require('../src/shared/voice-status.js');
test('voice percentages are bounded data tokens, including zero and relative changes', () => {
  for (const value of [0, 1, 30, 99, 100]) assert.equal(voiceAction(`volumeSet:${value}`).value, value);
  assert.equal(voiceAction('volumeStep:-10').value, -10);
  assert.equal(voiceAction('volumeScale:0.5').value, .5);
  for (const value of ['volumeSet:-1', 'volumeSet:101', 'volumeSet:NaN', 'volumeStep:1000', 'volumeScale:3', 'volumeSet:0.3', 'volumeSet:30;next']) assert.equal(voiceAction(value), null);
});
test('continuous mode requires a fresh source-bound session and confirmed Wave activation', async () => {
  const f = fixture();
  await f.gate.accept({ session: 1, listening: true, phase: 'listening', mode: 'wake' });
  await f.gate.accept({ session: 1, listening: true, mode: 'wake', activated: false, command: 'next' });
  assert.deepEqual(f.calls, []);
  await f.gate.accept({ session: 2, listening: true, phase: 'listening', mode: 'wake' });
  await f.gate.accept({ session: 2, listening: true, mode: 'wake', activated: true, command: 'next' });
  await f.gate.accept({ session: 2, listening: true, mode: 'wake', activated: true, command: 'next' });
  assert.deepEqual(f.calls, [['next']]);
  await f.gate.accept({ session: 3, listening: true, mode: 'wake' });
  f.change({ source: { id: 'player-b' } });
  await f.gate.accept({ session: 3, listening: true, mode: 'wake', activated: true, command: 'next' });
  assert.equal(f.calls.length, 1);
});
test('exact and relative volume commands route through the same bounded volume queue', async () => {
  const calls = [], gate = new VoiceGate(() => ({ connected: true, source: { id: 'player' }, volume: .6 }), () => {}, {
    set: value => calls.push(['set', value]), step: value => calls.push(['step', value]), scale: value => calls.push(['scale', value])
  });
  for (const [i, command] of ['volumeSet:30', 'volumeStep:-10', 'volumeScale:0.5', 'volumeSet:0', 'volumeSet:101'].entries()) {
    await gate.accept({ session: i + 1, listening: true });
    await gate.accept({ session: i + 1, listening: true, command });
  }
  assert.deepEqual(calls, [['set', .3], ['step', -.1], ['scale', .5], ['set', 0]]);
});
test('turning voice off suppresses delayed actions and feedback from the previous session', async () => {
  let finish; const feedback = [], state = { connected: true, source: { id: 'player' } };
  const gate = new VoiceGate(() => state, () => new Promise(resolve => { finish = resolve; }), {}, (...args) => feedback.push(args));
  await gate.accept({ session: 1, listening: true });
  const result = gate.accept({ session: 1, listening: true, command: 'next' });
  gate.cancel(); finish({ ok: true }); await result;
  await gate.accept({ session: 1, listening: true, command: 'next' });
  assert.deepEqual(feedback, []);
});
test('voice indicator distinguishes off, waiting, listening, processing and expired feedback', () => {
  assert.equal(voiceStatus({ enabled: false }).visible, false);
  assert.match(voiceStatus({ enabled: true, mode: 'wake' }).text, /Wave/);
  assert.equal(voiceStatus({ enabled: true, phase: 'listening' }).tone, 'listening');
  assert.equal(voiceStatus({ enabled: true, phase: 'processing' }).tone, 'processing');
  const voice = { enabled: true, mode: 'wake', feedback: { text: 'Громкость 30%', heard: 'вейв громкость тридцать', until: 200, ok: true } };
  assert.equal(voiceStatus(voice, 100).tone, 'success');
  assert.equal(voiceStatus(voice, 300).tone, 'idle');
  assert.equal(voiceStatus({ ...voice, error: 'Микрофон отключён' }, 100).tone, 'error');
});
test('voice mode migration preserves an already-enabled held microphone and defaults new profiles to Wave', () => {
  const { readVoiceMode } = require('../src/automation.cjs');
  assert.equal(readVoiceMode({}), 'wake');
  assert.equal(readVoiceMode({ voiceEnabled: false }), 'wake');
  assert.equal(readVoiceMode({ voiceEnabled: true }), 'hold');
  assert.equal(readVoiceMode({ voiceEnabled: true, voiceMode: 'wake' }), 'wake');
});
test('capture configuration generations invalidate queued results on source, microphone and test changes', async () => {
  const { WindowsAutomation } = require('../src/automation.cjs');
  const automation = new WindowsAutomation('unused');
  const requests = [];
  automation.start = () => {};
  automation.request = async (command, value) => { requests.push({ command, value }); return { ok: true }; };
  const config = { voice: true, mode: 'wake', microphone: 'default', keys: [], source: 'player-a' };
  assert.equal(automation.configure(config), true); assert.equal(automation.revision, 1);
  automation.sendConfiguration(); assert.equal(requests.at(-1).value.revision, 1);
  assert.equal(automation.configure(config), false); assert.equal(automation.revision, 1);
  automation.configure({ ...config, source: 'player-b' }); assert.equal(requests.at(-1).value.revision, 2);
  await automation.testMicrophone(true); assert.deepEqual(requests.at(-1), { command: 'test', value: { enabled: true, revision: 3 } });
  automation.emit('bridge-started'); assert.equal(requests.at(-1).value.revision, 3);
  automation.configure({ ...config, microphone: '1' }); assert.equal(requests.at(-1).value.revision, 4);
});
test('a confirmed command without a connected player shows feedback and executes nothing', async () => {
  const calls = [], feedback = [], gate = new VoiceGate(() => ({ connected: false, source: null }), (...args) => calls.push(args), {}, (...args) => feedback.push(args));
  await gate.accept({ session: 1, listening: true, mode: 'wake' });
  await gate.accept({ session: 1, listening: true, mode: 'wake', activated: true, command: 'next', heard: 'вейв следующий' });
  assert.deepEqual(calls, []); assert.equal(feedback[0][0].ok, false); assert.match(feedback[0][0].error, /плеер/);
});
