// Run in Electron, not Node: Chromium's manual redirects differ from fetch.
const { app, net, session } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createUpdateFetch } = require('../src/update-fetch.cjs');
const { AppUpdater, API_URL } = require('../src/updater.cjs');

app.disableHardwareAcceleration();
setTimeout(() => { console.error('Electron update network check timed out'); app.exit(1); }, 30000).unref();
app.whenReady().then(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'liberty-update-network-'));
  const testSession = session.fromPartition(`liberty-update-network-${Date.now()}`);
  const fetch = createUpdateFetch({ request: options => net.request({ ...options, session: testSession }) });
  const name = 'Liberty-Wave-0.6.0-Windows.exe';
  const base = 'https://github.com/dyushaboldyusha-a11y/music-adapter/releases/download/v0.6.0/';
  const bytes = Buffer.alloc(96 * 1024, 45); bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.set([80, 69, 0, 0], 128);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const sums = `${hash}  ${name}\n`;
  const release = { tag_name: 'v0.6.0', assets: [name, 'SHA256SUMS.txt'].map(name => ({ name, state: 'uploaded', size: name.endsWith('.exe') ? bytes.length : Buffer.byteLength(sums), browser_download_url: base + name })) };
  let targetCalls = 0, badRedirect = false, slowDownload = false, streamStarted;
  const observed = [];
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.cookie, undefined, 'Updates must omit session cookies');
    if (request.url === new URL(API_URL).pathname) return response.end(JSON.stringify(release));
    if (request.url.endsWith('/SHA256SUMS.txt')) { response.writeHead(302, { Location: 'https://release-assets.githubusercontent.com/fixture/checksums' }); return response.end(); }
    if (request.url === '/fixture/checksums') return response.end(sums);
    if (request.url.endsWith(`/${name}`)) { response.writeHead(302, { Location: badRedirect ? 'https://untrusted.example/file.exe' : 'https://release-assets.githubusercontent.com/fixture/next' }); return response.end(); }
    if (request.url === '/fixture/next') { response.writeHead(307, { Location: 'https://release-assets.githubusercontent.com/fixture/executable' }); return response.end(); }
    if (request.url === '/fixture/executable') {
      targetCalls++;
      if (slowDownload) { response.writeHead(200, { 'Content-Length': bytes.length }); response.write(bytes.subarray(0, 64)); streamStarted(); return; }
      response.write(bytes.subarray(0, 4096)); return response.end(bytes.subarray(4096));
    }
    if (request.url === '/manual') { response.writeHead(302, { Location: '/manual-target' }); return response.end(); }
    if (request.url === '/manual-target') { targetCalls++; return response.end('followed'); }
    response.writeHead(404); response.end('missing');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Only the test transport maps official HTTPS URLs onto the loopback fixture.
  // AppUpdater still validates every original redirect before calling transport.
  const updater = new AppUpdater({ currentVersion: '0.5.0', directory, fetch: (url, options) => { observed.push(url); return fetch(origin + new URL(url).pathname, options); } });
  try {
    await testSession.cookies.set({ url: origin, name: 'private-session', value: 'not-for-updates' });
    const manual = await fetch(origin + '/manual');
    assert.equal(manual.status, 302); assert.equal(new URL(manual.headers.get('location')).pathname, '/manual-target');
    assert.equal(targetCalls, 0, 'Transport must return the redirect without following it');
    assert.equal((await updater.check()).ok, true);
    assert.equal((await updater.download()).ok, true, updater.snapshot().error);
    assert.equal(updater.snapshot().ready, true); assert.equal(targetCalls, 1);
    assert.deepEqual(await fs.readFile(updater.readyFile.filename), bytes);
    assert.equal(updater.readyFile.sha256, hash);
    assert.equal((await updater.install()).ok, false, 'Network checks must not execute the downloaded file');
    await fs.rm(updater.readyFile.filename); updater.readyFile = null;
    badRedirect = true;
    assert.equal((await updater.download()).ok, false);
    assert.match(updater.snapshot().error, /Недопустимый адрес/);
    assert.ok(observed.every(url => new URL(url).hostname !== 'untrusted.example'));
    assert.deepEqual(await fs.readdir(directory), []);
    badRedirect = false; slowDownload = true;
    const started = new Promise(resolve => { streamStarted = resolve; });
    const download = updater.download(); await started; updater.cancel();
    assert.equal((await download).ok, false); assert.match(updater.snapshot().error, /отменена/);
    assert.deepEqual(await fs.readdir(directory), []);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(fetch(origin + '/manual', { signal: controller.signal }), { name: 'AbortError' });
    console.log('PASS: actual Electron transport returns manual redirects, validates every GitHub hop, streams and verifies the executable, omits cookies, rejects untrusted hosts, cancels partial downloads and never runs installation.');
  } finally {
    updater.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
