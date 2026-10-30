const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../browser-extension/vk-player.js');
test('VK fallback exposes progress, duration, cover and commands beyond text metadata', async () => {
  let progress = .5, playing = true, next = 0, previous = 0;
  const audio = []; audio[3] = 'VK track'; audio[4] = 'VK artist'; audio[5] = 180; audio[14] = 'https://sun.userapi.com/small.jpg,https://sun.userapi.com/large.jpg';
  const player = { getCurrentAudio: () => audio, getCurrentProgress: () => progress, isPlaying: () => playing, play: () => { playing = true; }, pause: () => { playing = false; }, playNext: () => next++, playPrev: () => previous++, seek: value => { progress = value; } };
  const adapter = create({ getAudioPlayer: () => player });
  const state = adapter.snapshot(); assert.equal(state.position, 90); assert.equal(state.duration, 180); assert.equal(state.artworkUrl, 'https://sun.userapi.com/large.jpg');
  assert.equal(state.capabilities.seek, true);
  await adapter.command('seek', 45); assert.equal(progress, .25);
  await adapter.command('playPause'); assert.equal(playing, false);
  await adapter.command('next'); await adapter.command('previous'); assert.equal(next, 1); assert.equal(previous, 1);
  audio[14] = 'data:image/png;base64,aGVsbG8=';
  assert.equal(adapter.snapshot().artworkUrl, audio[14]);
});
test('VK fallback does not invent controls for missing APIs', () => {
  assert.equal(create({}).snapshot(), null);
  const player = { getCurrentAudio: () => ({ title: 'Track', duration: 60 }), getCurrentProgress: () => ({ currentTime: 15 }) };
  const state = create({ getAudioPlayer: () => player }).snapshot(); assert.equal(state.position, 15); assert.equal(state.capabilities.seek, false); assert.equal(state.capabilities.next, false);
});
test('VK private volume keeps the previous level across mute and rejects invalid levels', async () => {
  let volume = .72;
  const player = { getCurrentAudio: () => ({ title: 'Track', duration: 60 }), getVolume: () => volume, setVolume: value => { volume = value; } };
  const adapter = create({ getAudioPlayer: () => player });
  assert.equal(adapter.snapshot().capabilities.volume, true);
  await adapter.command('mute', true); assert.equal(volume, 0); assert.equal(adapter.snapshot().muted, true);
  await adapter.command('mute', false); assert.equal(volume, .72);
  await adapter.command('volume', .25); assert.equal(volume, .25);
  await assert.rejects(adapter.command('volume', Infinity)); assert.equal(volume, .25);
});
test('an unavailable VK volume API does not erase track metadata or invent a scale', () => {
  const player = { getCurrentAudio: () => ({ title: 'Track', duration: 60 }), getVolume: () => { throw new Error('not ready'); }, setVolume() {} };
  const adapter = create({ getAudioPlayer: () => player });
  assert.equal(adapter.snapshot().title, 'Track'); assert.equal(adapter.snapshot().capabilities.volume, false);
  player.getVolume = () => 72;
  assert.equal(adapter.snapshot().capabilities.volume, false);
});
