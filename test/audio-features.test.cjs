const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WindowsAudio, normalizeAudio, VolumeQueue } = require('../src/audio.cjs');
const { validateCommand, normalizeState } = require('../src/media.cjs');
const { DEFAULT_PREFERENCES, preferences, COMPACT_SIZE, layoutForDisplays } = require('../src/window-state.cjs');
const { ring, musicEnergy } = require('../src/renderer/audio-wave.js');

test('audio values and commands reject nonfinite, untyped or out-of-range input', () => {
  for (const value of [NaN, Infinity, -1, 1.01, '0.5', null]) assert.throws(() => validateCommand('volume', value));
  for (const value of [0, 1, 'true', null]) assert.throws(() => validateCommand('mute', value));
  assert.doesNotThrow(() => validateCommand('volume', .25)); assert.doesNotThrow(() => validateCommand('mute', false));
  assert.equal(normalizeState({ volume: Infinity }).volume, null);
  assert.equal(normalizeAudio({ volume: 3 }).volume, 1);
  assert.equal(normalizeAudio({ muted: 'true' }).muted, false);
});
test('rapid volume steps serialize relative to accepted values and preserve volume when muting', async () => {
  const state = { connected: true, source: { id: 'web:one' }, volume: .5, muted: false };
  const calls = [];
  const queue = new VolumeQueue(() => state, async (action, value) => {
    await new Promise(resolve => setTimeout(resolve, 1)); calls.push([action, value]);
    if (action === 'volume') state.volume = value; else state.muted = value;
    return { ok: true };
  });
  await Promise.all([queue.step(.05), queue.step(.05), queue.step(-.05)]);
  assert.deepEqual(calls, [['volume', .55], ['volume', .6], ['volume', .55]]);
  await queue.mute(); await queue.mute(); assert.equal(state.muted, false); assert.equal(state.volume, .55);
  state.volume = .99; await queue.step(.05); assert.equal(state.volume, 1);
  state.volume = .01; await queue.step(-.05); assert.equal(state.volume, 0);
});
test('queued volume keys cannot spill into a newly selected or closed source', async () => {
  let state = { connected: true, source: { id: 'web:one' }, volume: .5, muted: false };
  let calls = 0;
  const queue = new VolumeQueue(() => state, async () => { calls++; });
  const pending = queue.step(.05); state = { ...state, source: { id: 'web:two' } }; await pending;
  assert.equal(calls, 0);
  state.connected = false; await queue.mute(); assert.equal(calls, 0);
});
test('restarted Windows audio helper receives the current target and economy settings again', () => {
  const audio = new WindowsAudio('unused.ps1'), calls = [];
  audio.request = (command, value) => { calls.push([command, value]); return Promise.resolve(); };
  const configuration = { target: 'Spotify.exe', enabled: true, economy: true };
  audio.configure(configuration); audio.configure(configuration); assert.equal(calls.length, 1);
  audio.emit('bridge-started'); assert.equal(calls.length, 2); assert.deepEqual(calls[1], ['configure', configuration]);
  audio.stop();
});
test('legacy preferences migrate and compact layouts remain reachable at game resolutions', () => {
  assert.deepEqual(preferences(), DEFAULT_PREFERENCES);
  const migrated = preferences({ opacity: .4, color: '#438bff', scale: 1.25 });
  assert.equal(migrated.compact, false); assert.equal(migrated.opacity, .4); assert.equal(migrated.color, '#438bff');
  assert.equal(preferences({ waveIntensity: 20, waveMode: 'invalid' }).waveIntensity, 1);
  assert.equal(preferences({ waveIntensity: NaN, waveMode: 'invalid' }).waveMode, 'audio');
  const display = { workArea: { x: 0, y: 0, width: 640, height: 480 } };
  const layout = layoutForDisplays({ x: 1800, y: 1000 }, [display], 1.75, COMPACT_SIZE);
  assert.ok(layout.bounds.x + layout.bounds.width <= 640); assert.ok(layout.bounds.y + layout.bounds.height <= 480);
  assert.equal(layout.bounds.height, Math.round(COMPACT_SIZE.height * layout.scale));
});
test('audio wave remains one closed contour, settles in silence, and responds to actual level', () => {
  const idle = ring(616, 234, 0, 0, .7);
  assert.equal(ring(616, 234, 12, 0, .7), idle);
  assert.notEqual(ring(616, 234, 1, .8, .7), idle);
  assert.equal(ring(616, 234, 1, .8, 0), idle);
  for (const [w, h] of [[616, 234], [496, 112]]) {
    const d = ring(w, h, 3, 1, 1);
    assert.ok(d.startsWith('M') && d.endsWith('Z')); assert.ok(!d.includes('NaN'));
    assert.equal((d.match(/M/g) || []).length, 1);
  }
});
test('quiet real music produces visible motion while silence and invalid samples stay still', () => {
  assert.equal(musicEnergy(0), 0); assert.equal(musicEnergy(NaN), 0); assert.equal(musicEnergy(Infinity), 0);
  assert.equal(musicEnergy(-1), 0); assert.equal(musicEnergy(2), 1);
  assert.ok(musicEnergy(.008) > .2);
  assert.ok(musicEnergy(.04) > musicEnergy(.008));
  assert.notEqual(ring(616, 234, 1, musicEnergy(.008), .7), ring(616, 234, 2, musicEnergy(.008), .7));
});
