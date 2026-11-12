import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const output = join(root, 'artifacts', 'visual-audit-regression');
const profile = await mkdtemp(join(tmpdir(), 'wave-visual-audit-'));
const failures = [], errors = [], measurements = [];
let app;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(label, test) { try { test(); } catch (error) { failures.push(`${label}: ${error.message}`); } }
async function action(panel, name, value) {
  const result = await panel.evaluate(({ name, value }) => libertyControl.action(name, value), { name, value });
  assert.equal(result.ok, true, result.error);
  return result;
}
async function surface(panel, value) {
  await action(panel, 'preferences', { surfaceColor: value, color: '#438bff', colorMode: 'manual' });
  await panel.waitForFunction(color => getComputedStyle(document.documentElement).getPropertyValue('--surface-color').trim() === color, value);
}
async function colors(page, selectors) {
  return page.evaluate(selectors => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const value = [...context.getImageData(0, 0, 1, 1).data]; value[3] /= 255; return value;
    };
    const over = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3])).concat(1);
    const luminance = color => color.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    return selectors.map(selector => {
      const element = document.querySelector(selector); if (!element) throw new Error(`Missing ${selector}`);
      let background = rgba(getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim() || '#ffffff');
      const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
      for (const node of ancestors) background = over(rgba(getComputedStyle(node).backgroundColor), background);
      const foreground = over(rgba(getComputedStyle(element).color), background), a = luminance(background), b = luminance(foreground);
      return { selector, background: background.slice(0, 3), foreground: foreground.slice(0, 3), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  }, selectors);
}
async function paletteChecks(panel) {
  await panel.locator('[data-page="appearance"]').click();
  await panel.locator('#palette-target').selectOption('surface');
  await panel.locator('#color-hex').fill('#406080');
  await panel.locator('#brightness').evaluate(element => { element.value = '40'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  const edited = await panel.locator('#brightness').evaluate(element => ({ value: element.value, fill: getComputedStyle(element).getPropertyValue('--progress').trim(), output: document.getElementById('brightness-value').textContent }));
  check('brightness fill', () => { assert.equal(edited.value, '40'); assert.equal(edited.fill, '40%'); assert.equal(edited.output, '40%'); });
  measurements.push({ palette: 'brightness40', ...edited });
  await panel.screenshot({ path: join(output, 'brightness40.png') });
  await panel.locator('#palette-target').selectOption('accent');
  const accent = await panel.locator('#brightness').evaluate(element => ({ value: element.value, fill: getComputedStyle(element).getPropertyValue('--progress').trim() }));
  check('accent target fill', () => assert.equal(accent.fill, `${accent.value}%`));
  await panel.locator('#palette-target').selectOption('surface');
  await panel.locator('#color-cancel').click();
  const cancelled = await panel.locator('#brightness').evaluate(element => ({ value: element.value, fill: getComputedStyle(element).getPropertyValue('--progress').trim() }));
  check('cancelled brightness fill', () => assert.equal(cancelled.fill, `${cancelled.value}%`));
  for (const [name, color] of [['light', '#e8edf3'], ['dark', '#202632'], ['pink', '#f700d0'], ['gray', '#777777'], ['yellow', '#ffff00']]) {
    await surface(panel, color);
    await panel.locator('[data-page="appearance"]').click();
    await panel.locator('#color-hex').fill('#invalid');
    const [error] = await colors(panel, ['#color-status']);
    check(`${name} error contrast`, () => assert.ok(error.contrast >= 4.5, `validation text contrast ${error.contrast.toFixed(2)} must reach 4.5:1`));
    measurements.push({ palette: name, error });
    await panel.screenshot({ path: join(output, `${name}-validation.png`) });
    await panel.locator('#color-cancel').click();
    await panel.locator('[data-page="sources"]').click();
    const icons = await colors(panel, Array.from({ length: 5 }, (_, i) => `#services .service-row:nth-child(${i + 1}) .service-icon`));
    const vectors = await panel.locator('#services .service-icon svg').count();
    check(`${name} service icons`, () => { assert.equal(vectors, 5, 'Service marks must use consistent vector icons'); for (const icon of icons) assert.ok(icon.contrast >= 4.5, `${icon.selector}: ${icon.contrast.toFixed(2)}`); });
    measurements.push({ palette: name, icons });
    if (['light', 'dark', 'pink'].includes(name)) await panel.screenshot({ path: join(output, `${name}-sources.png`) });
  }
}
async function narrowChecks(panel) {
  await surface(panel, '#e8edf3');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/control/index.html')).setContentSize(760, 540));
  await panel.waitForFunction(() => innerWidth === 760 && innerHeight === 540);
  await panel.locator('[data-page="home"]').click();
  const name = 'ОченьДлинныйПрофильИгрыБезПробелов'.repeat(2).slice(0, 60), executable = 'longgame'.repeat(12) + '.exe';
  await panel.locator('#profile-name').fill(name); await panel.locator('#profile-exe').fill(executable);
  await panel.locator('#profile-form button').click();
  await panel.waitForFunction(async executable => (await libertyControl.getState()).appProfiles.items.some(item => item.executable === executable), executable);
  await panel.locator('#profile-list').scrollIntoViewIfNeeded();
  const profileGeometry = await panel.locator('#profile-list .setting-row').evaluate(row => {
    const text = row.querySelector('span'), remove = row.querySelector('button'), pane = document.getElementById('content');
    const t = text.getBoundingClientRect(), r = remove.getBoundingClientRect(), p = pane.getBoundingClientRect();
    return { paneWidth: pane.clientWidth, paneScrollWidth: pane.scrollWidth, textWidth: text.clientWidth, textScrollWidth: text.scrollWidth, textRight: t.right, removeLeft: r.left, removeRight: r.right, paneRight: p.right, text: text.textContent };
  });
  check('long profile fit', () => {
    assert.ok(profileGeometry.paneScrollWidth <= profileGeometry.paneWidth + 1, 'A valid long profile must not cause horizontal scrolling');
    assert.ok(profileGeometry.textScrollWidth <= profileGeometry.textWidth + 1, 'Profile name/executable must wrap inside their column');
    assert.ok(profileGeometry.textRight < profileGeometry.removeLeft, 'Profile text must not draw underneath Delete');
    assert.ok(profileGeometry.removeRight <= profileGeometry.paneRight - 10, 'Delete must remain visible inside the pane');
    assert.ok(profileGeometry.text.includes(name) && profileGeometry.text.includes(executable));
  });
  measurements.push({ profile: profileGeometry });
  await panel.screenshot({ path: join(output, 'long-profile.png') });
  // Render a legal but long key without registering it globally on the host.
  // The production renderer receives the same snapshot through its normal IPC.
  await app.evaluate(({ BrowserWindow }, binding) => {
    const target = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/control/index.html'));
    const send = target.webContents.send.bind(target.webContents);
    target.webContents.send = (channel, value, ...rest) => send(channel, channel === 'control:state' ? {
      ...value,
      source: value.source ? { ...value.source, name: 'ОченьДлинноеНазваниеМузыкальногоСервиса'.repeat(3) } : value.source,
      shortcuts: { ...value.shortcuts, bindings: { ...value.shortcuts.bindings, next: binding } }
    } : value, ...rest);
  }, 'Control+Alt+Shift+Super+MediaPreviousTrack');
  await action(panel, 'preferences', { scale: 1 });
  await panel.locator('[data-page="shortcuts"]').click();
  await panel.waitForFunction(() => document.getElementById('bind-next').textContent.includes('MediaPreviousTrack'));
  const keyGeometry = await panel.locator('#bind-next').evaluate(button => {
    const box = button.getBoundingClientRect(), style = getComputedStyle(button);
    const text = document.createRange(); text.selectNodeContents(button);
    const lines = [...text.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    return { width: button.clientWidth, scrollWidth: button.scrollWidth, height: box.height, lineHeight: parseFloat(style.lineHeight), text: button.textContent, whiteSpace: style.whiteSpace, lineTops: [...new Set(lines.map(rect => Math.round(rect.top)))] };
  });
  check('long shortcut readable', () => {
    assert.ok(keyGeometry.text.endsWith('MediaPreviousTrack'));
    assert.ok(keyGeometry.scrollWidth <= keyGeometry.width + 1, 'The actual shortcut key must not overflow its binding button');
    assert.ok(keyGeometry.lineTops.length >= 2 && keyGeometry.height > keyGeometry.lineHeight + 16, 'Long shortcuts must be visible on multiple lines');
  });
  await panel.locator('#bind-next').focus();
  check('wrapped shortcut label', () => assert.ok(keyGeometry.text.includes('Ctrl+Alt+Shift+Win+')));
  assert.equal(await panel.locator('#bind-next').evaluate(element => element === document.activeElement), true);
  measurements.push({ shortcut: keyGeometry });
  await panel.screenshot({ path: join(output, 'long-shortcut.png') });
  await panel.locator('[data-page="home"]').click();
  await panel.waitForFunction(() => document.getElementById('track-source').textContent.includes('ОченьДлинное'));
  const sourceGeometry = await panel.locator('#track-source').evaluate(element => {
    const box = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect(), style = getComputedStyle(element);
    return { width: element.clientWidth, scrollWidth: element.scrollWidth, right: box.right, parentRight: parent.right, overflow: style.overflowX, ellipsis: style.textOverflow, title: element.title, text: element.textContent };
  });
  check('long source label', () => {
    assert.ok(sourceGeometry.scrollWidth > sourceGeometry.width, 'The fixture must exercise text longer than its available column');
    assert.equal(sourceGeometry.overflow, 'hidden'); assert.equal(sourceGeometry.ellipsis, 'ellipsis');
    assert.ok(sourceGeometry.right <= sourceGeometry.parentRight + 1);
    assert.equal(sourceGeometry.title, sourceGeometry.text, 'The complete source must remain available in its tooltip');
  });
  await panel.screenshot({ path: join(output, 'long-source.png') });
  // A row clipped by its rounded settings card needs its keyboard ring inside
  // the card, rather than losing three sides of an outside outline.
  await panel.locator('#compact').focus(); await panel.keyboard.press('Tab');
  await panel.waitForFunction(() => document.activeElement?.id === 'restore');
  const restoreFocus = await panel.locator('#restore').evaluate(element => {
    const row = element.getBoundingClientRect(), card = element.parentElement.getBoundingClientRect(), style = getComputedStyle(element);
    const extent = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
    return { visible: element.matches(':focus-visible'), width: parseFloat(style.outlineWidth), outline: [row.left - extent, row.top - extent, row.right + extent, row.bottom + extent], card: [card.left, card.top, card.right, card.bottom] };
  });
  check('restore keyboard ring', () => {
    assert.equal(restoreFocus.visible, true); assert.ok(restoreFocus.width >= 2);
    const [left, top, right, bottom] = restoreFocus.outline, card = restoreFocus.card;
    assert.ok(left >= card[0] + 1 && top >= card[1] + 1 && right <= card[2] - 1 && bottom <= card[3] - 1, 'The complete keyboard ring must fit inside the clipped card');
  });
  measurements.push({ source: sourceGeometry, restoreFocus });
  await panel.screenshot({ path: join(output, 'restore-focus.png') });
}
async function popupChecks() {
  // Electron ships Chromium on every supported test platform, so this exercises
  // the actual popup HTML/CSS/JS without requiring a second browser download.
  // Only Chrome's extension API is supplied as a deterministic fixture.
  await app.context().addInitScript(() => {
    if (!location.pathname.endsWith('/popup.html')) return;
    globalThis.visualPopupFixture = { paired: true, players: 5, waveTab: 1, error: '' };
    globalThis.chrome = { runtime: { sendMessage: async message => message.type === 'status' ? visualPopupFixture : { ok: true } }, tabs: { query: async () => [{ id: 1 }] }, tabCapture: { getMediaStreamId: async () => 'fixture-stream' } };
  });
  const opened = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow }, filename) => {
    const window = new BrowserWindow({ width: 304, height: 620, useContentSize: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    return window.loadFile(filename);
  }, join(root, 'browser-extension', 'popup.html'));
  const popup = await opened;
  popup.on('pageerror', error => errors.push(error.message));
  await popup.waitForFunction(() => document.getElementById('status').textContent.includes('Подключено'));
  const buttons = await popup.evaluate(() => {
    const start = document.getElementById('wave-start').getBoundingClientRect(), stop = document.getElementById('wave-stop').getBoundingClientRect();
    return { gap: stop.top - start.bottom, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  check('popup button spacing', () => { assert.ok(buttons.gap >= 8, `Wave buttons need ≥8px spacing; measured ${buttons.gap}`); assert.ok(buttons.scrollWidth <= buttons.viewport); });
  for (const selector of ['#wave-start', '#wave-stop', '#disconnect']) {
    await popup.locator(selector).hover();
    const [button] = await colors(popup, [selector]);
    check(`${selector} hover contrast`, () => assert.ok(button.contrast >= 4.5, `hover label contrast ${button.contrast.toFixed(2)} must reach 4.5:1`));
    measurements.push({ popupButton: selector, ...button });
  }
  await popup.locator('body').screenshot({ path: join(output, 'popup-hover.png') });
  await popup.locator('#wave-stop').focus();
  const focus = await popup.locator('#wave-stop').evaluate(element => ({ focused: document.activeElement === element, style: getComputedStyle(element).outlineStyle, width: parseFloat(getComputedStyle(element).outlineWidth) }));
  check('popup visible focus', () => { assert.equal(focus.focused, true); assert.notEqual(focus.style, 'none'); assert.ok(focus.width >= 2); });
  await popup.evaluate(async () => { visualPopupFixture.error = 'Connection failed: https://example.invalid/' + 'unbrokenresourcename'.repeat(18); await refresh(); });
  await popup.waitForFunction(() => document.getElementById('status').textContent.startsWith('Connection failed:'));
  const errorGeometry = await popup.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, statusWidth: document.getElementById('status').clientWidth, statusScrollWidth: document.getElementById('status').scrollWidth }));
  check('popup long error fit', () => { assert.ok(errorGeometry.scrollWidth <= errorGeometry.viewport); assert.ok(errorGeometry.statusScrollWidth <= errorGeometry.statusWidth); });
  measurements.push({ popup: { ...buttons, error: errorGeometry, focus } });
  await popup.locator('body').screenshot({ path: join(output, 'popup-long-error.png') });
  await popup.evaluate(async () => { Object.assign(visualPopupFixture, { paired: false, waveTab: null, error: '' }); await refresh(); });
  await popup.waitForFunction(() => !document.getElementById('pair').hidden);
  await popup.locator('body').screenshot({ path: join(output, 'popup-pairing.png') });
}
try {
  await mkdir(output, { recursive: true });
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--widget-only', '--disable-gpu', `--user-data-dir=${profile}`] });
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const widget = await app.firstWindow();
  await widget.waitForFunction(() => !!window.musicWidget);
  await widget.evaluate(() => musicWidget.openControls('home'));
  let panel;
  const deadline = Date.now() + 12000;
  while (!(panel = app.windows().find(page => page.url().endsWith('/control/index.html'))) && Date.now() < deadline) await delay(40);
  assert.ok(panel, 'The control window must open');
  await panel.waitForFunction(() => !!window.libertyControl && document.getElementById('color-mode'));
  await panel.waitForFunction(async () => (await libertyControl.getState()).connected);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/control/index.html')).setContentSize(1000, 800));
  await panel.waitForFunction(() => innerWidth === 1000 && innerHeight === 800);
  await paletteChecks(panel);
  await narrowChecks(panel);
  await popupChecks();
  await writeFile(join(output, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  assert.deepEqual(errors, [], 'Production renderers must not report errors');
  assert.deepEqual(failures, [], `${failures.length} visual regressions:\n${failures.join('\n')}`);
  console.log('PASS: real Electron/Chromium brightness fill, target/cancel, validation contrast on five palettes, readable vector service icons, long profile/shortcut/source layout, unclipped keyboard ring, popup hover/focus contrast, button spacing and long-error wrapping. Screenshots: artifacts/visual-audit-regression/.');
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
