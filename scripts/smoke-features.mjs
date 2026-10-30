import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { pressGlobalKeys } from './send-global-keys.mjs';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'liberty-features-'));
let app, browser, panel;
async function waitState(page, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const s = await page.evaluate(() => musicWidget.getState()); if (predicate(s)) return s; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Feature state did not reach the expected value');
}
function waitDOM(page, predicate, argument) { return page.waitForFunction(predicate, argument, { polling: 50, timeout: 10000 }); }
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--disable-gpu', `--user-data-dir=${profile}`] });
  const page = await app.firstWindow(); await waitDOM(page, () => !!window.musicWidget);
  await waitState(page, s => s.connected);
  await page.evaluate(() => musicWidget.openControls('home'));
  panel = app.windows().find(page => page.url().endsWith('/control/index.html')); await panel.waitForFunction(() => !!window.libertyControl);
  return page;
}
try {
  let page = await launch();
  await page.locator('#volume').evaluate(el => { el.value = 25; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await waitState(page, s => s.volume === .25);
  await page.locator('#mute').click(); await waitState(page, s => s.muted && s.volume === .25);
  await page.locator('#mute').click(); await waitState(page, s => !s.muted && s.volume === .25);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).setPosition(140, 120));
  await page.waitForTimeout(100);
  await panel.evaluate(() => libertyControl.action('preferences', { opacity: .25 }));
  assert.equal(await page.locator('#volume-controls').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('#volume-controls').evaluate(el => el.getBoundingClientRect().bottom <= document.getElementById('widget').getBoundingClientRect().bottom), true);
  await panel.evaluate(async () => { const s = await libertyControl.getState(); return libertyControl.action('preferences', { compact: !s.preferences.compact }); }); await waitState(page, s => s.compact);
  await waitDOM(page, () => innerWidth === 500 && innerHeight === 144 && document.body.classList.contains('compact'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).setPosition(700, 350));
  await page.waitForTimeout(100);
  await panel.evaluate(async () => { const s = await libertyControl.getState(); return libertyControl.action('preferences', { compact: !s.preferences.compact }); }); await waitState(page, s => !s.compact);
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).getPosition()), [140, 120]);
  await panel.evaluate(async () => { const s = await libertyControl.getState(); return libertyControl.action('preferences', { compact: !s.preferences.compact }); }); await waitState(page, s => s.compact);
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).getPosition()), [700, 350]);
  await waitDOM(page, () => innerWidth === 500 && innerHeight === 144);
  for (const selector of ['#play-pause', '#next', '#previous', '#volume', '#menu']) {
    assert.equal(await page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(), w = document.getElementById('widget').getBoundingClientRect(); return r.x >= w.x && r.right <= w.right && r.y >= w.y && r.bottom <= w.bottom; }), true, selector);
  }
  await page.locator('#next').click(); await waitState(page, s => s.title === 'The Perfect Girl');
  await page.locator('#previous').click(); await waitState(page, s => s.title === 'After Dark');
  await panel.evaluate(() => libertyControl.action('preferences', { scale: 1.5 }));
  await waitDOM(page, () => innerWidth === 500 && innerHeight === 144);
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).getBounds(); return [b.width, b.height]; }), [750, 216]);
  await panel.evaluate(() => libertyControl.action('preferences', { scale: 1, opacity: 1 }));
  await waitDOM(page, () => innerWidth === 500 && innerHeight === 144);
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: join(root, 'artifacts/widget-compact.png') });

  const positionBeforeSettings = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).getPosition());
  await panel.locator('[data-page="shortcuts"]').click();
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).getPosition()), positionBeforeSettings);
  for (const [action, key] of [['toggleInteraction', 'F8'], ['volumeUp', 'F5'], ['volumeDown', 'F6'], ['mute', 'F7'], ['toggleCompact', 'F12']]) {
    await panel.locator(`#bind-${action}`).click(); await panel.keyboard.press(key);
  }
  await panel.locator('#shortcut-save').click();
  await waitDOM(page, () => innerWidth === 500 && innerHeight === 144 && document.body.classList.contains('compact'));
  await panel.locator('[data-page="appearance"]').click();
  await panel.locator('#wave-mode').selectOption('ambient');
  await panel.locator('#wave-intensity').evaluate(el => { el.value = 90; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await panel.locator('#wave-economy').check();
  await waitState(page, s => s.preferences.waveMode === 'ambient' && s.preferences.waveIntensity === .9 && s.preferences.waveEconomy);
  const before = await page.locator('#edge-wave-ring').getAttribute('d');
  await waitDOM(page, d => document.getElementById('edge-wave-ring').getAttribute('d') !== d, before);
  await panel.locator('#wave-mode').selectOption('off'); await page.locator('.edge-waves').waitFor({ state: 'hidden' });
  await panel.locator('#wave-mode').selectOption('audio');
  await waitState(page, s => s.preferences.waveMode === 'audio');
  await page.waitForTimeout(1200);
  const silent = await page.locator('#edge-wave-ring').getAttribute('d');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).webContents.send('widget:audio-level', { available: true, level: .8 }));
  await waitDOM(page, d => document.getElementById('edge-wave-ring').getAttribute('d') !== d, silent);
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('#edge-wave-ring').getAttribute('d'), silent, 'Lost or silent audio must settle to a static contour');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).webContents.send('widget:audio-level', { available: true, level: 1 }));
  await page.waitForTimeout(200); assert.equal(await page.locator('#edge-wave-ring').getAttribute('d'), silent);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  browser = await chromium.launch({ channel: 'chromium', headless: false });
  const other = await browser.newPage(); await other.setContent('<h1>Another app</h1>'); await other.bringToFront();
  await pressGlobalKeys(['F8']); await waitState(page, s => !s.interaction);
  await pressGlobalKeys(['F5']); await waitState(page, s => s.volume === .3 && !s.interaction);
  await pressGlobalKeys(['F6']); await waitState(page, s => s.volume === .25 && !s.interaction);
  await pressGlobalKeys(['F7']); await waitState(page, s => s.muted && !s.interaction);
  await pressGlobalKeys(['F7']); await waitState(page, s => !s.muted && !s.interaction);
  await pressGlobalKeys(['F12']); await waitState(page, s => !s.compact && !s.interaction);
  assert.equal(await other.evaluate(() => document.hasFocus()), true, 'Compact hotkey must not steal game focus');
  await pressGlobalKeys(['F12']); await waitState(page, s => s.compact && !s.interaction);
  assert.equal((await page.evaluate(() => musicWidget.command('volume', .8))).ok, false);
  assert.equal(await page.evaluate(() => typeof musicWidget.setPreferences), 'undefined');
  await browser.close(); browser = null;
  await app.close(); app = null;
  const saved = JSON.parse(await readFile(join(profile, 'widget.json'), 'utf8'));
  assert.equal(saved.compact, true); assert.equal(saved.waveIntensity, .9); assert.equal(saved.waveEconomy, true);
  page = await launch(); await waitState(page, s => s.compact && s.shortcuts.bindings.mute === 'F7');
  await waitDOM(page, () => innerWidth === 500 && innerHeight === 144);
  console.log('PASS: real Electron volume/mute, opaque controls, compact transport/scaling, separate desktop settings, audio-level IPC, silence/reduced motion, global audio/compact keys without focus theft, pinned controls and restart persistence.');
} finally {
  await browser?.close(); await app?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
