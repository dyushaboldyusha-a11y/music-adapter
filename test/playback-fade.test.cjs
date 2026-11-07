const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PlaybackFade } = require('../browser-extension/playback-fade.js');
function fixture(overrides = {}) {
  let now = 0;
  const state = { connected: true, source: { id: 'one' }, title: 'Song', artist: 'Artist', volume: .7, playing: true, muted: false, capabilities: { volume: true }, ...overrides }, calls = [];
  const send = async (action, value, target) => { calls.push([action, value, target.source.id]); if (action === 'volume') state.volume = value; if (action === 'playPause') state.playing = !state.playing; };
  const fade = new PlaybackFade(() => state, send, { now: () => now, sleep: async ms => { now += ms; } });
  return { state, calls, fade };
}
test('pause reaches silence before stopping and restores the saved volume; resume starts silently', async () => {
  const { state, calls, fade } = fixture();
  await fade.command('playPause', undefined, { enabled: true });
  const pause = calls.findIndex(c => c[0] === 'playPause');
  assert.equal(calls[pause - 1][1], 0); assert.equal(state.playing, false); assert.equal(state.volume, .7);
  assert.ok(calls.slice(0, pause).every((c, i, all) => i === 0 || c[1] <= all[i - 1][1]));
  calls.length = 0;
  await fade.command('playPause', undefined, { enabled: true });
  assert.deepEqual(calls.slice(0, 2), [['volume', 0, 'one'], ['playPause', undefined, 'one']]);
  assert.ok(calls.slice(2).every(c => c[1] > 0 && c[1] <= .7));
  assert.equal(state.playing, true); assert.equal(state.volume, .7);
});
test('unsupported volume, mute, zero and disabled fades keep ordinary transport and mute intact', async () => {
  for (const override of [{ capabilities: {} }, { volume: null }, { volume: 0 }, { muted: true }]) {
    const { fade, calls, state } = fixture(override); await fade.command('playPause', undefined, { enabled: true });
    assert.deepEqual(calls.map(c => c[0]), ['playPause']); assert.equal(state.muted, override.muted === true);
  }
  const { fade, calls } = fixture(); await fade.command('playPause'); assert.deepEqual(calls.map(c => c[0]), ['playPause']);
});
test('rapid pause/resume and a manual volume edit serialize without losing the chosen volume', async () => {
  const { fade, state } = fixture();
  await Promise.all([fade.command('playPause', undefined, { enabled: true }), fade.command('playPause', undefined, { enabled: true }), fade.command('volume', .3)]);
  assert.equal(state.volume, .3); assert.equal(state.playing, true);
});
test('failed transport restores volume and leaves the queue usable', async () => {
  const { fade, state } = fixture(), send = fade.send;
  fade.send = async (action, ...args) => { if (action === 'playPause') throw new Error('Disconnected'); return send(action, ...args); };
  await assert.rejects(fade.command('playPause', undefined, { enabled: true }), /Disconnected/);
  assert.equal(state.volume, .7);
  fade.send = send; await fade.command('playPause'); assert.equal(state.playing, false);
});
test('source changes restore the original source immediately, and cancel delayed or queued toggles', async () => {
  const { fade, state, calls } = fixture(); let wake;
  fade.sleep = () => new Promise(resolve => { wake = resolve; });
  const changing = fade.command('playPause', undefined, { enabled: true });
  const queued = fade.command('next');
  await Promise.resolve(); await Promise.resolve();
  state.source = { id: 'two' };
  const restoration = fade.observe(state);
  assert.deepEqual(calls.at(-1), ['volume', .7, 'one'], 'Restoration must be sent before the native audio target is reconfigured');
  wake(); await restoration;
  await assert.rejects(changing, /прерван/); await assert.rejects(queued, /изменился/);
  assert.equal(calls.some(c => c[0] === 'playPause' || c[2] === 'two'), false);
});
test('shutdown during fade restores volume and rejects queued operations', async () => {
  const { fade, state } = fixture(); let wake;
  fade.sleep = () => new Promise(resolve => { wake = resolve; });
  const changing = fade.command('playPause', undefined, { enabled: true }); await Promise.resolve(); await Promise.resolve();
  await fade.stop(); wake(); await assert.rejects(changing); assert.equal(state.volume, .7);
  await assert.rejects(fade.command('next'));
});
test('an external pause during fade-out cannot accidentally start the player again', async () => {
  const { fade, state, calls } = fixture(), sleep = fade.sleep;
  fade.sleep = async ms => { await sleep(ms); state.playing = false; };
  await fade.command('playPause', undefined, { enabled: true });
  assert.equal(state.playing, false); assert.equal(state.volume, .7); assert.equal(calls.some(c => c[0] === 'playPause'), false);
});
