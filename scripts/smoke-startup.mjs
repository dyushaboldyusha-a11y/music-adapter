import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
const output = join(root, 'artifacts/startup-layout');
await mkdir(output, { recursive: true });
const results = [];
for (const rhythmBars of [false, true]) for (const dpi of [1, 1.25, 1.5]) for (const compact of [false, true]) for (const scale of [.5, 1, 1.75]) {
  const profile = await mkdtemp(join(tmpdir(), 'liberty-startup-'));
  let app;
  try {
    await writeFile(join(profile, 'widget.json'), JSON.stringify({ scale, compact, rhythmBars, coverPulse: rhythmBars, beatGlow: rhythmBars, bounds: { x: 1500, y: 800 }, compactBounds: { x: 1500, y: 800 } }));
    // Use normal startup: demo mode enables editing, which already reapplies
    // the layout and used to hide the pinned-startup zoom regression.
    app = await _electron.launch({ executablePath: require('electron'), args: [root, '--disable-gpu', `--force-device-scale-factor=${dpi}`, `--user-data-dir=${profile}`] });
    const widget = await app.firstWindow();
    await widget.waitForFunction(() => !!window.musicWidget, null, { polling: 50 });
    const deadline = Date.now() + 10000;
    let native;
    do {
      native = await app.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html'));
        return { visible: window.isVisible(), bounds: window.getBounds(), zoom: window.webContents.getZoomFactor(), area: screen.getDisplayMatching(window.getBounds()).workArea };
      });
      if (!native.visible) await widget.waitForTimeout(50);
    } while (!native.visible && Date.now() < deadline);
    assert.equal(native.visible, true, 'The widget must become visible');
    await widget.waitForFunction(compact => document.body.classList.contains('locked') && document.body.classList.contains('compact') === compact, compact, { polling: 50 });
    const state = await widget.evaluate(() => musicWidget.getState());
    assert.equal(state.interaction, false, 'Startup must stay pinned without needing the interaction hotkey');
    assert.equal(state.preferences.compact, compact);
    assert.equal(state.preferences.rhythmBars, rhythmBars);
    const viewport = await widget.evaluate(() => {
      const card = document.getElementById('widget').getBoundingClientRect(), footer = document.querySelector('.widget-footer').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, right: card.right, bottom: Math.max(card.bottom, footer.bottom) };
    });
    const expected = compact ? { width: 500, height: 144 + (rhythmBars ? 20 : 0) } : { width: 620, height: 270 + (rhythmBars ? 30 : 0) };
    const label = `DPI ${dpi}, compact ${compact}, scale ${scale}, rhythm bars ${rhythmBars}`;
    assert.ok(Math.abs(viewport.width - expected.width) <= 2 && Math.abs(viewport.height - expected.height) <= 2, `${label}: viewport must match the layout before any hotkey: ${JSON.stringify(viewport)}`);
    assert.ok(viewport.right <= viewport.width + 1 && viewport.bottom <= viewport.height + 1, `${label}: content must fit inside the window`);
    const { bounds, area } = native;
    assert.ok(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width + 1 && bounds.y + bounds.height <= area.y + area.height + 1, `${label}: window must fit on the available screen`);
    results.push({ dpi, compact, scale, rhythmBars, native, viewport });
    if (dpi === 1 && scale === .5) {
      const capture = await app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/renderer/index.html'));
        const image = await window.capturePage();
        return { size: image.getSize(), png: image.toPNG().toString('base64') };
      });
      await writeFile(join(output, `${rhythmBars ? 'rhythm-' : ''}${compact ? 'compact' : 'full'}-half-scale.png`), Buffer.from(capture.png, 'base64'));
      assert.deepEqual(capture.size, { width: native.bounds.width, height: native.bounds.height }, 'The captured surface must cover the complete native window');
    }
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log('PASS: 36 normal pinned cold starts with/without music effects, 50/100/175% widget scale and 100/125/150% DPI, full/compact content and offscreen positions restored without pressing a hotkey.');
