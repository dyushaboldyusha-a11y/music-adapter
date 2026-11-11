const { test } = require('node:test');
const assert = require('node:assert/strict');
const { glassWindowOptions } = require('../src/glass-window.cjs');
const { palette } = require('../src/shared/theme.js');
const { ControlWindow } = require('../src/control-window.cjs');

test('native glass is restricted to supported Windows builds; older systems retain the chosen opaque color', () => {
  assert.deepEqual(glassWindowOptions('#eef0f4', { platform: 'win32', release: '10.0.22621' }), { backgroundColor: '#00000000', backgroundMaterial: 'acrylic' });
  for (const options of [{ platform: 'win32', release: '10.0.19045' }, { platform: 'win32', release: '10.0.22000' }, { platform: 'linux', release: '6.8.0' }, { platform: 'darwin', release: '24.0.0' }, { platform: 'win32', release: 'unknown' }]) {
    const actual = glassWindowOptions('#182c42', options);
    assert.deepEqual(actual, { backgroundColor: palette('#182c42').tokens['--app-bg'] });
    assert.match(actual.backgroundColor, /^#[a-f0-9]{6}$/i);
  }
});

test('opaque fallback follows palette changes without repainting the native background on every media update', () => {
  let color = '#102030'; const colors = [], sent = [];
  const controller = new ControlWindow({ ipcMain: { handle() {} }, getState: () => ({ preferences: { surfaceColor: color } }) });
  controller.window = { isDestroyed: () => false, setBackgroundColor: value => colors.push(value), webContents: { send: (...args) => sent.push(args) } };
  controller.publish(); controller.publish();
  assert.deepEqual(colors, [palette(color).tokens['--app-bg']]);
  color = '#f2dce5'; controller.publish();
  assert.equal(colors[1], palette(color).tokens['--app-bg']); assert.equal(sent.length, 3);
  controller.nativeGlass = true; color = '#000000'; controller.publish();
  assert.equal(colors.length, 2, 'Native Acrylic stays transparent while CSS handles palette updates');
});
