import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
const profile = await mkdtemp(join(tmpdir(), 'wave-widget-visual-'));
const output = join(root, 'artifacts', 'widget-visual');
const errors = [], measurements = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let app;
function contrast(a, b) {
  const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
try {
  await mkdir(output, { recursive: true });
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--widget-only', '--disable-gpu', '--force-device-scale-factor=1', `--user-data-dir=${profile}`] });
  const widget = await app.firstWindow();
  widget.on('pageerror', error => errors.push(error.message));
  await widget.waitForFunction(() => !!window.musicWidget);
  await widget.evaluate(() => musicWidget.openControls('appearance'));
  let panel;
  const deadline = Date.now() + 12000;
  while (!panel && Date.now() < deadline) { panel = app.windows().find(page => page.url().endsWith('/control/index.html')); if (!panel) await delay(40); }
  assert.ok(panel, 'The settings window must open');
  await panel.waitForFunction(() => !!window.libertyControl);
  panel.on('pageerror', error => errors.push(error.message));
  // Deterministic metadata is sent through the real renderer update function;
  // the demo heartbeat must not replace a deliberately disconnected/long track.
  await widget.evaluate(() => detachState());
  async function render(preferences, extra = {}) {
    const result = await panel.evaluate(preferences => libertyControl.action('preferences', preferences), preferences);
    assert.equal(result.ok, true, result.error);
    await widget.evaluate(async extra => update({ ...await musicWidget.getState(), ...extra }), extra);
    await delay(180);
  }
  const long = { title: 'Очень длинное название музыкальной композиции и её новой версии', artist: 'Очень длинное имя исполнителя', position: 35999, duration: 36060, source: { id: 'visual:long', name: 'Очень длинное название музыкального источника', kind: 'app', provider: 'yandex' }, shortcuts: { active: { toggleInteraction: ['Control+Alt+Shift+Super+MediaPreviousTrack'] } } };
  for (const compact of [false, true]) for (const rhythmBars of [false, true]) for (const scale of [.5, 1, 1.75]) {
    await render({ compact, rhythmBars, scale, showTime: true, surfaceColor: '#202632', opacity: 1, waveMode: 'off' }, long);
    const geometry = await widget.evaluate(() => {
      const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }; };
      const footer = document.querySelector('.widget-footer'), times = document.querySelector('.times');
      return { compact: document.body.classList.contains('compact'), correctParent: times.parentElement === (document.body.classList.contains('compact') ? footer : document.querySelector('.timeline')), footer: box(footer), children: [...footer.children].filter(element => getComputedStyle(element).display !== 'none').map(box), timeCount: document.querySelectorAll('.times').length, elapsedCount: document.querySelectorAll('#elapsed').length };
    });
    assert.equal(geometry.correctParent, true, 'Time must belong to the layout flow instead of a fixed overlay');
    assert.equal(geometry.timeCount, 1); assert.equal(geometry.elapsedCount, 1);
    for (let i = 0; i < geometry.children.length; i++) {
      const box = geometry.children[i];
      assert.ok(box.left >= geometry.footer.left && box.right <= geometry.footer.right + .5, 'Footer content must fit its glass backing');
      if (i) assert.ok(geometry.children[i - 1].right <= box.left + .5, 'Long source, hour timestamps, demo label and shortcut must not overlap');
    }
    if (scale === 1) await widget.screenshot({ path: join(output, `${compact ? 'compact' : 'full'}-${rhythmBars ? 'rhythm' : 'plain'}-long.png`) });
  }
  for (const compact of [true, false, true, false]) {
    await render({ compact, rhythmBars: false, scale: 1, showTime: false });
    assert.equal(await widget.locator('.times').isVisible(), false);
    await render({ showTime: true });
    assert.equal(await widget.locator('.times').isVisible(), true);
    await render({}, { connected: false, source: null, artwork: null, demo: false, capabilities: {}, duration: 0, position: 0 });
    for (const selector of ['.controls', '.timeline', '.times']) assert.equal(await widget.locator(selector).isVisible(), false, `Disconnected ${selector} must not leave an empty raised capsule or fake progress`);
    assert.equal(await widget.locator('#menu').isVisible(), true);
    await widget.screenshot({ path: join(output, `${compact ? 'compact' : 'full'}-disconnected.png`) });
    await render({});
    for (const selector of ['.controls', '.timeline', '.times']) assert.equal(await widget.locator(selector).isVisible(), true, `Reconnection must restore ${selector}`);
  }
  for (const compact of [false, true]) for (const [tone, surfaceColor] of [['light', '#e8edf3'], ['dark', '#202632']]) for (const desktop of ['#000000', '#ffffff']) {
    await render({ compact, surfaceColor, opacity: .25, scale: 1, showTime: true, rhythmBars: false });
    await widget.evaluate(desktop => { document.documentElement.style.backgroundColor = desktop; }, desktop);
    const inspect = await widget.evaluate(() => {
      const rgb = color => { const canvas = document.createElement('canvas'), context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const footer = document.querySelector('.widget-footer').getBoundingClientRect();
      return { viewport: [innerWidth, innerHeight], preferences: state.preferences, items: ['#title', '#artist', '#source-name'].map((selector, i) => { const element = document.querySelector(selector), rect = element.getBoundingClientRect(); return { selector, color: rgb(getComputedStyle(element).color), point: i === 2 ? [footer.left + 3, (footer.top + footer.bottom) / 2] : [rect.right - 3, rect.bottom - 3] }; }) };
    });
    const png = await widget.screenshot({ path: join(output, `${compact ? 'compact' : 'full'}-${tone}-${desktop === '#000000' ? 'black' : 'white'}-opacity25.png`) });
    const backgrounds = await app.evaluate(({ nativeImage }, { png, viewport, points }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64')), { width, height } = image.getSize(), bytes = image.toBitmap();
      return points.map(([x, y]) => { const offset = (Math.floor(y * height / viewport[1]) * width + Math.floor(x * width / viewport[0])) * 4; return [bytes[offset + 2], bytes[offset + 1], bytes[offset]]; });
    }, { png: png.toString('base64'), viewport: inspect.viewport, points: inspect.items.map(item => item.point) });
    const ratios = inspect.items.map((item, i) => ({ selector: item.selector, contrast: contrast(item.color, backgrounds[i]) }));
    assert.ok(ratios[0].contrast >= 4.5, `${tone} title must stay readable at 25% decoration opacity over ${desktop}: ${ratios[0].contrast}`);
    for (const item of ratios.slice(1)) assert.ok(item.contrast >= 3, `${tone} ${item.selector} needs readable secondary contrast over ${desktop}: ${item.contrast}`);
    assert.equal(inspect.preferences.opacity, .25); assert.equal(inspect.preferences.surfaceColor, surfaceColor);
    measurements.push({ compact, tone, desktop, ratios });
  }
  await render({ compact: false, opacity: 1, surfaceColor: '#202632' }, { playing: false, muted: true });
  assert.equal(await widget.locator('#play-icon').getAttribute('href'), '#i-play');
  assert.equal(await widget.locator('#volume-icon').getAttribute('href'), '#i-muted');
  await widget.screenshot({ path: join(output, 'full-paused-muted.png') });
  await render({ compact: false, opacity: 1, surfaceColor: '#e8edf3', color: '#ffffff', colorMode: 'manual' });
  await widget.bringToFront();
  await widget.keyboard.press('Tab');
  await widget.locator('#menu').focus();
  const focus = await widget.locator('#menu').evaluate(element => {
    const rgb = value => { const canvas = document.createElement('canvas'), context = canvas.getContext('2d'); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    return { visible: element.matches(':focus-visible'), outline: rgb(getComputedStyle(element).outlineColor), background: rgb(getComputedStyle(document.documentElement).getPropertyValue('--app-bg')) };
  });
  assert.equal(focus.visible, true);
  assert.ok(contrast(focus.outline, focus.background) >= 3, 'A white accent must not hide keyboard focus against light glass');
  await widget.screenshot({ path: join(output, 'white-accent-keyboard-focus.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  console.log('PASS: real Electron full/compact/rhythm footers across three scales; hour timestamps and long shortcuts without overlap; time visibility/reparenting, disconnected/reconnected states; primary and secondary contrast on actual black/white screenshots at saved 25% decoration opacity; paused/muted icons.');
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
