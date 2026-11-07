import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const { frame, DEFAULT_DISCORD_APPLICATION_ID } = require('../src/discord-presence.cjs');
const profile = await mkdtemp(join(tmpdir(), 'wave-playback-')), packets = [], handshakes = [], sockets = [];
let app, server;
const wait = async predicate => { const until = Date.now() + 10000; while (!await predicate()) { if (Date.now() > until) throw new Error('Playback GUI test timed out'); await new Promise(r => setTimeout(r, 25)); } };
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--disable-gpu', `--user-data-dir=${profile}`], env: { ...process.env, XDG_RUNTIME_DIR: profile } });
  const widget = await app.firstWindow(); await widget.waitForFunction(() => !!window.musicWidget);
  await wait(async () => (await widget.evaluate(() => musicWidget.getState())).connected);
  await widget.evaluate(() => musicWidget.openControls('home'));
  await wait(() => app.windows().some(w => w.url().endsWith('/control/index.html')));
  const control = app.windows().find(w => w.url().endsWith('/control/index.html'));
  await control.waitForFunction(() => !!window.libertyControl);
  // Keep this integration test offline. RPC uses a real local socket; only the
  // optional public cover search is replaced inside the Electron test process.
  await app.evaluate(({ net }) => { net.fetch = async () => new Response('{"results":[]}'); });
  return { widget, control };
}
try {
  // Linux browser CI uses a private runtime directory, isolated from any real
  // desktop Discord. Windows named-pipe framing is covered by the Node suite.
  if (process.platform !== 'linux') throw new Error('Run this GUI suite on Linux with Xvfb');
  server = createServer(socket => {
    sockets.push(socket); socket.on('error', () => {}); let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8 && buffer.length >= 8 + buffer.readUInt32LE(4)) {
        const op = buffer.readUInt32LE(0), size = buffer.readUInt32LE(4), data = JSON.parse(buffer.subarray(8, size + 8)); buffer = buffer.subarray(size + 8);
        if (op === 0) { handshakes.push(data); socket.write(frame(1, { evt: 'READY' })); }
        if (op === 1) { packets.push(data); socket.write(frame(1, { nonce: data.nonce, cmd: data.cmd, data: {} })); }
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(join(profile, 'discord-ipc-0'), resolve); });
  let { widget, control } = await launch();
  const action = (name, value) => control.evaluate(({ name, value }) => libertyControl.action(name, value), { name, value });
  assert.equal(await control.locator('#smooth-playback').isChecked(), true);
  assert.equal(await control.locator('#discord-enabled').isChecked(), false);
  assert.equal((await control.evaluate(() => libertyControl.getState())).discord.applicationId, DEFAULT_DISCORD_APPLICATION_ID);
  assert.equal(await control.locator('#discord-advanced').getAttribute('open'), null);
  assert.equal((await action('discord', { enabled: true, applicationId: 'bad' })).ok, false);
  await widget.evaluate(() => { window.fadeSamples = []; musicWidget.onState(s => fadeSamples.push({ volume: s.volume, playing: s.playing })); });
  await widget.locator('#play-pause').click();
  await wait(async () => { const s = await widget.evaluate(() => musicWidget.getState()); return !s.playing && s.volume === .65; });
  const samples = await widget.evaluate(() => fadeSamples);
  assert.ok(samples.filter(s => s.playing && s.volume > 0 && s.volume < .65).length >= 3, 'Real Electron must publish intermediate fade levels');
  assert.ok(samples.some(s => s.playing && s.volume === 0), 'Playback reaches silence before pausing');
  await widget.locator('#play-pause').click();
  await wait(async () => { const s = await widget.evaluate(() => musicWidget.getState()); return s.playing && s.volume === .65; });
  await control.locator('#smooth-playback').uncheck();
  await wait(async () => !(await control.evaluate(() => libertyControl.getState())).preferences.smoothPlayback);
  await widget.evaluate(() => { fadeSamples.length = 0; });
  assert.equal((await action('command', { command: 'playPause' })).ok, true);
  assert.equal((await widget.evaluate(() => fadeSamples)).some(s => s.volume !== .65), false);
  // A command interrupted by source selection cannot pause or lower the new player.
  await control.locator('#smooth-playback').check();
  await action('command', { command: 'playPause' });
  await widget.locator('#play-pause').click();
  await wait(async () => (await widget.evaluate(() => musicWidget.getState())).volume < .65);
  assert.equal((await action('source', 'demo:spotify')).ok, true);
  await wait(async () => { const s = await widget.evaluate(() => musicWidget.getState()); return s.source.id === 'demo:spotify' && s.volume === .65; });
  await control.locator('#discord-enabled').check();
  await wait(() => packets.some(p => p.args.activity?.details === 'After Dark'));
  assert.equal(handshakes[0].client_id, '1568620348604162058', 'A fresh profile must connect using the shared Liberty Wave ID without manual setup');
  await control.waitForFunction(() => document.getElementById('discord-status').textContent.includes('Подключено'));
  await control.locator('#discord-advanced summary').click();
  await control.locator('#discord-id').fill('1234567890123456789');
  await control.locator('#discord-form button[type="submit"]').click();
  await wait(async () => (await control.evaluate(() => libertyControl.getState())).discord.applicationId === '1234567890123456789');
  await control.locator('#discord-id').fill('1234567890123456790');
  await control.waitForTimeout(1100); assert.equal(await control.locator('#discord-id').inputValue(), '1234567890123456790', 'Heartbeat must preserve an unsaved ID');
  await control.locator('#discord-id').fill('1234567890123456789');
  await control.locator('#discord-form button[type="submit"]').click();
  const clearBefore = packets.filter(p => p.args.activity === null).length;
  await control.locator('#discord-enabled').uncheck(); await wait(() => packets.filter(p => p.args.activity === null).length > clearBefore);
  await control.locator('#discord-advanced summary').click();
  await control.locator('#discord-card').scrollIntoViewIfNeeded();
  await mkdir(join(root, 'artifacts'), { recursive: true }); await control.screenshot({ path: join(root, 'artifacts/playback-discord-settings.png') });
  await app.close(); app = null;
  const saved = JSON.parse(await readFile(join(profile, 'widget.json'), 'utf8'));
  assert.equal(saved.smoothPlayback, true); assert.equal(saved.discordEnabled, false); assert.equal(saved.discordApplicationId, '1234567890123456789');
  ({ control, widget } = await launch());
  assert.equal(await control.locator('#smooth-playback').isChecked(), true); assert.equal(await control.locator('#discord-id').inputValue(), '1234567890123456789'); assert.equal(await control.locator('#discord-enabled').isChecked(), false);
  await control.locator('#discord-advanced summary').click();
  await control.locator('#discord-id').fill('');
  await control.locator('#discord-form button[type="submit"]').click();
  await wait(async () => (await control.evaluate(() => libertyControl.getState())).discord.applicationId === DEFAULT_DISCORD_APPLICATION_ID);
  const nextHandshake = handshakes.length;
  await control.locator('#discord-enabled').check();
  await wait(() => handshakes.length > nextHandshake); assert.equal(handshakes.at(-1).client_id, DEFAULT_DISCORD_APPLICATION_ID);
  await app.close(); app = null;
  const reset = JSON.parse(await readFile(join(profile, 'widget.json'), 'utf8'));
  assert.equal(reset.discordApplicationId, DEFAULT_DISCORD_APPLICATION_ID); assert.equal(reset.discordEnabled, true);
  console.log('PASS: real Electron fades and saved volume, disabled fade, source-switch cancellation, one-switch Discord connection with the shared ID, optional custom ID migration/reset, actual local RPC, off clears presence, edit preservation and restart persistence.');
} finally {
  await app?.close(); for (const socket of sockets) socket.destroy();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
