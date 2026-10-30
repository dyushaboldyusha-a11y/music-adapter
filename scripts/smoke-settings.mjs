import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pressGlobalKeys } from './send-global-keys.mjs';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const { DEFAULT_BINDINGS } = require('../src/shared/shortcuts.js');
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
  await page.locator('#bind-next').click(); await page.keyboard.press('F10');
  await page.locator('#bind-previous').click(); await page.keyboard.press('F11');
  await page.locator('#shortcut-save').click(); await page.locator('#shortcuts').waitFor({ state: 'hidden' });
  await page.evaluate(() => musicWidget.openShortcuts()); await page.locator('#shortcuts').waitFor({ state: 'visible' });
  const fits = await page.locator('#shortcut-save').evaluate(el => el.getBoundingClientRect().bottom <= el.closest('section').getBoundingClientRect().bottom);
  assert.equal(fits, true, 'All four bindings and Save must fit in the widget');
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

  const updateBytes = Buffer.alloc(256); updateBytes.write('MZ'); updateBytes.writeUInt32LE(128, 60); updateBytes.set([80, 69, 0, 0], 128);
  const updateHash = createHash('sha256').update(updateBytes).digest('hex');
  await app.evaluate(({ protocol }, fixture) => {
    const base = 'https://github.com/dyushaboldyusha-a11y/music-adapter/releases/download/v0.6.0/';
    const name = 'Liberty-Wave-0.6.0-Windows.exe';
    protocol.handle('https', request => {
      if (request.url.includes('/releases/latest')) return new Response(JSON.stringify({ tag_name: 'v0.6.0', assets: [name, 'SHA256SUMS.txt'].map(name => ({ name, state: 'uploaded', size: name.endsWith('.exe') ? fixture.bytes.length : 128, browser_download_url: base + name })) }));
      if (request.url.endsWith('SHA256SUMS.txt')) return new Response(fixture.hash + '  ' + name + '\n');
      if (request.url === base + name) return new Response(new Uint8Array(fixture.bytes));
      return new Response('not found', { status: 404 });
    });
  }, { bytes: [...updateBytes], hash: updateHash });
  await page.evaluate(() => musicWidget.openUpdates()); await page.locator('#updates').waitFor({ state: 'visible' });
  await page.locator('#update-check').click(); await waitState(page, s => s.updates.phase === 'available');
  await page.locator('#update-download').click(); await waitState(page, s => s.updates.phase === 'ready');
  assert.equal(await page.locator('#update-install').isDisabled(), true, 'A development run must not replace an installed executable');
  await page.screenshot({ path: join(root, 'artifacts/widget-updates.png') });
  await page.locator('#update-close').click(); await page.locator('#updates').waitFor({ state: 'hidden' });

  browser = await chromium.launch({ channel: 'chromium', headless: false });
  const other = await browser.newPage(); await other.setContent('<h1>Another application has keyboard focus</h1>'); await other.bringToFront();
  await pressGlobalKeys(['F8']); await waitState(page, s => !s.interaction);
  const playing = (await page.evaluate(() => musicWidget.getState())).playing;
  await pressGlobalKeys(['F9']); await waitState(page, s => s.playing !== playing && !s.interaction);
  await pressGlobalKeys(['F9']); await waitState(page, s => s.playing === playing && !s.interaction);
  const title = (await page.evaluate(() => musicWidget.getState())).title;
  await pressGlobalKeys(['F10']); await waitState(page, s => s.title !== title && !s.interaction);
  await pressGlobalKeys(['F11']); await waitState(page, s => s.title === title && !s.interaction);
  assert.equal((await page.evaluate(() => musicWidget.command('next'))).ok, false, 'Pinned mouse/IPC controls must remain blocked');
  await pressGlobalKeys(['F8']); await waitState(page, s => s.interaction);
  await browser.close(); browser = null;
  await app.close(); app = null;
  const saved = JSON.parse(await readFile(join(profile, 'widget.json'), 'utf8'));
  assert.equal(saved.color, '#22c55e'); assert.deepEqual(saved.shortcuts, { ...DEFAULT_BINDINGS, toggleInteraction: 'F8', playPause: 'F9', next: 'F10', previous: 'F11' });
  page = await launch();
  const restored = await page.evaluate(() => musicWidget.getState());
  assert.deepEqual(restored.shortcuts.bindings, saved.shortcuts); assert.equal(restored.preferences.color, '#22c55e');
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F8') && globalShortcut.isRegistered('F9')), true);
  if (process.platform === 'linux') {
    await app.close(); app = null;
    const previousProfile = join(legacyConfig, 'music-adapter');
    const previousSettings = { ...saved, shortcuts: { toggleInteraction: 'F8', playPause: 'F9' } };
    await mkdir(previousProfile); await writeFile(join(previousProfile, 'widget.json'), JSON.stringify(previousSettings));
    app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--disable-gpu'], env: { ...process.env, XDG_CONFIG_HOME: legacyConfig } });
    page = await app.firstWindow(); await page.waitForFunction(() => !!window.musicWidget);
    const legacy = await waitState(page, state => state.connected);
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), previousProfile);
    assert.deepEqual(legacy.shortcuts.bindings, { ...DEFAULT_BINDINGS, ...previousSettings.shortcuts }); assert.equal(legacy.preferences.color, saved.color);
  }
  console.log('PASS: editable shortcuts, busy-key rollback, global keys with another app focused, palette, restart persistence, Liberty Wave identity and preservation of the previous profile.');
} finally {
  await browser?.close(); await app?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await rm(legacyConfig, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
