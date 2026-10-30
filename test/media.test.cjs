const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeState, validateCommand, DemoMedia } = require('../src/media.cjs');
const { clampBounds, preferences, DEFAULT_PREFERENCES } = require('../src/window-state.cjs');

test('rejects invalid IPC actions and nonfinite seek values', () => {
  for (const command of ['eval', 'openExternal', '__proto__', null]) assert.throws(() => validateCommand(command));
  for (const value of [NaN, Infinity, -1, '12', null, 86401]) assert.throws(() => validateCommand('seek', value));
  assert.throws(() => validateCommand('repeat', 'forever'));
  assert.throws(() => validateCommand('shuffle', 'false'));
  assert.doesNotThrow(() => validateCommand('seek', 84.5));
});
test('sanitizes untrusted media metadata, artwork, timeline and capabilities', () => {
  const state = normalizeState({ connected: true, title: 'Трек', position: 1000, duration: 258, artwork: 'https://tracker.invalid/cover', repeat: 'invalid', capabilities: { seek: true, next: 'yes' } });
  assert.equal(state.title, 'Трек'); assert.equal(state.position, 258); assert.equal(state.artwork, null);
  assert.equal(state.capabilities.seek, true); assert.equal(state.capabilities.next, false); assert.equal(state.repeat, 'none');
  assert.equal(normalizeState({ duration: Infinity, position: NaN }).position, 0);
  assert.equal(normalizeState({ artwork: 'data:image/png;base64,iVBORw==' }).artwork, 'data:image/png;base64,iVBORw==');
});
test('demo transport changes playback, metadata, seek, repeat and shuffle', async () => {
  const player = new DemoMedia();
  let snapshot;
  player.on('state', state => { snapshot = state; });
  await player.command('playPause'); assert.equal(snapshot.playing, false);
  await player.command('seek', 200); assert.equal(snapshot.position, 200);
  await player.command('next'); assert.equal(snapshot.title, 'The Perfect Girl'); assert.equal(snapshot.position, 0);
  await player.command('seek', 300); assert.equal(snapshot.position, 194);
  await player.command('previous'); assert.equal(snapshot.title, 'After Dark');
  await player.command('repeat', 'track'); assert.equal(snapshot.repeat, 'track');
  await player.command('shuffle', true); assert.equal(snapshot.shuffle, true);
});
test('keeps a saved widget reachable when a display is unplugged or has negative coordinates', () => {
  const primary = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const left = { workArea: { x: -1920, y: 0, width: 1920, height: 1080 } };
  assert.deepEqual(clampBounds({ x: -1700, y: 70 }, [primary, left]), { width: 620, height: 270, x: -1700, y: 70 });
  assert.equal(clampBounds({ x: -1700, y: 70 }, [primary]).x, 0);
  const result = clampBounds({ x: 1900, y: 2000 }, [primary]);
  assert.equal(result.x, 1300); assert.equal(result.y, 770);
  assert.equal(clampBounds({ x: NaN, y: Infinity }, [primary]).x, 1276);
});
test('limits decoration opacity to 25–100 percent and scales the entire widget', () => {
  assert.deepEqual(preferences({ opacity: .01, scale: 9 }), { ...DEFAULT_PREFERENCES, opacity: .25, scale: 1.75 });
  assert.deepEqual(preferences({ opacity: NaN, scale: Infinity }), DEFAULT_PREFERENCES);
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const large = clampBounds({ x: 1700, y: 1000 }, [display], 1.5);
  assert.deepEqual(large, { width: 930, height: 405, x: 990, y: 675 });
});
test('accepts common native thumbnail formats while rejecting remote or executable image data', () => {
  for (const mime of ['png', 'jpeg', 'webp', 'gif', 'bmp']) {
    const data = `data:image/${mime};base64,aGVsbG8=`;
    assert.equal(normalizeState({ artwork: data }).artwork, data);
  }
  assert.equal(normalizeState({ artwork: 'data:image/svg+xml;base64,aGVsbG8=' }).artwork, null);
});
