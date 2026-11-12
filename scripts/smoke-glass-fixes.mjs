import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'artifacts');
const failures = [], errors = [], measurements = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let app, profile;
function check(label, predicate) {
  try { predicate(); } catch (error) { failures.push(`${label}: ${error.message}`); }
}
async function action(panel, value) {
  const result = await panel.evaluate(value => libertyControl.action('preferences', value), value);
  assert.equal(result.ok, true, result.error);
  await panel.waitForFunction(async value => {
    const saved = (await libertyControl.getState()).preferences;
    return Object.entries(value).every(([key, expected]) => saved[key] === expected);
  }, value);
}
async function launch(dpi) {
  profile = await mkdtemp(join(tmpdir(), 'wave-glass-fixes-'));
  app = await _electron.launch({
    executablePath: require('electron'),
    args: [root, '--demo', '--widget-only', '--disable-gpu', `--force-device-scale-factor=${dpi}`, `--user-data-dir=${profile}`]
  });
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  const widget = await app.firstWindow();
  widget.on('pageerror', error => errors.push(error.message));
  await widget.waitForFunction(() => !!window.musicWidget);
  await widget.evaluate(() => musicWidget.openControls('home'));
  const deadline = Date.now() + 12000;
  let panel;
  while (!(panel = app.windows().find(page => page.url().endsWith('/control/index.html'))) && Date.now() < deadline) await delay(40);
  assert.ok(panel, 'The control window must open');
  await panel.waitForFunction(() => !!window.libertyControl && document.getElementById('color-mode'));
  await panel.waitForFunction(async () => (await libertyControl.getState()).connected);
  return { widget, panel };
}

// Read pixels from Chromium's real screenshot, including backdrop-filter and
// scrollbars. Sample CSS coordinates after accounting for the native DPI.
async function pixels(png, viewport, points) {
  return app.evaluate(({ nativeImage }, { data, viewport, points }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
    const { width, height } = image.getSize(), bitmap = image.toBitmap();
    return points.map(([x, y]) => {
      const px = Math.max(0, Math.min(width - 1, Math.floor(x * width / viewport.width)));
      const py = Math.max(0, Math.min(height - 1, Math.floor(y * height / viewport.height)));
      const offset = (py * width + px) * 4;
      return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
    });
  }, { data: png.toString('base64'), viewport, points });
}
const difference = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));

