const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { layoutForDisplays } = require('../src/window-state.cjs');
const { watchDisplays } = require('../src/display-placement.cjs');
const display = (width, height, x = 0, y = 0) => ({ workArea: { x, y, width, height } });
const inside = (bounds, area) => bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height;

test('restores an off-screen 1920×1080 position into common 4:3 resolutions', () => {
  for (const [width, height] of [[1280, 960], [1024, 768], [800, 600], [640, 480]]) {
    const monitor = display(width, height);
    const result = layoutForDisplays({ x: 1276, y: 700 }, [monitor], 1.75);
    assert.ok(inside(result.bounds, monitor.workArea), `${width}×${height}`);
  }
});
test('restores the requested scale after leaving a smaller game resolution', () => {
  const requested = 1.75;
  const small = layoutForDisplays({ x: 1276, y: 24 }, [display(640, 480)], requested);
  assert.ok(small.scale < requested);
  const desktop = layoutForDisplays(small.bounds, [display(1920, 1080)], requested);
  assert.equal(desktop.scale, requested);
});
test('handles a removed monitor and mixed-DPI DIP coordinates', () => {
  const primary = display(1280, 680);
  const secondary = display(1024, 728, -1024);
  const onSecondary = layoutForDisplays({ x: -900, y: 100 }, [primary, secondary], 1.5);
  assert.ok(inside(onSecondary.bounds, secondary.workArea));
  const removed = layoutForDisplays(onSecondary.bounds, [primary], 1.5);
  assert.ok(inside(removed.bounds, primary.workArea));
});
test('display-mode events reposition and raise the widget without stealing focus', async () => {
  const screen = new EventEmitter();
  let monitors = [display(1920, 1080)];
  screen.getAllDisplays = () => monitors;
  screen.getPrimaryDisplay = () => monitors[0];
  let bounds = { x: 1276, y: 24, width: 620, height: 270 };
  const actions = [];
  const window = { isDestroyed: () => false, isVisible: () => true, getBounds: () => bounds, setBounds: value => { bounds = value; }, webContents: { setZoomFactor: value => actions.push(['zoom', value]) }, setAlwaysOnTop: (...args) => actions.push(['topmost', ...args]), moveTop: () => actions.push(['raise']), showInactive: () => actions.push(['showInactive']), focus: () => { throw new Error('Display changes must not focus the widget'); } };
  const updates = [];
  const placement = watchDisplays(window, screen, { getScale: () => 1, onLayout: layout => updates.push(layout), delay: 1 });
  try {
    monitors = [display(1024, 768)];
    screen.emit('display-metrics-changed', {}, monitors[0], ['bounds', 'workArea', 'scaleFactor']);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(inside(bounds, monitors[0].workArea));
    assert.equal(updates.length, 1);
    assert.ok(actions.some(action => action[0] === 'topmost' && action[1] === true));
    assert.ok(actions.some(action => action[0] === 'raise'));
    assert.ok(!actions.some(action => action[0] === 'showInactive'));
  } finally { placement.dispose(); }
  assert.equal(screen.listenerCount('display-metrics-changed'), 0);
});
