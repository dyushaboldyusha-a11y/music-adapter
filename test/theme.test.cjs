const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeColor, toHsv, fromHsv, fromPoint } = require('../src/shared/theme.js');
const { preferences } = require('../src/window-state.cjs');
test('theme colors round-trip through the wheel, including grayscale and dark colors', () => {
  for (const color of ['#ff3045', '#22c55e', '#438bff', '#000000', '#ffffff', '#808080', '#123456']) assert.equal(fromHsv(toHsv(color)), color);
  assert.equal(fromHsv({ h: 360, s: 1, v: 1 }), '#ff0000');
  assert.equal(fromHsv({ h: -120, s: 1, v: 1 }), '#0000ff');
  assert.equal(fromHsv({ ...toHsv('#438bff'), v: .5 }), '#224680');
  assert.equal(normalizeColor('#22C55E'), '#22c55e');
  assert.equal(preferences({ color: '#22C55E' }).color, '#22c55e');
  for (const value of ['red', '#fff', 'url(https://example.com)', 42, null]) { assert.throws(() => normalizeColor(value)); assert.equal(preferences({ color: value }).color, '#ff3045'); }
});
test('wheel coordinates follow the displayed hues and clamp saturation outside the circle', () => {
  assert.deepEqual(fromPoint(0, 0, 100), { h: 0, s: 0 });
  assert.deepEqual(fromPoint(100, 0, 100), { h: 0, s: 1 });
  assert.deepEqual(fromPoint(0, 200, 100), { h: 90, s: 1 });
  assert.deepEqual(fromPoint(-100, 0, 100), { h: 180, s: 1 });
  assert.deepEqual(fromPoint(0, -50, 100), { h: 270, s: .5 });
});