async function panelChecks(panel) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/control/index.html')).setContentSize(1000, 800));
  await panel.waitForFunction(() => innerWidth === 1000 && innerHeight === 800);
  await panel.locator('[data-page="appearance"]').click();
  for (const [name, surfaceColor] of [['light', '#dce8f7'], ['dark', '#202632'], ['pink', '#f700d0']]) {
    await action(panel, { surfaceColor, color: '#d1d5db', colorMode: 'manual' });
    await panel.waitForFunction(color => getComputedStyle(document.documentElement).getPropertyValue('--surface-color').trim() === color, surfaceColor);
    for (const nativeGlass of [false, true]) for (const desktop of ['#000000', '#ffffff']) {
      const label = `${name}-${nativeGlass ? 'native' : 'fallback'}-${desktop === '#000000' ? 'black' : 'white'}`;
      // DWM is unavailable on Linux. Exercise the exact native CSS branch
      // above explicit black/white desktop extremes instead of changing tokens.
      await panel.evaluate(({ nativeGlass, desktop }) => {
        document.documentElement.dataset.nativeGlass = String(nativeGlass);
        document.documentElement.style.backgroundColor = desktop;
        document.getElementById('content').scrollTop = 0;
      }, { nativeGlass, desktop });
      await delay(45);
      const geometry = await panel.evaluate(() => {
        const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const palette = box(document.querySelector('.palette-card')), source = box(document.getElementById('color-mode').closest('.card'));
        return { viewport: { width: innerWidth, height: innerHeight }, palette, source, pane: box(document.getElementById('content')), gap: source.top - palette.bottom };
      });
      measurements.push({ panel: label, gap: geometry.gap });
      check(label, () => assert.ok(geometry.gap >= 12, `palette cards need ≥12 px breathing room; measured ${geometry.gap.toFixed(2)} px`));
      check(label, () => assert.ok(geometry.source.bottom <= geometry.pane.bottom - 5, 'The accent source card must be visible with the palette at this window size'));
      const png = await panel.screenshot({ path: join(output, `glass-fixes-${label}-window.png`) });
      const { width, height } = geometry.viewport, p = geometry.pane;
      const corners = [[1, 1], [width - 2, 1], [1, height - 2], [width - 2, height - 2]];
      // Compare excluded pane corners with their immediately adjacent backing.
      // A square backdrop/scrollbar layer produces a visible discontinuity here.
      const paneCorners = [
        [[p.left + 2, p.top + 2], [p.left - 2, p.top + 2]],
        [[p.right - 3, p.top + 2], [p.right + 2, p.top + 2]],
        [[p.left + 2, p.bottom - 3], [p.left - 2, p.bottom - 3]],
        [[p.right - 3, p.bottom - 3], [p.right + 2, p.bottom - 3]]
      ];
      const colors = await pixels(png, geometry.viewport, [...corners, ...paneCorners.flat()]);
      const expected = desktop === '#000000' ? [0, 0, 0] : [255, 255, 255];
      for (let i = 0; i < corners.length; i++) check(`${label} outer corner ${i}`, () => assert.ok(difference(colors[i], expected) <= 8, `window backing escapes rounded root: ${colors[i]} vs desktop ${expected}`));
      for (let i = 0; i < paneCorners.length; i++) check(`${label} pane corner ${i}`, () => assert.ok(difference(colors[4 + i * 2], colors[5 + i * 2]) <= 24, `square pane backing differs from its surround: ${colors[4 + i * 2]} vs ${colors[5 + i * 2]}`));
      if (!nativeGlass && desktop === '#000000') {
        const left = Math.floor(geometry.palette.left - 5), top = Math.floor(geometry.palette.top - 5);
        await panel.screenshot({ path: join(output, `glass-fixes-${name}-palette.png`), clip: { x: left, y: top, width: Math.ceil(geometry.palette.width + 10), height: Math.ceil(geometry.source.bottom - top + 5) } });
      }
    }
  }
  await panel.evaluate(() => { delete document.documentElement.dataset.nativeGlass; document.documentElement.style.backgroundColor = ''; });
}

