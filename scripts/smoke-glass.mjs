import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'wave-glass-'));
const legacyProfile = await mkdtemp(join(tmpdir(), 'wave-glass-legacy-'));
const output = join(root, 'artifacts');
let app;
const errors = [];
async function waitState(panel, predicate) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const state = await panel.evaluate(() => libertyControl.getState());
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Glass preferences did not reach the expected state');
}
async function launch(directory = profile) {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--widget-only', '--disable-gpu', `--user-data-dir=${directory}`] });
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const widget = await app.firstWindow();
  widget.on('pageerror', error => errors.push(error.message));
  await widget.waitForFunction(() => !!window.musicWidget);
  await widget.evaluate(() => musicWidget.openControls('home'));
  const deadline = Date.now() + 12000;
  let panel;
  while (!(panel = app.windows().find(page => page.url().endsWith('/control/index.html'))) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok(panel, 'The main control window must open');
  await panel.waitForFunction(() => !!window.libertyControl && document.getElementById('palette-target'));
  await waitState(panel, state => state.connected);
  return { panel, widget };
}
async function token(page, name) { return page.evaluate(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), name); }
async function waitSurface(page, color) {
  await page.waitForFunction(color => getComputedStyle(document.documentElement).getPropertyValue('--surface-color').trim() === color, color, { polling: 40 });
}
async function navigate(panel, name) { await panel.locator(`[data-page="${name}"]`).click(); }
async function action(panel, name, value) {
  const result = await panel.evaluate(({ name, value }) => libertyControl.action(name, value), { name, value });
  assert.equal(result.ok, true, result.error); return result;
}
async function editColor(panel, target, color, save = true) {
  await navigate(panel, 'appearance');
  await panel.locator('#palette-target').selectOption(target);
  await panel.locator('#color-hex').fill(color);
  if (save && !await panel.locator('#color-save').isDisabled()) await panel.locator('#color-save').click();
}

// Read actual resolved DOM colors, compositing translucent ancestor surfaces.
// The known opaque app base is used beneath the transparent widget surface;
// decorative highlights are deliberately not treated as opaque backgrounds.
async function inspectColors(page, selectors, widget = false) {
  return page.evaluate(({ selectors, widget }) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const result = [...context.getImageData(0, 0, 1, 1).data]; result[3] /= 255; return result;
    };
    const over = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3])).concat(1);
    const base = rgba(getComputedStyle(document.documentElement).getPropertyValue('--app-bg'));
    function background(element) {
      const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
      let result = base;
      for (const node of ancestors) result = over(rgba(getComputedStyle(node).backgroundColor), result);
      if (widget) {
        const surface = document.querySelector('.widget-surface');
        result = over(rgba(getComputedStyle(surface).backgroundColor), result);
        if (!element.matches('.widget-surface')) result = over(rgba(getComputedStyle(element).backgroundColor), result);
      }
      return result;
    }
    const luminance = color => {
      const channels = color.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    return Object.fromEntries(selectors.map(selector => {
      const element = document.querySelector(selector); if (!element) throw new Error(`Missing ${selector}`);
      const bg = background(element), fg = over(rgba(getComputedStyle(element).color), bg), a = luminance(bg), b = luminance(fg);
      return [selector, { background: bg.slice(0, 3).map(Math.round), foreground: fg.slice(0, 3).map(Math.round), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }];
    }));
  }, { selectors, widget });
}
async function checkReadability(panel, widget, label) {
  await navigate(panel, 'home');
  const main = await inspectColors(panel, ['#home-title', '#track-title', '#track-artist', 'nav button[aria-current="page"]']);
  const overlay = await inspectColors(widget, ['#title', '#artist'], true);
  for (const [selector, value] of Object.entries({ ...main, ...overlay })) assert.ok(value.contrast >= 4.5, `${label} ${selector}: text contrast ${value.contrast.toFixed(2)} must reach 4.5:1`);
}
async function checkGeometry(widget, compact, rhythmBars) {
  const expected = compact ? { width: 500, height: 144 + (rhythmBars ? 20 : 0) } : { width: 620, height: 270 + (rhythmBars ? 30 : 0) };
  await widget.waitForFunction(expected => innerWidth === expected.width && innerHeight === expected.height, expected, { polling: 40 });
  for (const selector of ['#previous', '#play-pause', '#next', '#volume', '#menu']) {
    assert.equal(await widget.locator(selector).evaluate(element => {
      const box = element.getBoundingClientRect(), card = document.getElementById('widget').getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left >= card.left - 1 && box.top >= card.top - 1 && box.right <= card.right + 1 && box.bottom <= card.bottom + 1;
    }), true, `${compact ? 'Compact' : 'Full'} rhythm=${rhythmBars} ${selector} must stay inside the glass card`);
  }
  assert.equal(await widget.locator('.widget-footer').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight + 1), true, 'Footer must remain inside the native widget window');
}
async function capture(panel, widget, name) {
  await navigate(panel, 'home');
  await panel.evaluate(() => { document.getElementById('content').scrollTop = 0; });
  await panel.screenshot({ path: join(output, `glass-${name}-window.png`) });
  const original = await widget.evaluate(() => document.documentElement.style.background);
  await widget.evaluate(() => { document.documentElement.style.background = 'linear-gradient(135deg,#e5eaf0,#c4cdd9)'; });
  await widget.screenshot({ path: join(output, `glass-${name}-widget.png`) });
  await widget.evaluate(original => { document.documentElement.style.background = original; }, original);
}

