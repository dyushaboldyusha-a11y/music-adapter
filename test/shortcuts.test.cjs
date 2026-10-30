const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_BINDINGS, normalizeBindings, normalizeAccelerator, fromEvent, readBindings } = require('../src/shared/shortcuts.js');
const { ShortcutManager } = require('../src/shortcuts.cjs');
function setup(saved) {
  const callbacks = new Map(), occupied = new Set(), calls = [];
  const registry = { register(key, callback) { if (occupied.has(key) || callbacks.has(key)) return false; callbacks.set(key, callback); return true; }, unregister(key) { callbacks.delete(key); } };
  const manager = new ShortcutManager(registry, { toggleInteraction: () => calls.push('control'), playPause: () => calls.push('pause'), next: () => calls.push('next'), previous: () => calls.push('previous') }, saved);
  manager.resume(); return { manager, callbacks, occupied, calls };
}
test('shortcut capture uses physical keys with Cyrillic layouts and distinguishes numpad', () => {
  assert.equal(fromEvent({ code: 'KeyS', key: 'ы', ctrlKey: true, altKey: true }), 'Control+Alt+S');
  assert.equal(fromEvent({ code: 'Digit8', shiftKey: true }), 'Shift+8');
  assert.equal(fromEvent({ code: 'Numpad8', key: 'ArrowUp' }), 'num8');
  assert.equal(fromEvent({ code: 'F9' }), 'F9');
  assert.equal(fromEvent({ code: 'ShiftLeft', shiftKey: true }), null);
  assert.equal(normalizeAccelerator('shift+ctrl+k'), 'Control+Shift+K');
});
test('shortcut validation rejects duplicate actions, malformed and reserved combinations', () => {
  assert.throws(() => normalizeBindings({ toggleInteraction: 'Ctrl+K', playPause: 'Control+K' }), /разные/);
  assert.throws(() => normalizeBindings({ toggleInteraction: '', playPause: 'F9' }), /Назначьте/);
  for (const value of ['Alt+Tab', 'Control+Alt+Delete', 'Win+L', 'Ctrl+Ctrl+K', 'Ctrl+unknown']) assert.throws(() => normalizeAccelerator(value));
  assert.throws(() => normalizeBindings({ ...DEFAULT_BINDINGS, command: 'quit' }));
  assert.deepEqual(readBindings({ toggleInteraction: 42 }), DEFAULT_BINDINGS);
});
test('global shortcuts dispatch two separate actions and migrate existing Num8 users', () => {
  const { manager, callbacks, calls } = setup();
  callbacks.get('Control+Shift+8')(); callbacks.get('num8')(); callbacks.get('Control+Shift+Space')();
  assert.deepEqual(calls, ['control', 'control', 'pause']);
  manager.configure({ toggleInteraction: 'F8', playPause: 'F9' });
  assert.equal(callbacks.has('num8'), false); assert.equal(callbacks.has('Control+Shift+8'), false);
  callbacks.get('F8')(); callbacks.get('F9')(); assert.deepEqual(calls.slice(-2), ['control', 'pause']);
});
test('a busy new key rolls back every registration and preserves previous working shortcuts', () => {
  const { manager, callbacks, occupied } = setup(); occupied.add('F9');
  assert.throws(() => manager.configure({ toggleInteraction: 'F8', playPause: 'F9' }), /занято/);
  assert.deepEqual(manager.snapshot().bindings, DEFAULT_BINDINGS);
  assert.equal(callbacks.has('F8'), false); assert.equal(callbacks.has('Control+Shift+8'), true); assert.equal(callbacks.has('Control+Shift+Space'), true);
});
test('recording suspends all global actions; cancellation restores them and saving can swap keys', () => {
  const { manager, callbacks, calls } = setup({ toggleInteraction: 'F8', playPause: 'F9' });
  const old = callbacks.get('F8'); manager.suspend(); old(); assert.equal(calls.length, 0); assert.equal(callbacks.size, 0);
  manager.resume(); callbacks.get('F8')(); assert.deepEqual(calls, ['control']);
  manager.configure({ toggleInteraction: 'F9', playPause: 'F8' }); callbacks.get('F8')(); callbacks.get('F9')(); assert.deepEqual(calls, ['control', 'pause', 'control']);
});
test('a failed save while recording stays suspended until cancellation, and playback bind can be disabled', () => {
  const { manager, callbacks, occupied } = setup(); manager.suspend(); occupied.add('F9');
  assert.throws(() => manager.configure({ toggleInteraction: 'F8', playPause: 'F9' })); assert.equal(callbacks.size, 0); assert.equal(manager.snapshot().suspended, true);
  manager.resume(); assert.equal(callbacks.has('Control+Shift+8'), true);
  manager.configure({ toggleInteraction: 'F8', playPause: '' }); assert.equal(callbacks.size, 1); assert.equal(manager.snapshot().available.playPause, false);
  manager.stop(); assert.equal(callbacks.size, 0);
});
test('a busy legacy Num8 does not prevent saving valid shortcuts without a numpad', () => {
  const { manager, callbacks, occupied } = setup(); manager.suspend(); occupied.add('num8');
  manager.configure(DEFAULT_BINDINGS); assert.equal(callbacks.has('Control+Shift+8'), true); assert.equal(callbacks.has('num8'), false);
});
test('0.4.0 bindings migrate without changing existing keys or enabling new global keys', () => {
  const saved = { toggleInteraction: 'F8', playPause: '' };
  const { manager, callbacks } = setup(saved);
  assert.deepEqual(manager.snapshot().bindings, { ...DEFAULT_BINDINGS, ...saved });
  assert.deepEqual([...callbacks.keys()], ['F8']);
});
test('next and previous dispatch independently and cannot duplicate any existing action', () => {
  const { manager, callbacks, calls } = setup();
  const bindings = { toggleInteraction: 'F8', playPause: 'F9', next: 'F10', previous: 'F11' };
  manager.configure(bindings); callbacks.get('F10')(); callbacks.get('F11')();
  assert.deepEqual(calls, ['next', 'previous']);
  assert.throws(() => manager.configure({ ...bindings, previous: 'F10' }), /разные/);
  assert.throws(() => manager.configure({ ...bindings, next: 'F8' }), /разные/);
  assert.deepEqual(manager.snapshot().bindings, { ...DEFAULT_BINDINGS, ...bindings });
  manager.configure({ ...bindings, next: '', previous: '' });
  assert.equal(callbacks.has('F10'), false); assert.equal(callbacks.has('F11'), false);
});
test('failure on the fourth binding rolls back all newly registered keys', () => {
  const { manager, callbacks, occupied } = setup(); occupied.add('F11');
  assert.throws(() => manager.configure({ toggleInteraction: 'F8', playPause: 'F9', next: 'F10', previous: 'F11' }), /занято/);
  assert.deepEqual(manager.snapshot().bindings, DEFAULT_BINDINGS);
  for (const key of ['F8', 'F9', 'F10']) assert.equal(callbacks.has(key), false);
  assert.equal(callbacks.has('Control+Shift+8'), true);
});
