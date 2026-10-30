const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = require('../browser-extension/services.js');
const source = fs.readFileSync(require.resolve('../browser-extension/player-world.js'), 'utf8');
function player(url, media) {
  const messages = [], listeners = [], timers = [], original = new Map();
  const session = { metadata: { title: 'Track', artist: 'Artist', artwork: [] }, playbackState: 'playing', setActionHandler: (action, fn) => original.set(action, fn), setPositionState: () => {} };
  const window = { postMessage: data => messages.push(data), addEventListener: (_type, fn) => listeners.push(fn) };
  const context = { window, navigator: { mediaSession: session }, location: new URL(url), document: { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => media ? [media] : [], title: 'Page' }, performance: { now: () => 1000 }, queueMicrotask: fn => fn(), setInterval: fn => timers.push(fn), URL, LibertyServices: api, getComputedStyle: () => ({ backgroundImage: 'none' }) };
  vm.runInNewContext(source, context);
  return { session, messages, original, publish: () => timers[0](), command: async (command, value) => listeners[0]({ source: window, origin: new URL(url).origin, data: { channel: 'liberty-player-v1', type: 'command', id: 'command-1', command, value } }) };
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
test('unsupported controls stay unavailable and live video is represented without a fake duration', async () => {
  const media = { currentSrc: 'blob:video', paused: false, ended: false, muted: false, readyState: 4, duration: Infinity, currentTime: 10, seekable: { length: 0 }, pause() { this.paused = true; }, async play() { this.paused = false; } };
  const p = player('https://www.youtube.com/watch?v=abcdefghijk', media); p.publish();
  assert.equal(p.messages.at(-1).state.live, true); assert.equal(p.messages.at(-1).state.capabilities.next, false);
  await p.command('next'); assert.equal(p.messages.at(-1).ok, false);
  await p.command('playPause'); assert.equal(media.paused, true);
});
