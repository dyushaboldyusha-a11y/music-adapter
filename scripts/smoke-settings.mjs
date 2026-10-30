import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { pressGlobalKeys } from './send-global-keys.mjs';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'liberty-settings-'));
const legacyConfig = await mkdtemp(join(tmpdir(), 'liberty-legacy-profile-'));
let app, browser;
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--disable-gpu', `--user-data-dir=${profile}`] });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.musicWidget);
  await waitState(page, state => state.connected === true);
  return page;
}
async function waitState(page, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const value = await page.evaluate(() => musicWidget.getState()); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Settings or playback state did not reach its expected value');
}
try {
  let page = await launch();
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'Liberty Wave');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  assert.ok((await page.title()).startsWith('Liberty Wave'));
  assert.equal((await page.evaluate(() => musicWidget.getState())).shortcuts.bindings.toggleInteraction, 'Control+Shift+8');
  await page.evaluate(() => musicWidget.openShortcuts());
  await page.locator('#shortcuts').waitFor({ state: 'visible' });
  const wasPlaying = (await page.evaluate(() => musicWidget.getState())).playing;
  await page.locator('#bind-toggleInteraction').click(); await page.keyboard.press('F8');
  await page.locator('#bind-playPause').click(); await page.keyboard.press('F8');
  await page.locator('#shortcut-save').click();
  await page.waitForFunction(() => document.getElementById('shortcut-status').textContent.includes('разные'));
  await page.locator('#bind-playPause').click(); await page.keyboard.press('F9');
  assert.equal((await page.evaluate(() => musicWidget.getState())).playing, wasPlaying, 'Recording must not trigger the previous shortcut');
  await page.locator('#shortcut-save').click();
  await page.locator('#shortcuts').waitFor({ state: 'hidden' });
  await waitState(page, s => s.shortcuts.bindings.toggleInteraction === 'F8' && s.shortcuts.bindings.playPause === 'F9');
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F8') && globalShortcut.isRegistered('F9') && !globalShortcut.isRegistered('num8') && !globalShortcut.isRegistered('Control+Shift+8')), true);

  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.register('F10', () => {})), true);
  await page.evaluate(() => musicWidget.openShortcuts());
  await page.locator('#shortcuts').waitFor({ state: 'visible' });
  await page.locator('#bind-playPause').click(); await page.keyboard.press('F10'); await page.locator('#shortcut-save').click();
  await page.waitForFunction(() => document.getElementById('shortcut-status').textContent.includes('занято'));
  assert.equal((await page.evaluate(() => musicWidget.getState())).shortcuts.bindings.playPause, 'F9');
  await page.keyboard.press('Escape'); await page.locator('#shortcuts').waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F8') && globalShortcut.isRegistered('F9')), true);
  await app.evaluate(({ globalShortcut }) => globalShortcut.unregister('F10'));
  await page.evaluate(() => musicWidget.openShortcuts()); await page.locator('#shortcuts').waitFor({ state: 'visible' });
  await page.locator('#bind-playPause').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#bind-playPause').textContent(), 'F9');
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: join(root, 'artifacts/widget-hotkeys.png') });
  await page.locator('#shortcut-cancel').click(); await page.locator('#shortcuts').waitFor({ state: 'hidden' });

  const originalWave = await page.locator('.edge-wave').evaluate(el => getComputedStyle(el).stroke);
  await page.evaluate(() => musicWidget.openTheme()); await page.locator('#theme').waitFor({ state: 'visible' });
  const wheel = page.locator('#color-wheel');
  await wheel.click({ position: { x: 25, y: 25 } });
  assert.notEqual(await page.locator('#theme-hex').inputValue(), '#ff3045');
  await page.locator('[data-color="#438bff"]').click();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#play-pause').evaluate(el => getComputedStyle(el).color), 'rgb(67, 139, 255)');
  assert.notEqual(await page.locator('.edge-wave').evaluate(el => getComputedStyle(el).stroke), originalWave);
  assert.equal((await page.evaluate(() => musicWidget.getState())).preferences.color, '#ff3045', 'Preview must not persist before Save');
  await page.locator('#theme-hex').fill('#oops'); assert.equal(await page.locator('#theme-save').isDisabled(), true);
  await page.locator('[data-color="#438bff"]').click();
  await page.locator('#theme-brightness').evaluate(el => { el.value = 50; el.dispatchEvent(new Event('input')); });
  assert.equal(await page.locator('#theme-hex').inputValue(), '#224680');
  await page.locator('#theme-cancel').click(); await page.locator('#theme').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.edge-wave').evaluate(el => getComputedStyle(el).stroke), originalWave);

  await page.evaluate(() => musicWidget.openTheme()); await page.locator('#theme').waitFor({ state: 'visible' });
  await page.locator('[data-color="#22c55e"]').click();
  await page.screenshot({ path: join(root, 'artifacts/widget-palette.png') });
  await page.locator('#theme-save').click(); await page.locator('#theme').waitFor({ state: 'hidden' });
  await waitState(page, s => s.preferences.color === '#22c55e');
  assert.equal((await page.evaluate(() => musicWidget.setPreferences({ color: 'url(https://example.com)' }))).ok, false);
  const bounds = await page.locator('#widget').boundingBox();
  await page.screenshot({ path: join(root, 'artifacts/widget-green.png') });
  assert.ok(bounds.height === 202);

  browser = await chromium.launch({ channel: 'chromium', headless: false });
  const other = await browser.newPage(); await other.setContent('<h1>Another application has keyboard focus</h1>'); await other.bringToFront();
  await pressGlobalKeys(['F8']); await waitState(page, s => !s.interaction);
  const playing = (await page.evaluate(() => musicWidget.getState())).playing;
  await pressGlobalKeys(['F9']); await waitState(page, s => s.playing !== playing && !s.interaction);
  await pressGlobalKeys(['F9']); await waitState(page, s => s.playing === playing && !s.interaction);
  assert.equal((await page.evaluate(() => musicWidget.command('next'))).ok, false, 'Pinned mouse/IPC controls must remain blocked');
  await pressGlobalKeys(['F8']); await waitState(page, s => s.interaction);
  await browser.close(); browser = null;
  await app.close(); app = null;
  const saved = JSON.parse(await readFile(join(profile, 'widget.json'), 'utf8'));
  assert.equal(saved.color, '#22c55e'); assert.deepEqual(saved.shortcuts, { toggleInteraction: 'F8', playPause: 'F9' });
  page = await launch();
  const restored = await page.evaluate(() => musicWidget.getState());
  assert.deepEqual(restored.shortcuts.bindings, saved.shortcuts); assert.equal(restored.preferences.color, '#22c55e');
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F8') && globalShortcut.isRegistered('F9')), true);
  if (process.platform === 'linux') {
    await app.close(); app = null;
    const previousProfile = join(legacyConfig, 'music-adapter');
    await mkdir(previousProfile); await writeFile(join(previousProfile, 'widget.json'), JSON.stringify(saved));
    app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--disable-gpu'], env: { ...process.env, XDG_CONFIG_HOME: legacyConfig } });
    page = await app.firstWindow(); await page.waitForFunction(() => !!window.musicWidget);
    const legacy = await waitState(page, state => state.connected);
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), previousProfile);
    assert.deepEqual(legacy.shortcuts.bindings, saved.shortcuts); assert.equal(legacy.preferences.color, saved.color);
  }
  console.log('PASS: editable shortcuts, busy-key rollback, global keys with another app focused, palette, restart persistence, Liberty Wave identity and preservation of the previous profile.');
} finally {
  await browser?.close(); await app?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await rm(legacyConfig, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
