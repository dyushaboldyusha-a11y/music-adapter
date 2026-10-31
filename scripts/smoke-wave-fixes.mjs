import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'liberty-wave-fix-'));
let app, browser;
try {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--disable-gpu', `--user-data-dir=${profile}`] });
  const widget = await app.firstWindow(); await widget.waitForFunction(() => !!window.musicWidget, null, { polling: 50 });
  await widget.evaluate(() => musicWidget.openControls('appearance'));
  const panel = app.windows().find(page => page.url().endsWith('/control/index.html'));
  await panel.waitForFunction(() => !!window.libertyControl && document.visibilityState === 'visible', null, { polling: 50 });
  const errors = []; widget.on('pageerror', e => errors.push(e.message)); panel.on('pageerror', e => errors.push(e.message));
  const noNotes = ['Только аудиосессии выбранного', 'Цвет применяется к виджету', 'Шкала перемотки остаётся', 'Выбранный вручную цвет сохраняется', 'Всё останется на месте', 'Регистрация не нужна'];
  for (const section of ['home','appearance','updates']) {
    await panel.locator(`[data-page="${section}"]`).click();
    const text = await panel.locator('body').innerText();
    for (const note of noNotes) assert.ok(!text.includes(note), note);
  }
  assert.equal(await panel.locator('#wave-note,.update-info').count(), 0);
  await panel.locator('[data-page="appearance"]').click();
  assert.equal(await panel.locator('#color-status').isHidden(), true);
  await panel.locator('#color-hex').fill('#bad'); assert.equal(await panel.locator('#color-status').isVisible(), true);
  await panel.locator('#color-cancel').click(); assert.equal(await panel.locator('#color-status').isHidden(), true);
  await panel.evaluate(() => libertyControl.action('preferences', { waveMode: 'audio', waveIntensity: .9, waveEconomy: false }));
  const target = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html')).webContents.getBackgroundThrottling());
  assert.equal(target, false, 'An unfocused overlay must not throttle its animation');
  await widget.waitForTimeout(1000); const idle = await widget.locator('#edge-wave-ring').getAttribute('d');
  await panel.evaluate(() => libertyControl.action('interaction', false));
  browser = await chromium.launch({ channel: 'chromium', headless: false });
  const other = await browser.newPage(); await other.setContent('<h1>Focused game fixture</h1>'); await other.bringToFront();
  await app.evaluate(({ BrowserWindow }) => { const contents = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html')).webContents; let sample = 0; globalThis.waveFixInterval = setInterval(() => contents.send('widget:audio-level', { available: true, level: ++sample % 8 < 2 ? .012 : .002 }), 40); });
  const contours = new Set(); let maximumGlow = 0;
  for (let i = 0; i < 12; i++) { await widget.waitForTimeout(90); contours.add(await widget.locator('#edge-wave-ring').getAttribute('d')); maximumGlow = Math.max(maximumGlow, await widget.locator('.wave-glow').evaluate(el => parseFloat(el.style.strokeWidth))); }
  assert.ok(contours.size >= 6, 'Quiet music must keep the pinned wave moving with another app focused');
  assert.ok(maximumGlow > 3.4);
  assert.equal(await other.evaluate(() => document.hasFocus()), true);
  await app.evaluate(({ BrowserWindow }) => { clearInterval(globalThis.waveFixInterval); BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html')).webContents.send('widget:audio-level', { available: false, level: 0 }); });
  await widget.waitForTimeout(1800); assert.equal(await widget.locator('#edge-wave-ring').getAttribute('d'), idle);
  await browser.close(); browser = null;
  await panel.bringToFront(); await panel.locator('[data-page="appearance"]').click();
  await mkdir(join(root,'artifacts'), { recursive: true }); await panel.screenshot({ path: join(root,'artifacts/wave-fix-appearance.png') });
  await panel.locator('[data-page="updates"]').click(); await panel.screenshot({ path: join(root,'artifacts/wave-fix-updates.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: removed requested notes/cards, retained color validation, quiet music animates a pinned unfocused overlay continuously, silence settles, no focus theft or renderer errors.');
} finally { await browser?.close(); await app?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
