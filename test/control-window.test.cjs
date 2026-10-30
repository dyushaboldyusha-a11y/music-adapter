const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ControlWindow, controlBounds } = require('../src/control-window.cjs');
test('desktop control window returns to a reachable display and fits small game resolutions', () => {
  for (const area of [{ x: 0, y: 0, width: 1440, height: 900 }, { x: -1280, y: 0, width: 1280, height: 720 }, { x: 0, y: 0, width: 640, height: 480 }]) {
    for (const saved of [null, { x: 3000, y: -1000, width: 5000, height: 2000 }, { x: NaN, y: 20, width: Infinity, height: 700 }]) {
      const bounds = controlBounds(saved, [{ workArea: area }]);
      assert.ok(bounds.x >= area.x && bounds.y >= area.y);
      assert.ok(bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
    }
  }
});
test('desktop IPC rejects the widget, child frames and hidden windows', async () => {
  const handlers = new Map(), ipcMain = { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) };
  let called = 0;
  const controller = new ControlWindow({ ipcMain, getState: () => ({ title: 'Track' }), action: () => { called++; return { ok: true }; } });
  const frame = {}, contents = { mainFrame: frame };
  let visible = true;
  controller.window = { webContents: contents, isDestroyed: () => false, isVisible: () => visible };
  const command = handlers.get('control:action'), getState = handlers.get('control:get-state');
  assert.equal(getState({ sender: {}, senderFrame: frame }), null);
  assert.equal((await command({ sender: contents, senderFrame: {} }, 'preferences', { opacity: .25 })).ok, false);
  assert.equal(called, 0);
  const event = { sender: contents, senderFrame: frame };
  assert.equal((await command(event, 'preferences', { opacity: .25 })).ok, true); assert.equal(called, 1);
  visible = false; assert.equal((await command(event, 'preferences', { opacity: 1 })).ok, false); assert.equal(called, 1);
});
