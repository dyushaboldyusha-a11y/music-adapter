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
