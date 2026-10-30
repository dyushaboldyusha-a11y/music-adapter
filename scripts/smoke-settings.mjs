import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { pressGlobalKeys } from './send-global-keys.mjs';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const { DEFAULT_BINDINGS } = require('../src/shared/shortcuts.js');
const profile = await mkdtemp(join(tmpdir(), 'liberty-settings-')), legacy = await mkdtemp(join(tmpdir(), 'liberty-legacy-'));
let app, browser;
async function state(page, predicate) { const deadline = Date.now() + 10000; while (Date.now() < deadline) { const s = await page.evaluate(() => libertyControl.getState()); if (predicate(s)) return s; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Expected settings state was not reached'); }
async function launch(legacyLaunch = false) {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--disable-gpu', ...(legacyLaunch ? [] : [`--user-data-dir=${profile}`])], ...(legacyLaunch ? { env: { ...process.env, XDG_CONFIG_HOME: legacy } } : {}) });
  const widget = await app.firstWindow(); await widget.waitForFunction(() => !!window.musicWidget);
  await widget.evaluate(() => musicWidget.openControls('shortcuts'));
  const page = app.windows().find(page => page.url().endsWith('/control/index.html')); await page.waitForFunction(() => !!window.libertyControl);
  await state(page, s => s.connected); return { page, widget };
}
try {
  let { page, widget } = await launch();
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'Liberty Wave');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  assert.equal(await widget.locator('.settings-panel').count(), 0);
  for (const key of ['setPreferences', 'openShortcuts', 'openTheme', 'openWave', 'openUpdates', 'selectSource', 'beginPairing', 'showMenu']) assert.equal(await widget.evaluate(key => typeof musicWidget[key], key), 'undefined', `${key} must not remain available through the overlay`);
  await app.evaluate(({ globalShortcut }) => globalShortcut.register('F9', () => {}));
  await page.locator('#bind-toggleInteraction').click(); await page.keyboard.press('F8');
  await page.locator('#bind-playPause').click(); await page.keyboard.press('F9');
  await page.locator('#shortcut-save').click(); await page.waitForFunction(() => document.getElementById('shortcut-status').textContent.includes('занято'));
  assert.equal((await page.evaluate(() => libertyControl.getState())).shortcuts.bindings.toggleInteraction, 'Control+Shift+8');
  await page.locator('#shortcut-cancel').click();
  await app.evaluate(({ globalShortcut }) => globalShortcut.unregister('F9'));
  for (const [key, value] of [['toggleInteraction', 'F8'], ['playPause', 'F9'], ['next', 'F10'], ['previous', 'F11']]) { await page.locator(`#bind-${key}`).click(); await page.keyboard.press(value); }
  await page.locator('#shortcut-save').click(); await state(page, s => s.shortcuts.bindings.next === 'F10' && !s.controlCapture);
  await page.evaluate(() => libertyControl.action('preferences', { color: '#22c55e' }));
  browser = await chromium.launch({ channel: 'chromium', headless: false }); const other = await browser.newPage(); await other.setContent('<h1>Another application</h1>'); await other.bringToFront();
  await pressGlobalKeys(['F8']); await state(page, s => !s.interaction);
  const playing = (await page.evaluate(() => libertyControl.getState())).playing;
  await pressGlobalKeys(['F9']); await state(page, s => s.playing !== playing && !s.interaction);
  const title = (await page.evaluate(() => libertyControl.getState())).title;
  await pressGlobalKeys(['F10']); await state(page, s => s.title !== title && !s.interaction);
  await pressGlobalKeys(['F11']); await state(page, s => s.title === title && !s.interaction);
  await browser.close(); browser = null; await app.close(); app = null;
  const saved = JSON.parse(await readFile(join(profile, 'widget.json'), 'utf8'));
  assert.deepEqual(saved.shortcuts, { ...DEFAULT_BINDINGS, toggleInteraction: 'F8', playPause: 'F9', next: 'F10', previous: 'F11' });
  ({ page } = await launch()); assert.equal((await page.evaluate(() => libertyControl.getState())).preferences.color, '#22c55e');
  if (process.platform === 'linux') {
    await app.close(); app = null; const old = join(legacy, 'music-adapter'); await mkdir(old);
    await writeFile(join(old, 'widget.json'), JSON.stringify({ ...saved, shortcuts: { toggleInteraction: 'F8', playPause: 'F9' } }));
    ({ page } = await launch(true)); const migrated = await page.evaluate(() => libertyControl.getState());
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), old);
    assert.deepEqual(migrated.shortcuts.bindings, { ...DEFAULT_BINDINGS, toggleInteraction: 'F8', playPause: 'F9' }); assert.equal(migrated.preferences.color, '#22c55e');
  }
  console.log('PASS: desktop-only settings, removed overlay settings APIs, occupied-key rollback, global transport with another app focused, persistence and migration of legacy music-adapter profiles.');
} finally { await browser?.close(); await app?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); await rm(legacy, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
