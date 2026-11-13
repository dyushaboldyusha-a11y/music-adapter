import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const output = join(root, 'artifacts', 'glass-polish');
const profile = await mkdtemp(join(tmpdir(), 'wave-glass-polish-'));
const failures = [], errors = [], measurements = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const { extensionTheme } = require('../src/extension-theme.cjs');
let app;
function check(label, test) { try { test(); } catch (error) { failures.push(`${label}: ${error.message}`); } }
async function action(panel, value) {
  const result = await panel.evaluate(value => libertyControl.action('preferences', value), value);
  assert.equal(result.ok, true, result.error);
  await panel.waitForFunction(async value => {
    const state = await libertyControl.getState();
    return Object.entries(value).every(([key, expected]) => state.preferences[key] === expected);
  }, value);
}
async function token(frame, name) { return frame.evaluate(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), name); }
async function waitToken(frame, name, value) { await frame.waitForFunction(({ name, value }) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() === value, { name, value }); }
async function selected(panel) { return panel.locator('#color-presets button[aria-pressed="true"]').evaluateAll(buttons => buttons.map(button => button.dataset.color)); }
async function colors(page, selectors) {
  return page.evaluate(selectors => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); const value = [...context.getImageData(0, 0, 1, 1).data]; value[3] /= 255; return value; };
    const over = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3])).concat(1);
    const luminance = color => color.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    return selectors.map(selector => {
      const element = document.querySelector(selector);
      let background = rgba(getComputedStyle(document.documentElement).getPropertyValue('--app-bg') || '#ffffff');
      const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
      for (const node of ancestors) background = over(rgba(getComputedStyle(node).backgroundColor), background);
      const foreground = over(rgba(getComputedStyle(element).color), background), a = luminance(background), b = luminance(foreground);
      return { selector, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  }, selectors);
}
async function presetAndPreviewChecks(panel, widget, preview) {
  await action(panel, { surfaceColor: '#e8edf3', color: '#438bff', colorMode: 'manual', compact: false, showArtwork: true, showArtist: true, showTime: true, rhythmBars: false, opacity: 1, scale: 1 });
  await panel.locator('#palette-target').selectOption('surface');
  await panel.waitForFunction(() => document.getElementById('color-hex').value === '#e8edf3');
  await preview.waitForFunction(() => document.getElementById('title').textContent === 'After Dark');
  assert.equal(await preview.evaluate(() => !!window.libertyPreviewBridge && !window.musicWidget), true, 'The embedded renderer must use its local bridge without Electron control IPC');
  assert.deepEqual(await selected(panel), ['#e8edf3']);
  await panel.locator('[data-color="#ffffff"]').click();
  await waitToken(preview, '--surface-color', '#ffffff');
  assert.deepEqual(await selected(panel), ['#ffffff']);
  const marker = await panel.locator('[data-color="#ffffff"]').evaluate(button => ({ visible: getComputedStyle(button, '::after').opacity, ink: getComputedStyle(button).getPropertyValue('--swatch-ink').trim() }));
  check('selected white marker', () => { assert.equal(marker.visible, '1'); assert.equal(marker.ink, '#000000'); });
  assert.equal(await token(widget, '--surface-color'), '#e8edf3', 'Unsaved preview must not repaint the desktop widget');
  assert.equal((await panel.evaluate(() => libertyControl.getState())).preferences.surfaceColor, '#e8edf3');
  await panel.locator('#color-hex').fill('#ffffff'); assert.deepEqual(await selected(panel), ['#ffffff']);
  await panel.locator('#brightness').evaluate(element => { element.value = '40'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.deepEqual(await selected(panel), [], 'Custom brightness must clear an inexact preset');
  await panel.locator('#color-cancel').click(); await waitToken(preview, '--surface-color', '#e8edf3');
  assert.deepEqual(await selected(panel), ['#e8edf3']);
  await panel.locator('[data-color="#ffffff"]').click();
  await panel.locator('#palette-target').selectOption('accent');
  assert.deepEqual(await selected(panel), ['#438bff']);
  await panel.locator('[data-color="#d4d4d8"]').click();
  await waitToken(preview, '--red', '#d4d4d8'); await waitToken(preview, '--surface-color', '#ffffff');
  assert.equal(await token(widget, '--red'), '#438bff');
  await panel.locator('#color-cancel').click(); await waitToken(preview, '--red', '#438bff');
  await panel.locator('#palette-target').selectOption('surface'); await panel.locator('#color-cancel').click();
  await waitToken(preview, '--surface-color', '#e8edf3');
  const before = await panel.evaluate(() => libertyControl.getState());
  await panel.locator('#preview-compact').click();
  await preview.waitForFunction(() => document.body.classList.contains('compact'));
  assert.equal((await panel.evaluate(() => libertyControl.getState())).preferences.compact, before.preferences.compact, 'Preview mode must not change the actual widget preference');
  assert.equal(await widget.locator('body').evaluate(element => element.classList.contains('compact')), false);
  await action(panel, { showArtwork: false, showArtist: false, showTime: false, rhythmBars: true, opacity: .25, scale: 1.25 });
  await preview.waitForFunction(() => document.body.classList.contains('no-artwork') && document.body.classList.contains('no-artist') && document.body.classList.contains('no-time') && document.body.classList.contains('has-rhythm-bars'));
  assert.equal(await preview.locator('.cover').isVisible(), false); assert.equal(await preview.locator('#artist').isVisible(), false); assert.equal(await preview.locator('.times').isVisible(), false);
  assert.equal(await token(preview, '--decoration-opacity'), '0.25');
  assert.match(await panel.locator('#widget-preview-size').textContent(), /^125%/);
  const playing = (await panel.evaluate(() => libertyControl.getState())).playing;
  const command = await preview.evaluate(async () => { document.getElementById('play-pause').click(); return libertyPreviewBridge.command('playPause'); });
  assert.equal(command.ok, false); await delay(80);
  assert.equal((await panel.evaluate(() => libertyControl.getState())).playing, playing, 'Preview buttons must not send transport commands');
  await panel.locator('#preview-full').click(); await preview.waitForFunction(() => !document.body.classList.contains('compact'));
  await action(panel, { showArtwork: true, showArtist: true, showTime: true, rhythmBars: false, opacity: 1, scale: 1 });
  await action(panel, { waveMode: 'audio', waveIntensity: 1 });
  const paths = new Set();
  for (let i = 0; i < 10; i++) {
    await app.evaluate(({ BrowserWindow }, level) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/control/index.html')).webContents.send('control:audio-level', { available: true, level }), i % 2 ? .95 : .1);
    await delay(55); paths.add(await preview.locator('#edge-wave-ring').getAttribute('d'));
  }
  assert.ok(paths.size >= 2, 'Audio meter IPC must reach the real embedded wave renderer');
  await panel.locator('[data-page="home"]').click();
  await preview.waitForFunction(() => document.body.classList.contains('auto-hidden'));
  await panel.locator('[data-page="appearance"]').click();
  await preview.waitForFunction(() => !document.body.classList.contains('auto-hidden'));
}
async function layoutChecks(panel, preview) {
  for (const width of [1000, 760]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/control/index.html')).setContentSize(width, 800), width);
    await panel.waitForFunction(width => innerWidth === width, width);
    for (const [name, surfaceColor] of [['light', '#e8edf3'], ['dark', '#202632'], ['pink', '#f700d0']]) {
      await action(panel, { surfaceColor, color: '#438bff' });
      await panel.locator('[data-page="appearance"]').click();
      if (!await panel.locator('.widget-preview-panel').evaluate(element => element.open)) await panel.locator('.widget-preview-heading').click();
      await waitToken(preview, '--surface-color', surfaceColor);
      await delay(80);
      const geometry = await panel.evaluate(() => {
        const pane = document.getElementById('content'), stage = document.getElementById('widget-preview-viewport'), frame = document.getElementById('widget-preview-frame');
        const p = pane.getBoundingClientRect(), s = stage.getBoundingClientRect(), f = frame.getBoundingClientRect();
        const rgba = color => { const canvas = document.createElement('canvas'), context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
        const alphas = ['main', '.palette-card', '#color-hex'].map(selector => rgba(getComputedStyle(document.querySelector(selector)).borderTopColor)[3]);
        return { width: innerWidth, scrollWidth: pane.scrollWidth, clientWidth: pane.clientWidth, frame: { left: f.left, right: f.right, top: f.top, bottom: f.bottom }, stage: { left: s.left, right: s.right, top: s.top, bottom: s.bottom }, pane: { left: p.left, right: p.right }, alphas };
      });
      check(`${width} ${name} layout`, () => {
        assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `Appearance must not scroll horizontally (${geometry.scrollWidth}/${geometry.clientWidth})`);
        assert.ok(geometry.frame.left >= geometry.stage.left - 1 && geometry.frame.right <= geometry.stage.right + 1 && geometry.frame.bottom <= geometry.stage.bottom + 1, 'The fitted renderer must stay inside its preview stage');
        assert.ok(geometry.alphas[0] > geometry.alphas[1] && geometry.alphas[1] > geometry.alphas[2], `Nested borders need visible hierarchy: ${geometry.alphas}`);
      });
      measurements.push({ appearance: `${width}-${name}`, ...geometry });
      await panel.screenshot({ path: join(output, `${width}-${name}-appearance.png`) });
      await panel.locator('.widget-preview-panel').scrollIntoViewIfNeeded();
      await panel.screenshot({ path: join(output, `${width}-${name}-preview.png`) });
    }
  }
}
async function popupChecks() {
  await app.context().addInitScript(() => {
    if (!location.pathname.endsWith('/popup.html')) return;
    globalThis.polishPopup = { paired: true, players: 3, waveTab: 1, error: '' };
    globalThis.chrome = { runtime: { sendMessage: async message => message.type === 'status' ? polishPopup : { ok: true } }, tabs: { query: async () => [{ id: 1 }] }, tabCapture: { getMediaStreamId: async () => 'fixture-stream' } };
  });
  const opened = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow }, filename) => new BrowserWindow({ width: 320, height: 720, useContentSize: true, webPreferences: { contextIsolation: true, nodeIntegration: false } }).loadFile(filename), join(root, 'browser-extension', 'popup.html'));
  const popup = await opened; await popup.waitForFunction(() => document.body.dataset.connection === 'paired');
  for (const [name, surfaceColor] of [['light', '#e8edf3'], ['dark', '#202632'], ['pink', '#f700d0']]) {
    await popup.evaluate(async theme => { polishPopup.theme = theme; await refresh(); }, extensionTheme('#438bff', surfaceColor));
    await waitToken(popup, '--surface-color', surfaceColor);
    assert.equal(await popup.locator('.brand img').isVisible(), true);
    const labels = await colors(popup, ['#status', '#connection-label']);
    for (const item of labels) check(`${name} popup ${item.selector}`, () => assert.ok(item.contrast >= 4.5, `Contrast ${item.contrast}`));
    for (const selector of ['#wave-start', '#wave-stop', '#disconnect']) {
      await popup.locator(selector).hover(); await delay(180);
      const [button] = await colors(popup, [selector]); check(`${name} ${selector} hover`, () => assert.ok(button.contrast >= 4.5, `Contrast ${button.contrast}`));
    }
    const geometry = await popup.evaluate(() => {
      const start = document.getElementById('wave-start').getBoundingClientRect(), stop = document.getElementById('wave-stop').getBoundingClientRect();
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, gap: stop.top - start.bottom };
    });
    check(`${name} popup fit`, () => { assert.ok(geometry.scrollWidth <= geometry.width); assert.ok(geometry.gap >= 8); });
    measurements.push({ popup: name, ...geometry });
    await popup.locator('body').screenshot({ path: join(output, `popup-${name}-paired.png`) });
  }
  const accepted = await token(popup, '--app-bg');
  await popup.evaluate(async () => { polishPopup.theme = { appearance: 'dark', tokens: { '--app-bg': 'url(https://invalid.example/x)', '--text': '#ffffff', '--red': '#ff3045' } }; await refresh(); });
  assert.equal(await token(popup, '--app-bg'), accepted, 'Invalid CSS must not replace the accepted application theme');
  await popup.evaluate(async () => { polishPopup.error = 'Ошибка подключения https://example.invalid/' + 'unbroken'.repeat(40); await refresh(); });
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await popup.locator('body').screenshot({ path: join(output, 'popup-long-error.png') });
  await popup.evaluate(async () => { Object.assign(polishPopup, { paired: false, waveTab: null, error: '', theme: null }); await refresh(); });
  assert.equal(await popup.locator('#pair').isVisible(), true);
  await popup.locator('body').screenshot({ path: join(output, 'popup-pairing.png') });
}
try {
  await mkdir(output, { recursive: true });
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--widget-only', '--disable-gpu', `--user-data-dir=${profile}`] });
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const widget = await app.firstWindow(); widget.on('pageerror', error => errors.push(error.message));
  await widget.waitForFunction(() => !!window.musicWidget);
  await widget.evaluate(() => musicWidget.openControls('appearance'));
  let panel;
  const deadline = Date.now() + 12000;
  while (!(panel = app.windows().find(page => page.url().endsWith('/control/index.html'))) && Date.now() < deadline) await delay(40);
  assert.ok(panel, 'The appearance settings must open');
  await panel.waitForFunction(async () => !!document.getElementById('widget-preview-frame') && (await libertyControl.getState()).connected);
  const handle = await panel.locator('#widget-preview-frame').elementHandle(), preview = await handle.contentFrame();
  assert.ok(preview, 'The actual widget renderer must load as the preview');
  await preview.waitForFunction(() => !!window.libertyPreviewBridge && document.getElementById('title').textContent === 'After Dark');
  await presetAndPreviewChecks(panel, widget, preview);
  await layoutChecks(panel, preview);
  await popupChecks();
  assert.deepEqual(errors, [], 'Application, preview and popup must not report renderer errors');
  await writeFile(join(output, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  assert.deepEqual(failures, [], `${failures.length} visual regressions:\n${failures.join('\n')}`);
  console.log('PASS: real Electron live widget preview, isolated controls and unsaved palette drafts, exact selected presets, responsive layout and softer border hierarchy; Glass popup theme sync, readable controls and invalid-theme rejection. Screenshots: artifacts/glass-polish/.');
} finally { await app?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
