import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'liberty-automation-'));
let app;
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--disable-gpu', `--user-data-dir=${profile}`] });
  const widget = await app.firstWindow();
  await widget.waitForFunction(() => !!window.musicWidget);
  await widget.evaluate(() => musicWidget.openControls('home'));
  const deadline = Date.now() + 10000;
  while (!app.windows().some(page => page.url().endsWith('/control/index.html')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  const control = app.windows().find(page => page.url().endsWith('/control/index.html'));
  assert.ok(control); await control.waitForFunction(() => !!window.libertyControl && !!document.getElementById('profile-form'));
  return { control, widget, action: (name, value) => control.evaluate(({ name, value }) => libertyControl.action(name, value), { name, value }) };
}
try {
  let { control, action } = await launch();
  assert.equal(await control.locator('#voice-enabled').isChecked(), false);
  assert.equal(await control.locator('#voice-enabled').isDisabled(), process.platform !== 'win32');
  assert.equal((await action('preferences', { compact: true, scale: .75 })).ok, true);
  await control.locator('#profile-name').fill('Моя игра'); await control.locator('#profile-exe').fill('GAME.exe');
  await control.locator('#profile-form button').click();
  await control.waitForFunction(async () => (await libertyControl.getState()).appProfiles.items.length === 1);
  const saved = await control.evaluate(async () => (await libertyControl.getState()).appProfiles);
  assert.equal(saved.items[0].executable, 'game.exe'); assert.equal(saved.items[0].preferences.compact, true); assert.equal(saved.items[0].preferences.scale, .75);
  assert.equal((await action('profiles', { enabled: true, items: [...saved.items, saved.items[0]] })).ok, false);
  assert.equal((await action('profiles', { enabled: false, items: [{ ...saved.items[0], executable: '../game.exe' }] })).ok, false);
  assert.equal((await action('preferences', { compact: false, scale: 1 })).ok, true);
  await control.locator('[data-page="shortcuts"]').click();
  assert.equal(await control.locator('#bind-voiceHold').count(), 1);
  const bindings = await control.evaluate(async () => (await libertyControl.getState()).shortcuts.bindings);
  assert.equal((await action('shortcuts', { ...bindings, voiceHold: 'Control+Alt+F7' })).ok, true);
  await app.close(); app = null;
  const file = JSON.parse(await readFile(join(profile, 'widget.json'), 'utf8'));
  assert.equal(file.appProfiles.items[0].preferences.scale, .75); assert.equal(file.scale, 1);
  assert.equal(file.shortcuts.voiceHold, 'Control+Alt+F7');
  ({ control, action } = await launch());
  const restored = await control.evaluate(() => libertyControl.getState());
  assert.equal(restored.appProfiles.items.length, 1); assert.equal(restored.appProfiles.enabled, false);
  assert.equal(restored.preferences.scale, 1); assert.equal(restored.shortcuts.bindings.voiceHold, 'Control+Alt+F7');
  await control.getByRole('button', { name: 'Удалить профиль Моя игра' }).click();
  await control.waitForFunction(async () => (await libertyControl.getState()).appProfiles.items.length === 0);
  console.log('PASS: real Electron profile editor, exact EXE normalization, validation rollback, profile/base separation, hold binding, deletion and restart persistence. No microphone opened.');
} finally { await app?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
