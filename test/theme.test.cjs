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

const { DEFAULT_SURFACE_COLOR, palette, contrast } = require('../src/shared/theme.js');
const { DEFAULT_PREFERENCES } = require('../src/window-state.cjs');
const { validatePreferences, exportSettings, importSettings } = require('../src/customization.cjs');
const { AppProfiles } = require('../src/app-profiles.cjs');
test('glass surfaces preserve the chosen hue and produce readable text in light, dark and saturated palettes', () => {
  const grays = Array.from({ length: 256 }, (_, value) => '#' + value.toString(16).padStart(2, '0').repeat(3));
  for (const color of [...grays, '#e8edf3', '#123456', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']) {
    const glass = palette(color), tokens = glass.tokens;
    assert.equal(tokens['--surface-color'], color);
    assert.ok(['light', 'dark'].includes(glass.appearance));
    assert.ok(contrast(tokens['--text'], tokens['--app-bg']) >= 4.5, `${color}: primary text`);
    assert.ok(contrast(tokens['--muted'], tokens['--app-bg']) >= 4.5, `${color}: secondary text`);
    const rgb = /rgba\((\d+), (\d+), (\d+),/.exec(tokens['--glass-panel']);
    const panel = '#' + rgb.slice(1).map(value => Number(value).toString(16).padStart(2, '0')).join('');
    assert.ok(contrast(tokens['--text'], panel) >= 4.5, `${color}: inset text`);
    assert.ok(contrast(tokens['--muted'], panel) >= 4.5, `${color}: inset secondary text`);
  }
  assert.equal(palette('#000000').appearance, 'dark');
  assert.equal(palette('#ffffff').appearance, 'light');
  for (const value of ['red', '#fff', null, NaN, {}, 'url(file:///private)']) assert.throws(() => palette(value));
});
test('surface palette migrates independently of existing accents and round-trips through portable settings', () => {
  assert.equal(preferences({ color: '#438bff' }).surfaceColor, DEFAULT_SURFACE_COLOR);
  assert.equal(preferences({ surfaceColor: '#203040' }).color, '#ff3045');
  assert.equal(preferences({ surfaceColor: '#22C55E' }).surfaceColor, '#22c55e');
  for (const value of ['#fff', 'red', null, 42]) {
    assert.equal(preferences({ surfaceColor: value }).surfaceColor, DEFAULT_SURFACE_COLOR);
    assert.throws(() => validatePreferences({ surfaceColor: value }, DEFAULT_PREFERENCES));
  }
  const original = { ...preferences({ color: '#ff9f30', surfaceColor: '#203040' }), shortcuts: require('../src/shared/shortcuts.js').DEFAULT_BINDINGS };
  const restored = importSettings(JSON.stringify(exportSettings(original, preferences)), preferences, DEFAULT_PREFERENCES);
  assert.equal(restored.surfaceColor, '#203040'); assert.equal(restored.color, '#ff9f30');
  const legacy = exportSettings(original, preferences); delete legacy.preferences.surfaceColor;
  assert.equal(importSettings(JSON.stringify(legacy), preferences, DEFAULT_PREFERENCES).surfaceColor, DEFAULT_SURFACE_COLOR);
});
test('per-application surface palettes stay isolated from the base appearance and survive profile normalization', () => {
  const base = preferences({ color: '#438bff', surfaceColor: '#e8edf3' });
  const profiles = new AppProfiles({ enabled: true, items: [{ name: 'Game', executable: 'game.exe', preferences: { ...base, surfaceColor: '#203040' } }] });
  profiles.observe('game.exe'); assert.equal(profiles.effective(base).surfaceColor, '#203040');
  profiles.edit({ surfaceColor: '#ffeedd' }, base); assert.equal(base.surfaceColor, '#e8edf3');
  const reopened = new AppProfiles(profiles.saved()); reopened.observe('game.exe');
  assert.equal(reopened.effective(base).surfaceColor, '#ffeedd'); assert.equal(reopened.effective(base).color, '#438bff');
  reopened.observe('other.exe'); assert.equal(reopened.effective(base).surfaceColor, '#e8edf3');
});

test('very dark glass panels remain visibly raised above the selected dark background', () => {
  for (const color of ['#000000', '#101820', '#202632', '#404040']) {
    const tokens = palette(color).tokens;
    const panel = /rgba\((\d+), (\d+), (\d+),/.exec(tokens['--glass-panel']).slice(1).map(Number);
    const background = [1, 3, 5].map(index => parseInt(tokens['--app-bg'].slice(index, index + 2), 16));
    assert.ok(panel.every((channel, index) => channel >= background[index]), `${color}: raised panel channels`);
    assert.ok(panel.some((channel, index) => channel - background[index] >= 8), `${color}: distinct inset surface`);
  }
  assert.equal(palette('#000000').tokens['--app-bg'], '#000000', 'Lifting a panel must not replace the selected black background');
});
