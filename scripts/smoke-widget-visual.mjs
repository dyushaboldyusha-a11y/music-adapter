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
async function screenshotPixels(png, viewport, points) {
  return app.evaluate(({ nativeImage }, { png, viewport, points }) => {
    const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64')), { width, height } = image.getSize(), bytes = image.toBitmap();
    return points.map(([x, y]) => {
      const px = Math.max(0, Math.min(width - 1, Math.floor(x * width / viewport[0]))), py = Math.max(0, Math.min(height - 1, Math.floor(y * height / viewport[1])));
      const offset = (py * width + px) * 4;
      return [bytes[offset + 2], bytes[offset + 1], bytes[offset]];
    });
  }, { png: png.toString('base64'), viewport, points });
}
function effectiveAlpha(black, white) {
  return 1 - white.reduce((sum, value, index) => sum + (value - black[index]) / 255, 0) / 3;
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
      assert.ok(box.left >= geometry.footer.left && box.right <= geometry.footer.right + .5, 'Footer content must fit its available layout');
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
  for (const compact of [false, true]) for (const [tone, surfaceColor] of [['light', '#e8edf3'], ['dark', '#202632']]) {
    const samples = new Map();
    for (const opacity of [1, .25]) for (const desktop of ['#000000', '#ffffff']) {
      await render({ compact, surfaceColor, opacity, scale: 1, showTime: true, rhythmBars: false });
      await widget.evaluate(desktop => { document.documentElement.style.backgroundColor = desktop; document.documentElement.style.backgroundImage = ''; }, desktop);
      const inspect = await widget.evaluate(() => {
        const rgb = color => { const canvas = document.createElement('canvas'), context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        const footer = document.querySelector('.widget-footer').getBoundingClientRect(), card = document.getElementById('widget').getBoundingClientRect();
        return {
          viewport: [innerWidth, innerHeight], preferences: state.preferences,
          samplePoints: [[(card.left + card.right) / 2, card.bottom - 5], [footer.right - 3, (footer.top + footer.bottom) / 2]],
          items: ['#title', '#artist', '#source-name'].map((selector, i) => { const element = document.querySelector(selector), rect = element.getBoundingClientRect(); return { selector, color: rgb(getComputedStyle(element).color), point: i === 2 ? [footer.right - 3, (footer.top + footer.bottom) / 2] : [rect.right - 3, rect.bottom - 3] }; }),
          foregroundOpacities: ['#title', '#artist', '#play-pause', '.timeline'].map(selector => getComputedStyle(document.querySelector(selector)).opacity),
          sourceName: document.getElementById('source-name').textContent, expectedSourceName: state.source?.name || 'Ожидание плеера'
        };
      });
      const png = await widget.screenshot({ path: join(output, `${compact ? 'compact' : 'full'}-${tone}-${desktop === '#000000' ? 'black' : 'white'}-opacity${Math.round(opacity * 100)}.png`) });
      const pixels = await screenshotPixels(png, inspect.viewport, [...inspect.samplePoints, ...inspect.items.map(item => item.point)]);
      samples.set(`${opacity}:${desktop}`, pixels.slice(0, 2));
      const ratios = inspect.items.map((item, i) => ({ selector: item.selector, contrast: contrast(item.color, pixels[i + 2]) }));
      // A freely transparent surface cannot guarantee fixed-palette contrast on
      // every wallpaper without the opaque backing the user explicitly rejected.
      // Check readable foreground on compatible wallpapers and retain opposite
      // extreme screenshots as visual evidence rather than forcing a new floor.
      if (tone === 'light' && desktop === '#ffffff' || tone === 'dark' && desktop === '#000000') {
        assert.ok(ratios[0].contrast >= 4.5, `${tone} title must stay readable on its compatible wallpaper: ${ratios[0].contrast}`);
        for (const item of ratios.slice(1)) assert.ok(item.contrast >= 3, `${tone} ${item.selector} needs readable secondary contrast: ${item.contrast}`);
      }
      assert.deepEqual(inspect.foregroundOpacities, ['1', '1', '1', '1'], 'Transparency must not fade text or transport hit targets');
      assert.equal(inspect.sourceName, inspect.expectedSourceName, 'The source caption must omit application/browser kind labels');
      assert.equal(await widget.locator('#key-hint').count(), 0, 'The widget must not include a pin/unpin instruction');
      assert.equal(await widget.locator('#voice-indicator').count(), 0, 'The widget must not include the voice label or badge');
      assert.equal(inspect.preferences.opacity, opacity); assert.equal(inspect.preferences.surfaceColor, surfaceColor);
      measurements.push({ compact, tone, desktop, opacity, ratios, backgroundPixels: pixels.slice(0, 2) });
    }
    for (const [index, layer] of ['card', 'footer'].entries()) {
      const full = effectiveAlpha(samples.get('1:#000000')[index], samples.get('1:#ffffff')[index]);
      const low = effectiveAlpha(samples.get('0.25:#000000')[index], samples.get('0.25:#ffffff')[index]);
      assert.ok(full > .1 && full < .85, `${tone} ${layer} must be visibly translucent at 100%: alpha ${full}`);
      assert.ok(low >= -.02 && low < full * .65, `${tone} ${layer} must actually fade at 25% instead of keeping a fixed backing: ${full} → ${low}`);
      assert.ok(full - low >= .15, `${tone} ${layer} opacity control must change actual rendered pixels`);
      measurements.push({ compact, tone, layer, alpha100: full, alpha25: low });
    }
    await widget.evaluate(() => { document.documentElement.style.backgroundImage = 'radial-gradient(ellipse at 80% 20%,#a37665 0%,transparent 55%),linear-gradient(130deg,#1c3348,#637367 55%,#d6bc83)'; });
    await widget.screenshot({ path: join(output, `${compact ? 'compact' : 'full'}-${tone}-textured-opacity25.png`) });
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
  console.log('PASS: real Electron full/compact/rhythm layouts across three scales; time visibility and source reconnection; actual card/footer translucency at 100% and 25% on black/white/textured wallpapers without an opaque floor; opaque foreground, compatible-wallpaper contrast, removed voice/kind/pin labels, paused/muted icons and keyboard focus.');
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
