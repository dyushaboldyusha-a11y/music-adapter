const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = require('../browser-extension/services.js');
const source = fs.readFileSync(require.resolve('../browser-extension/player-world.js'), 'utf8');
function player(url, media) {
  const messages = [], listeners = [], timers = [], original = new Map();
  let now = 1000;
  class FakeAudio extends EventTarget {
    constructor() { super(); this.src = this.currentSrc = 'blob:detached'; this.currentTime = 60; this.duration = 180; this.paused = true; this.ended = false; this.muted = false; this.readyState = 4; this.playbackRate = 1; this.seekable = { length: 1 }; }
    async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  }
  const session = { metadata: { title: 'Track', artist: 'Artist', artwork: [] }, playbackState: 'playing', setActionHandler: (action, fn) => original.set(action, fn), setPositionState: () => {} };
  const window = { Audio: FakeAudio, postMessage: data => messages.push(data), addEventListener: (_type, fn) => listeners.push(fn) };
  const context = { window, HTMLMediaElement: FakeAudio, navigator: { mediaSession: session }, location: new URL(url), document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => media ? [media] : [], title: 'Page' }, performance: { now: () => now }, Date: class extends Date { static now() { return 1700000000000 + now; } }, queueMicrotask: fn => fn(), setInterval: fn => timers.push(fn), URL, LibertyServices: api, getComputedStyle: () => ({ backgroundImage: 'none' }) };
  vm.runInNewContext(source, context);
  return { session, messages, original, window, advance: ms => { now += ms; }, publish: () => timers[0](), command: async (command, value) => listeners[0]({ source: window, origin: new URL(url).origin, data: { channel: 'liberty-player-v1', type: 'command', id: 'command-1', command, value } }) };
}
test('web adapters preserve registered handlers and route seek and next on all five services', async () => {
  for (const service of api.services) {
    const p = player(service.url); let next = 0, seek;
    p.session.setActionHandler('nexttrack', () => next++);
    p.session.setActionHandler('seekto', detail => { seek = detail.seekTime; });
    p.session.setPositionState({ duration: 200, position: 20 }); p.publish();
    const state = p.messages.at(-1).state;
    assert.equal(state.title, 'Track'); assert.equal(state.capabilities.next, true); assert.equal(state.capabilities.seek, true);
    assert.ok(p.original.has('nexttrack'), 'Site media handlers must still be registered in the browser');
    await p.command('next'); assert.equal(next, 1); assert.equal(p.messages.at(-1).ok, true);
    await p.command('seek', 90); assert.equal(seek, 90);
  }
});
test('Media Session-only clocks do not reset on pause or count paused time after resume', () => {
  const p = player('https://open.spotify.com/');
  p.session.setPositionState({ duration: 200, position: 20 }); p.advance(5000); p.publish(); assert.equal(p.messages.at(-1).state.position, 25);
  p.session.playbackState = 'paused'; p.publish(); assert.equal(p.messages.at(-1).state.position, 25);
  p.advance(30000); p.publish(); assert.equal(p.messages.at(-1).state.position, 25);
  p.session.playbackState = 'playing'; p.publish(); p.advance(1000); p.publish(); assert.equal(p.messages.at(-1).state.position, 26);
  const sample = p.messages.at(-1).state;
  p.session.setPositionState({ duration: 200, position: 26, playbackRate: 2 }); p.advance(1000); p.publish();
  assert.equal(p.messages.at(-1).state.position, 28); assert.equal(p.messages.at(-1).state.playbackRate, 2);
  assert.ok(p.messages.at(-1).state.sampleSequence > sample.sampleSequence);
});
test('VK detached Audio elements expose time and controls even with text-only Media Session', async () => {
  const p = player('https://vk.com/audio'); const audio = new p.window.Audio(); await audio.play(); p.publish();
  const state = p.messages.at(-1).state;
  assert.equal(state.duration, 180); assert.equal(state.position, 60); assert.equal(state.capabilities.seek, true);
  await p.command('seek', 42); assert.equal(audio.currentTime, 42); assert.ok(p.messages.findLast(m => m.type === 'state').state.timelineEpoch > 0);
  audio.dispatchEvent(new Event('waiting')); p.publish(); assert.equal(p.messages.at(-1).state.playbackRate, 0);
  audio.dispatchEvent(new Event('playing')); p.publish(); assert.equal(p.messages.at(-1).state.playbackRate, 1);
});
test('unsupported controls stay unavailable and live video is represented without a fake duration', async () => {
  const media = { currentSrc: 'blob:video', paused: false, ended: false, muted: false, readyState: 4, duration: Infinity, currentTime: 10, seekable: { length: 0 }, pause() { this.paused = true; }, async play() { this.paused = false; } };
  const p = player('https://www.youtube.com/watch?v=abcdefghijk', media); p.publish();
  assert.equal(p.messages.at(-1).state.live, true); assert.equal(p.messages.at(-1).state.capabilities.next, false);
  await p.command('next'); assert.equal(p.messages.at(-1).ok, false);
  await p.command('playPause'); assert.equal(media.paused, true);
});