try {
  await mkdir(output, { recursive: true });
  let { panel, widget } = await launch();
  let state = await waitState(panel, state => state.preferences.surfaceColor === '#e8edf3');
  assert.equal(state.preferences.color, '#ff3045', 'Adding glass colors must preserve the existing accent default');
  await waitSurface(panel, '#e8edf3'); await waitSurface(widget, '#e8edf3');
  assert.equal(await panel.evaluate(() => document.documentElement.dataset.appearance), 'light');
  assert.equal(await panel.evaluate(() => typeof require), 'undefined');
  assert.equal(await widget.evaluate(() => typeof window.libertyControl), 'undefined');
  await checkReadability(panel, widget, 'Initial glass'); await capture(panel, widget, 'light');
  await navigate(panel, 'appearance');
  await panel.screenshot({ path: join(output, 'glass-palette-window.png') });
  await navigate(panel, 'home');
  const before = await inspectColors(panel, ['body', '.sidebar', '.now-playing']);

  await editColor(panel, 'surface', '#b9d9ca', false);
  await waitSurface(panel, '#b9d9ca');
  assert.equal((await panel.evaluate(() => libertyControl.getState())).preferences.surfaceColor, '#e8edf3', 'A preview must not persist before Apply');
  assert.equal(await token(widget, '--surface-color'), '#e8edf3', 'The overlay must retain the saved color during control-only preview');
  await panel.locator('#color-cancel').click(); await waitSurface(panel, '#e8edf3');
  await panel.locator('#color-hex').fill('#bad');
  assert.equal(await panel.locator('#color-save').isDisabled(), true); assert.equal(await panel.locator('#color-status').isVisible(), true);
  await navigate(panel, 'home'); await waitSurface(panel, '#e8edf3');
  await editColor(panel, 'surface', '#b9d9ca');
  await waitState(panel, state => state.preferences.surfaceColor === '#b9d9ca'); await waitSurface(widget, '#b9d9ca');
  const after = await inspectColors(panel, ['body', '.sidebar', '.now-playing']);
  for (const selector of Object.keys(before)) assert.notDeepEqual(after[selector].background, before[selector].background, `${selector} must change with the full-interface glass color`);
  assert.equal(await token(widget, '--red'), '#ff3045', 'Glass palette must not replace the accent');
  await checkReadability(panel, widget, 'Tinted glass'); await capture(panel, widget, 'tinted');

  for (const surface of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff']) {
    await editColor(panel, 'surface', surface);
    await waitState(panel, state => state.preferences.surfaceColor === surface); await waitSurface(widget, surface);
    await checkReadability(panel, widget, surface);
    if (surface === '#000000') {
      assert.equal(await panel.evaluate(() => document.documentElement.dataset.appearance), 'dark');
      await capture(panel, widget, 'dark');
      await editColor(panel, 'accent', '#757575');
      await checkReadability(panel, widget, 'Near-threshold accent on raised black panels');
      await editColor(panel, 'accent', '#ff3045');
    }
  }
  // Model the compositor's light/dark desktop beneath the native Acrylic
  // branch. Linux CI cannot supply DWM, but it can exercise the exact
  // translucent CSS branch against both possible backdrop extremes.
  for (const surface of ['#666666', '#888888', '#333366']) {
    await editColor(panel, 'surface', surface); await waitSurface(panel, surface);
    await navigate(panel, 'home');
    for (const desktop of ['#ffffff', '#000000']) {
      await panel.evaluate(desktop => {
        document.documentElement.dataset.nativeGlass = 'true';
        document.documentElement.style.backgroundColor = desktop;
      }, desktop);
      const native = await inspectColors(panel, ['.titlebar h1', '.titlebar .version', '.nav-heading', '#home-title', '#track-artist']);
      for (const [selector, value] of Object.entries(native)) assert.ok(value.contrast >= 4.5, `Native glass ${surface} on ${desktop} ${selector}: contrast ${value.contrast.toFixed(2)} must reach 4.5:1`);
    }
  }
  await panel.evaluate(() => { delete document.documentElement.dataset.nativeGlass; document.documentElement.style.backgroundColor = ''; });
  await editColor(panel, 'surface', '#b9d9ca'); await waitSurface(widget, '#b9d9ca');
  await editColor(panel, 'accent', '#438bff');
  await waitState(panel, state => state.preferences.color === '#438bff' && state.preferences.surfaceColor === '#b9d9ca');
  await widget.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--red').trim() === '#438bff');
  await checkReadability(panel, widget, 'Independent accent');

  for (const size of [[1000, 760], [760, 540]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/control/index.html')).setContentSize(...size), size);
    await panel.waitForFunction(size => innerWidth === size[0] && innerHeight === size[1], size);
    for (const name of ['home', 'sources', 'appearance', 'shortcuts', 'updates']) {
      await navigate(panel, name);
      assert.equal(await panel.evaluate(() => {
        const content = document.getElementById('content');
        return document.documentElement.scrollWidth <= innerWidth + 1 && content.scrollWidth <= content.clientWidth + 1;
      }), true, `${name} must not overflow at ${size.join('×')}`);
    }
  }
  await navigate(panel, 'home');
  for (const selector of ['#interaction', '#compact', '#voice-enabled']) {
    const size = await panel.locator(selector).evaluate(element => { const rect = element.getBoundingClientRect(); return [rect.width, rect.height]; });
    assert.deepEqual(size, [34, 20], `${selector} must retain a compact tappable switch`);
  }
  await panel.locator('#interaction').uncheck(); await waitState(panel, state => !state.interaction);
  assert.equal((await widget.evaluate(() => musicWidget.command('next'))).ok, false, 'The pinned widget must remain inert');
  await panel.locator('#interaction').check(); await waitState(panel, state => state.interaction);
  const playing = (await panel.evaluate(() => libertyControl.getState())).playing;
  await widget.locator('#play-pause').click(); await waitState(panel, state => state.playing !== playing);
  for (const compact of [false, true]) for (const rhythmBars of [false, true]) {
    await action(panel, 'preferences', { compact, rhythmBars });
    await waitState(panel, state => state.preferences.compact === compact && state.preferences.rhythmBars === rhythmBars);
    await checkGeometry(widget, compact, rhythmBars);
  }
  await action(panel, 'preferences', { compact: true, rhythmBars: false });
  await capture(panel, widget, 'compact');
  await app.close(); app = null;
  const saved = JSON.parse(await readFile(join(profile, 'widget.json'), 'utf8'));
  assert.equal(saved.surfaceColor, '#b9d9ca'); assert.equal(saved.color, '#438bff');
  ({ panel, widget } = await launch());
  await waitState(panel, state => state.preferences.surfaceColor === '#b9d9ca' && state.preferences.color === '#438bff');
  await waitSurface(widget, '#b9d9ca');
  await app.close(); app = null;

  // Existing installations have no surfaceColor. Their chosen accent must
  // survive adding the new palette, including the persisted on-disk values.
  await writeFile(join(legacyProfile, 'widget.json'), JSON.stringify({ color: '#a855f7', opacity: .6, compact: true, nickname: 'Legacy' }));
  ({ panel, widget } = await launch(legacyProfile));
  state = await waitState(panel, state => state.preferences.color === '#a855f7');
  assert.equal(state.preferences.surfaceColor, '#e8edf3'); assert.equal(state.preferences.opacity, .6); assert.equal(state.preferences.nickname, 'Legacy');
  await waitSurface(widget, '#e8edf3');
  assert.equal(await token(widget, '--red'), '#a855f7');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: real Electron Inset Glass palette previews/apply/cancel, actual window/widget surface colors and readable text on light/dark/saturated colors and native Acrylic backdrops, independent accent, five-screen responsiveness, 34×20 switches, transport/clickthrough, full/compact rhythm layouts, saved restart and legacy migration.');
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await rm(legacyProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
