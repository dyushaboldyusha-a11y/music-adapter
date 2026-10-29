import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'music-adapter-gui-'));
const binary = require('electron');
const electronArgs = [root, '--demo', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`];
const command = process.platform === 'linux' ? 'xvfb-run' : binary;
const args = process.platform === 'linux' ? ['-a', '-s', '-screen 0 1280x800x24 -nolisten tcp', binary, ...electronArgs] : electronArgs;
const child = spawn(command, args, { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
const exited = once(child, 'exit');
let logs = '', socket, nextId = 0;
const pending = new Map();
child.stdout.on('data', chunk => { logs += chunk; });
child.stderr.on('data', chunk => { logs += chunk; });
const pause = time => new Promise(resolve => setTimeout(resolve, time));
function call(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(expression) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await pause(50); }
  throw new Error(`UI did not reach expected state: ${expression}`);
}
try {
  const deadline = Date.now() + 30000;
  while (!logs.includes('DevTools listening on ws://')) {
    if (child.exitCode !== null || child.signalCode || Date.now() > deadline) throw new Error(`Electron did not start: ${logs}`);
    await pause(100);
  }
  const browserUrl = logs.match(/DevTools listening on (ws:\/\/\S+)/)[1];
  const pages = await (await fetch(`http://${new URL(browserUrl).host}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.addEventListener('message', event => {
    const reply = JSON.parse(event.data);
    const item = pending.get(reply.id);
    if (item) { clearTimeout(item.timer); pending.delete(reply.id); reply.error ? item.reject(new Error(JSON.stringify(reply.error))) : item.resolve(reply.result); }
  });
  await waitFor('document.getElementById("title").textContent === "After Dark"');
  assert.equal(await evaluate('typeof require'), 'undefined', 'Node must stay isolated from the renderer');
  assert.equal(await evaluate('window.musicWidget.getState().then(s => s.demo)'), true);
  await evaluate('document.getElementById("play-pause").click()');
  await waitFor('document.getElementById("play-pause").getAttribute("aria-label") === "Воспроизвести"');
  await evaluate('document.getElementById("next").click()');
  await waitFor('document.getElementById("title").textContent === "The Perfect Girl"');
  await evaluate('document.getElementById("previous").click()');
  await waitFor('document.getElementById("title").textContent === "After Dark"');
  await evaluate('(()=>{const seek=document.getElementById("seek");seek.value=84;seek.dispatchEvent(new Event("input"));seek.dispatchEvent(new Event("change"));})()');
  await waitFor('window.musicWidget.getState().then(s => s.position === 84)');
  assert.equal(await evaluate('document.getElementById("elapsed").textContent'), '1:24');
  await evaluate('document.getElementById("shuffle").click()');
  await waitFor('document.getElementById("shuffle").getAttribute("aria-pressed") === "true"');
  await evaluate('document.getElementById("repeat").click(); document.getElementById("shuffle").click()');
  await waitFor('window.musicWidget.getState().then(s => s.repeat === "list" && !s.shuffle)');
  await evaluate('window.musicWidget.toggleInteraction()');
  await waitFor('document.body.classList.contains("locked")');
  const blocked = await evaluate('window.musicWidget.command("next")');
  assert.equal(blocked.ok, false, 'Pinned widget must reject media actions');
  await evaluate('window.musicWidget.toggleInteraction()');
  await waitFor('!document.body.classList.contains("locked")');
  assert.equal(await evaluate('document.querySelector(".heart").disabled'), true);
  const dimensions = await evaluate('({h:innerHeight,bottom:document.querySelector(".widget-footer").getBoundingClientRect().bottom})');
  assert.ok(dimensions.bottom <= dimensions.h, 'Footer must fit in the transparent window');
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await evaluate('window.musicWidget.command("repeat","none")');
  const transparent = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(root, 'artifacts/widget-transparent.png'), Buffer.from(transparent.data, 'base64'));
  // A preview backdrop lets PNG viewers show the glass and faint glow correctly.
  // This is only applied to the test window immediately before taking its screenshot.
  await evaluate('document.documentElement.style.background = "radial-gradient(ellipse at 80% 10%, #433440, transparent 75%), linear-gradient(130deg, #171d29, #2b1e2a 55%, #15131d)"');
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(root, 'artifacts/widget-demo.png'), Buffer.from(screenshot.data, 'base64'));
  console.log('PASS: real Electron UI, isolated renderer, pause, track changes, seek, shuffle, repeat, interaction lock and screenshot.');
} finally {
  socket?.close();
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Test closed')); }
  if (child.exitCode === null && !child.signalCode) {
    if (process.platform === 'win32') child.kill(); else process.kill(-child.pid, 'SIGTERM');
  }
  await exited;
  await rm(profile, { force: true, recursive: true });
}
