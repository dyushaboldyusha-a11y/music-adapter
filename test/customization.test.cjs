const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nickname, exportSettings, importSettings, validatePreferences } = require('../src/customization.cjs');
const { preferences, DEFAULT_PREFERENCES, layoutForDisplays, snapBounds } = require('../src/window-state.cjs');
const { DEFAULT_BINDINGS } = require('../src/shared/shortcuts.js');
const { artworkColor } = require('../src/artwork-color.cjs');
const { AutoHide } = require('../src/auto-hide.cjs');
test('nickname validates Unicode characters, persists twelve symbols and rejects control text', () => {
  assert.equal(nickname('  Свободен1234  '), 'Свободен1234');
  assert.equal(nickname('😀'.repeat(12)), '😀'.repeat(12));
  for (const value of ['', ' ', 'a'.repeat(13), 'evil\nname', '<script>', 'a\u202eb']) assert.throws(() => nickname(value));
  assert.equal(preferences({ nickname: 'Игрок' }).nickname, 'Игрок');
  assert.equal(preferences({ nickname: 'a'.repeat(13) }).nickname, 'Liberty');
});
test('custom settings validate types and migrate old profiles without changing manual colors', () => {
  const p = preferences({ color: '#438bff' });
  assert.equal(p.colorMode, 'manual'); assert.equal(p.color, '#438bff'); assert.equal(p.showArtwork, true); assert.equal(p.autoHide, false);
  for (const value of [{ nickname: null }, { showArtwork: 1 }, { colorMode: 'remote' }, { monitor: 'https://example.com' }, { autoHideDelay: NaN }, { token: 'private' }]) assert.throws(() => validatePreferences(value, DEFAULT_PREFERENCES));
});
test('artwork colors use dominant opaque colored pixels and fall back for grayscale or empty art', () => {
  const red = Buffer.from([10, 20, 230, 255]), blue = Buffer.from([240, 60, 10, 255]), black = Buffer.from([0, 0, 0, 255]);
  const color = artworkColor(Buffer.concat([blue, blue, blue, red, black]), '#ff3045');
  assert.ok(parseInt(color.slice(5,7),16) > parseInt(color.slice(1,3),16));
  assert.equal(artworkColor(Buffer.from([120,120,120,255,255,255,255,255]), '#438bff'), '#438bff');
  assert.equal(artworkColor(Buffer.from([240,60,10,0]), '#ff3045'), '#ff3045');
});
test('export imports only portable settings and excludes browser tokens and other private files', () => {
  const saved = { ...preferences({ nickname: 'Wave', colorMode: 'artwork', showTime: false }), shortcuts: DEFAULT_BINDINGS, bounds: { x: -900, y: 30, width: 620, height: 270 }, browserToken: 'private', email: 'private' };
  const text = JSON.stringify(exportSettings(saved, preferences));
  assert.ok(!text.includes('private'));
  const imported = importSettings(text, preferences, DEFAULT_PREFERENCES);
  assert.equal(imported.nickname, 'Wave'); assert.equal(imported.colorMode, 'artwork'); assert.equal(imported.showTime, false); assert.equal(imported.bounds.x, -900);
  assert.deepEqual(imported.shortcuts, DEFAULT_BINDINGS);
  for (const value of [text.replace('"version":1','"version":99'), text.replace('"positions":{','"positions":{"__proto__":{},'), '{"token":"secret"}', 'x'.repeat(65537)]) assert.throws(() => importSettings(value, preferences, DEFAULT_PREFERENCES));
});
test('auto hide keeps the original pause deadline, cancels on playback and reveals for editing', () => {
  let now = 0, job; const events = [];
  const hide = new AutoHide(value => events.push(value), { now: () => now, schedule: (callback, wait) => { job = { callback, wait }; return job; }, cancel: () => {} });
  const p = { autoHide: true, autoHideDelay: 5, playing: false, interaction: false };
  hide.update(p); assert.equal(job.wait, 5000);
  now = 2000; hide.update(p); assert.equal(job.wait, 3000);
  now = 5000; job.callback(); assert.equal(hide.hidden, true);
  hide.update({ ...p, playing: true }); assert.equal(hide.hidden, false);
  hide.update(p); now = 10000; job.callback(); hide.update({ ...p, interaction: true });
  assert.equal(hide.hidden, false); assert.deepEqual(events, [true, false, true, false]); hide.dispose();
});
test('selected monitors and snapping support negative coordinates and small work areas', () => {
  const displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1440, height: 1000 } }, { id: 2, workArea: { x: -1024, y: 0, width: 1024, height: 728 } }];
  const b = { x: -1010, y: 19, width: 620, height: 270 };
  const snapped = snapBounds(b, displays, { snapEnabled: true, edgeMargin: 16, monitor: '2' });
  assert.equal(snapped.x, -1008); assert.equal(snapped.y, 16);
  assert.deepEqual(snapBounds(b, displays, { snapEnabled: false }), b);
  const moved = layoutForDisplays({ x: 100, y: 100 }, displays, 1, undefined, { monitor: '2' });
  assert.ok(moved.bounds.x < 0); assert.ok(moved.bounds.x + moved.bounds.width <= 0);
  const removed = layoutForDisplays(moved.bounds, [displays[0]], 1, undefined, { monitor: '2' });
  assert.ok(removed.bounds.x >= 0);
  const vertical = [{ id: 1, workArea: { x: 0, y: 0, width: 1440, height: 1000 } }, { id: 2, workArea: { x: 0, y: 1000, width: 1440, height: 1000 } }];
  assert.equal(snapBounds({ x: 17, y: 1018, width: 620, height: 270 }, vertical, { snapEnabled: true, edgeMargin: 16 }).y, 1016);
});
