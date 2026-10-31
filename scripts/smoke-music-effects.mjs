import { _electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'liberty-music-effects-'));
let app, browser, widget, panel;
const errors = [];
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--disable-gpu', `--user-data-dir=${profile}`] });
  widget = await app.firstWindow(); widget.on('pageerror', error => errors.push(error.message));
  await widget.waitForFunction(async () => !!window.musicWidget && (await musicWidget.getState()).connected, null, { polling: 50 });
  await widget.evaluate(() => musicWidget.openControls('appearance'));
  panel = app.windows().find(page => page.url().endsWith('/control/index.html'));
  await panel.waitForFunction(() => !!window.libertyControl, null, { polling: 50 });
  panel.on('pageerror', error => errors.push(error.message));
}
async function stream(kind) {
  await app.evaluate(({ BrowserWindow }, kind) => {
    clearInterval(globalThis.effectsInterval);
    const contents = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html')).webContents;
    let sample = 0;
    globalThis.effectsInterval = setInterval(() => {
      const level = kind === 'quiet' ? (++sample % 4 === 0 ? .012 : .002) : kind === 'loud' ? .8 : 0;
      contents.send('widget:audio-level', { available: kind !== 'off', level });
    }, 100);
  }, kind);
}
const metrics = () => widget.evaluate(() => ({
  scale: Number(document.getElementById('cover').style.getPropertyValue('--cover-scale') || 1),
  beat: Number(document.querySelector('.beat-frame').style.getPropertyValue('--beat-strength') || 0),
  bars: [...document.querySelector('.music-rhythm').children].map(bar => Number(/scaleY\(([^)]+)\)/.exec(bar.style.transform)?.[1] || 0)),
  contour: document.getElementById('edge-wave-ring').getAttribute('d')
}));
try {
  await launch();
  await panel.locator('#cover-pulse').check(); await panel.locator('#rhythm-bars').check(); await panel.locator('#beat-glow').check();
  await widget.waitForFunction(() => innerWidth === 620 && innerHeight === 300 && document.body.classList.contains('has-rhythm-bars'), null, { polling: 50 });
  assert.equal(await widget.locator('.music-rhythm i').count(), 16);
  await stream('loud'); await widget.waitForTimeout(2800);
  const steady = await metrics(); assert.equal(steady.scale, 1); assert.equal(steady.beat, 0); assert.ok(steady.bars.every(value => value === 0));
  await panel.evaluate(() => libertyControl.action('interaction', false));
  browser = await chromium.launch({ channel: 'chromium', headless: false });
  const other = await browser.newPage(); await other.setContent('<h1>Focused game fixture</h1>'); await other.bringToFront();
  await stream('quiet');
  let pulse = false, glow = false, bars = false, contour = false;
  for (let i = 0; i < 24; i++) {
    await widget.waitForTimeout(90); const value = await metrics();
    pulse ||= value.scale > 1.005; glow ||= value.beat > .15; bars ||= value.bars.some(value => value > .15); contour ||= value.contour !== steady.contour;
  }
  assert.ok(pulse && glow && bars && contour, JSON.stringify({ pulse, glow, bars, contour }));
  assert.equal(await other.evaluate(() => document.hasFocus()), true, 'Music effects must not steal focus');
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await widget.screenshot({ path: join(root, 'artifacts/music-effects-full.png') });
  await panel.evaluate(() => libertyControl.action('preferences', { waveMode: 'off' }));
  await widget.locator('.edge-waves').waitFor({ state: 'hidden' });
  let independentPulse = false;
  for (let i = 0; i < 8; i++) { await widget.waitForTimeout(100); independentPulse ||= (await metrics()).scale > 1.005; }
  assert.ok(independentPulse, 'Cover effects must work independently of the contour');
  await widget.emulateMedia({ reducedMotion: 'reduce' }); await widget.waitForTimeout(200);
  const reduced = await metrics(); assert.equal(reduced.scale, 1); assert.equal(reduced.beat, 0); assert.ok(reduced.bars.every(value => value === 0));
  await widget.emulateMedia({ reducedMotion: 'no-preference' });
  await stream('off'); await widget.waitForTimeout(1800);
  const silent = await metrics(); assert.equal(silent.scale, 1); assert.equal(silent.beat, 0); assert.ok(silent.bars.every(value => value === 0));
  await stream('quiet'); await panel.evaluate(() => libertyControl.action('command', { command: 'playPause' }));
  await widget.waitForTimeout(500); const paused = await metrics(); assert.equal(paused.scale, 1); assert.equal(paused.beat, 0);
  await panel.evaluate(() => libertyControl.action('command', { command: 'playPause' }));
  await panel.evaluate(() => libertyControl.action('preferences', { compact: true, waveEconomy: true }));
  await widget.waitForFunction(() => innerWidth === 500 && innerHeight === 164, null, { polling: 50 });
  assert.equal(await widget.evaluate(() => {
    const card = document.getElementById('widget').getBoundingClientRect(), bars = document.querySelector('.music-rhythm').getBoundingClientRect(), footer = document.querySelector('.widget-footer').getBoundingClientRect();
    return bars.bottom <= card.bottom && bars.left >= card.left && bars.right <= card.right && footer.bottom <= innerHeight;
  }), true);
  await widget.waitForFunction(() => Number(document.getElementById('cover').style.getPropertyValue('--cover-scale') || 1) > 1.005 && [...document.querySelector('.music-rhythm').children].some(bar => Number(/scaleY\(([^)]+)\)/.exec(bar.style.transform)?.[1] || 0) > .1), null, { polling: 50 });
  await widget.screenshot({ path: join(root, 'artifacts/music-effects-compact.png') });
  await stream('off');
  await panel.evaluate(() => libertyControl.action('source', 'demo:spotify'));
  const switched = await metrics(); assert.equal(switched.scale, 1); assert.equal(switched.beat, 0); assert.ok(switched.bars.every(value => value === 0));
  await browser.close(); browser = null;
  await app.close(); app = null; await launch();
  const restored = await panel.evaluate(() => libertyControl.getState());
  for (const key of ['coverPulse', 'rhythmBars', 'beatGlow']) assert.equal(restored.preferences[key], true);
  await widget.waitForFunction(() => innerWidth === 500 && innerHeight === 164, null, { polling: 50 });
  await panel.locator('#beat-glow').scrollIntoViewIfNeeded();
  await panel.screenshot({ path: join(root, 'artifacts/music-effects-settings.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: steady loud sound settles; quiet changes drive contour, cover pulse, rhythm bars and beat glow; independent effects, unfocused pinned mode, pause/silence/source reset, reduced motion, compact layout and restart persistence.');
} finally { await browser?.close(); await app?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