async function waveGeometry(widget) {
  return widget.evaluate(() => {
    const surface = document.querySelector('.widget-surface'), card = surface.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(surface).borderTopLeftRadius);
    const path = document.getElementById('edge-wave-ring'), matrix = path.getScreenCTM(), length = path.getTotalLength();
    const distances = [], points = [];
    for (let i = 0; i < 640; i++) {
      const point = path.getPointAtLength(length * i / 640).matrixTransform(matrix);
      // Signed distance to the actual rendered rounded card: positive means
      // outside. This catches gaps and incorrect corner shapes independently
      // of how the animation constructs its SVG path or viewBox.
      const qx = Math.abs(point.x - (card.left + card.right) / 2) - (card.width / 2 - radius);
      const qy = Math.abs(point.y - (card.top + card.bottom) / 2) - (card.height / 2 - radius);
      distances.push(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius);
      points.push([point.x, point.y]);
    }
    return {
      min: Math.min(...distances), max: Math.max(...distances),
      mean: distances.reduce((sum, value) => sum + value, 0) / distances.length,
      radius, path: path.getAttribute('d'),
      viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
      contained: points.every(([x, y]) => x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight),
      stroke: getComputedStyle(document.querySelector('.edge-wave')).stroke,
      hidden: document.querySelector('.edge-waves').hasAttribute('hidden')
    };
  });
}
async function settleLayout(widget) {
  // Zoom changes update the native viewport and ResizeObserver in separate
  // turns. Compare geometry only once both have stopped changing; a stable
  // but incorrectly fitted contour still fails the distance assertions below.
  const signature = () => widget.evaluate(() => {
    const card = document.getElementById('widget').getBoundingClientRect();
    return JSON.stringify([innerWidth, innerHeight, devicePixelRatio, card.width, card.height, document.querySelector('.edge-waves').getAttribute('viewBox'), document.getElementById('edge-wave-ring').getAttribute('d')]);
  });
  await delay(150);
  let previous = await signature();
  for (let i = 0; i < 10; i++) {
    await delay(75);
    const current = await signature();
    if (current === previous) return;
    previous = current;
  }
  throw new Error('Reduced-motion card and wave did not finish resizing');
}
async function widgetChecks(panel, widget, dpi) {
  await action(panel, { surfaceColor: '#202632', color: '#d1d5db', colorMode: 'manual', waveMode: 'audio', waveIntensity: 1, waveEconomy: false, coverPulse: false, beatGlow: false });
  for (const compact of [false, true]) for (const rhythmBars of [false, true]) for (const scale of [.5, 1, 1.75]) {
    const label = `dpi${dpi}-${compact ? 'compact' : 'full'}-${rhythmBars ? 'rhythm' : 'plain'}-scale${scale}`;
    await widget.emulateMedia({ reducedMotion: 'reduce' });
    await action(panel, { compact, rhythmBars, scale, waveMode: 'audio' });
    const size = compact ? [500, 144 + (rhythmBars ? 20 : 0)] : [620, 270 + (rhythmBars ? 30 : 0)];
    // Electron rounds native DIP bounds to physical pixels, then the page
    // rounds its CSS viewport again. At 125% DPI / 50% zoom this is up to 3px.
    const rounding = Math.ceil(1 / (dpi * scale)) + 1;
    try {
      await widget.waitForFunction(({ size, rounding }) => Math.abs(innerWidth - size[0]) <= rounding && Math.abs(innerHeight - size[1]) <= rounding, { size, rounding }, { timeout: 5000 });
    } catch (error) {
      throw new Error(`${label}: expected viewport ${size.join('×')}; measured ${JSON.stringify(await widget.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })))}`, { cause: error });
    }
    await settleLayout(widget);
    const rest = await waveGeometry(widget);
    check(`${label} resting outline`, () => {
      assert.equal(rest.hidden, false, 'The enabled outline must stay visible at rest');
      assert.ok(rest.min >= 1 && rest.max <= 3.5, `outline must follow card edges and corners closely: ${rest.min.toFixed(2)}…${rest.max.toFixed(2)} px`);
      assert.ok(rest.max - rest.min <= .75, `resting corner gap must match straight edges: variation ${(rest.max - rest.min).toFixed(2)} px`);
      assert.equal(rest.contained, true, 'The wave must fit within the transparent native window');
    });
    await delay(100);
    const still = await waveGeometry(widget);
    check(`${label} reduced motion`, () => assert.ok(still.path === rest.path, 'Reduced motion must leave a stable resting outline'));
    await widget.emulateMedia({ reducedMotion: 'no-preference' });
    await action(panel, { waveMode: 'ambient' });
    const paths = new Set();
    let min = Infinity, max = -Infinity;
    for (let frame = 0; frame < 4; frame++) {
      await delay(65);
      const current = await waveGeometry(widget);
      paths.add(current.path); min = Math.min(min, current.min); max = Math.max(max, current.max);
      check(`${label} active bounds`, () => assert.equal(current.contained, true, 'Animated outline must remain inside the transparent window'));
    }
    check(`${label} animated outline`, () => {
      assert.ok(paths.size >= 2, 'An enabled ambient wave must animate');
      assert.ok(min >= .5 && max <= 7, `animation must stay outside and close to the card: ${min.toFixed(2)}…${max.toFixed(2)} px`);
    });
    measurements.push({ widget: label, dpr: rest.dpr, radius: rest.radius, rest: [rest.min, rest.max], active: [min, max] });
    if (dpi === 1 && scale === 1) {
      await widget.evaluate(() => { document.documentElement.style.backgroundColor = '#080a0e'; });
      await widget.screenshot({ path: join(output, `glass-fixes-${label}-widget.png`) });
      await action(panel, { color: '#68b5ff' });
      await widget.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--red').trim() === '#68b5ff');
      await widget.screenshot({ path: join(output, `glass-fixes-${label}-wave-visible.png`) });
      await action(panel, { color: '#d1d5db' });
      await widget.evaluate(() => { document.documentElement.style.backgroundColor = ''; });
    }
  }
  // A hidden SVG has no layout viewport. Changing size while it is hidden and
  // enabling it again must remeasure the current card before drawing.
  for (const disabled of [{ waveMode: 'off' }, { waveIntensity: 0 }]) {
    const label = `dpi${dpi} restore ${Object.keys(disabled)[0]}`;
    await widget.emulateMedia({ reducedMotion: 'reduce' });
    await action(panel, { compact: false, rhythmBars: false, scale: 1, waveMode: 'audio', waveIntensity: 1, ...disabled });
    await widget.waitForFunction(() => document.querySelector('.edge-waves').hasAttribute('hidden'));
    await action(panel, { compact: true, rhythmBars: true });
    await widget.waitForFunction(() => document.body.classList.contains('compact') && document.body.classList.contains('has-rhythm-bars'));
    await action(panel, { waveMode: 'audio', waveIntensity: 1 });
    await widget.waitForFunction(() => !document.querySelector('.edge-waves').hasAttribute('hidden'));
    await settleLayout(widget);
    const restored = await waveGeometry(widget);
    check(label, () => {
      assert.ok(restored.min >= 1 && restored.max <= 3.5, `Re-enabled outline must fit the current card: ${restored.min}…${restored.max}`);
      assert.equal(restored.contained, true);
    });
    // Enable/disable again without another resize to cover the common toggle.
    await action(panel, disabled);
    await widget.waitForFunction(() => document.querySelector('.edge-waves').hasAttribute('hidden'));
    await action(panel, { waveMode: 'audio', waveIntensity: 1 });
    await widget.waitForFunction(() => !document.querySelector('.edge-waves').hasAttribute('hidden'));
    await settleLayout(widget);
    const toggled = await waveGeometry(widget);
    check(`${label} without resize`, () => assert.ok(toggled.min >= 1 && toggled.max <= 3.5, `Toggle must restore a close-fitting outline: ${toggled.min}…${toggled.max}`));
  }
  await widget.emulateMedia({ reducedMotion: 'no-preference' });
  await action(panel, { waveMode: 'audio', compact: false, rhythmBars: false, scale: 1 });
  // Exercise the real IPC audio input, then verify that silence settles back to
  // the same close-fitting outline instead of leaving a displaced frame.
  for (let i = 0; i < 8; i++) {
    await app.evaluate(({ BrowserWindow }, level) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).webContents.send('widget:audio-level', { available: true, level }), i % 2 ? .95 : .2);
    await delay(45);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html')).webContents.send('widget:audio-level', { available: false, level: 0 }));
  await delay(2300);
  const silent = await waveGeometry(widget);
  await delay(200);
  const settled = await waveGeometry(widget);
  check(`dpi${dpi} silence`, () => {
    assert.ok(settled.min >= 1 && settled.max <= 3.5, `Silent wave must settle along the card: ${settled.min}…${settled.max}`);
    assert.equal(settled.path, silent.path, 'Silence must leave a stationary outline');
  });
}

try {
  await mkdir(output, { recursive: true });
  for (const dpi of [1, 1.25]) {
    const { widget, panel } = await launch(dpi);
    if (dpi === 1) await panelChecks(panel);
    await widgetChecks(panel, widget, dpi);
    console.log(`Checked native DPI ${dpi}: panel and wave measurements collected.`);
    await app.close(); app = null;
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); profile = null;
  }
  assert.deepEqual(errors, [], 'Renderer must not report errors');
  await writeFile(join(output, 'glass-fixes-measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  assert.deepEqual(failures, [], `${failures.length} visual regressions:\n${failures.join('\n')}`);
  console.log('PASS: actual Electron light/dark/pink panels, native/fallback glass over black/white, rounded window/pane corners and ≥12px palette spacing; close-fitting SVG wave edges/corners across full/compact/rhythm, three scales and two DPIs, reduced motion and silence. Screenshots: artifacts/glass-fixes-*.png.');
} finally {
  await app?.close();
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
