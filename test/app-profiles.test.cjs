const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AppProfiles } = require('../src/app-profiles.cjs');
const { preferences } = require('../src/window-state.cjs');
const item = (executable = 'game.exe', changes = {}) => ({ executable, name: 'Игра', preferences: preferences({ compact: true, scale: .5, ...changes }) });
test('foreground profiles match exact executable names, restore base and ignore our settings window', () => {
  const profiles = new AppProfiles({ enabled: true, items: [item(), item('editor.exe', { scale: 1.5 })] });
  const base = preferences({ color: '#123456' });
  assert.equal(profiles.observe('GAME.EXE', 'Liberty Wave.exe'), true);
  assert.equal(profiles.effective(base).scale, .5);
  assert.equal(profiles.observe('Liberty Wave.exe', 'Liberty Wave.exe'), false);
  assert.equal(profiles.snapshot().active, 'game.exe');
  profiles.observe('editor.exe'); assert.equal(profiles.effective(base).scale, 1.5);
  profiles.observe('other-game.exe'); assert.deepEqual(profiles.effective(base), base);
  profiles.observe('game.exe'); profiles.observe(''); assert.deepEqual(profiles.effective(base), base);
});
test('editing an active profile persists only there and disabling or removing it restores base', () => {
  const profiles = new AppProfiles({ enabled: true, items: [item()] }), base = preferences({ scale: 1.25 });
  profiles.observe('game.exe'); profiles.edit({ scale: .75, waveEconomy: true }, base);
  assert.equal(base.scale, 1.25); assert.equal(profiles.effective(base).scale, .75);
  const restored = new AppProfiles(JSON.parse(JSON.stringify(profiles.saved())));
  restored.observe('game.exe'); assert.equal(restored.effective(base).waveEconomy, true);
  restored.configure({ ...restored.saved(), enabled: false }); assert.equal(restored.effective(base).scale, 1.25);
  profiles.configure({ enabled: true, items: [] }); assert.equal(profiles.snapshot().active, null);
  profiles.edit({ compact: true }, base); assert.equal(base.compact, true);
});
test('profile validation is atomic and cannot load executable paths, duplicate names or arbitrary settings', () => {
  const profiles = new AppProfiles({ enabled: true, items: [item()] });
  for (const items of [[item('C:\\game.exe')], [item('../game.exe')], [item('game.exe'), item('GAME.exe')], [{ ...item(), preferences: { launch: 'cmd.exe' } }]]) {
    assert.throws(() => profiles.configure({ enabled: false, items }));
    assert.equal(profiles.enabled, true); assert.equal(profiles.items.length, 1);
  }
  assert.deepEqual(new AppProfiles({ items: [{ bad: true }] }).saved(), { enabled: false, items: [] });
});
test('profile positions remain separate from the base and survive normalization and restart', () => {
  const profiles = new AppProfiles({ enabled: true, items: [item()] });
  const base = { ...preferences(), bounds: { x: 20, y: 40, width: 620, height: 270 } };
  profiles.observe('game.exe');
  profiles.setBounds('bounds', { x: -1000, y: 80, width: 310, height: 135 }, base);
  assert.equal(base.bounds.x, 20); assert.equal(profiles.effective(base).bounds.x, -1000);
  const restored = new AppProfiles(profiles.saved()); restored.observe('game.exe');
  assert.equal(restored.effective(base).bounds.x, -1000);
  restored.observe('other.exe'); assert.equal(restored.effective(base).bounds.x, 20);
  assert.throws(() => profiles.configure({ enabled: true, items: [{ ...item(), positions: { bounds: { x: Infinity } } }] }));
});
