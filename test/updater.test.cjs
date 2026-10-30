const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { AppUpdater, API_URL, isNewer } = require('../src/updater.cjs');
const executable = Buffer.alloc(256); executable.write('MZ'); executable.writeUInt32LE(128, 60); executable.set([80, 69, 0, 0], 128);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(changes = {}) {
  const name = 'Liberty-Wave-0.4.2-Windows.exe';
  const base = 'https://github.com/dyushaboldyusha-a11y/music-adapter/releases/download/v0.4.2/';
  const release = { tag_name: 'v0.4.2', draft: false, prerelease: false, assets: [name, 'SHA256SUMS.txt'].map(name => ({ name, state: 'uploaded', size: name.endsWith('.exe') ? executable.length : 128, browser_download_url: base + name })) };
  const calls = [];
  return { calls, release, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url === API_URL) return new Response(JSON.stringify(changes.release || release));
    if (url === base + 'SHA256SUMS.txt') return new Response(`${changes.hash || digest(executable)}  ${name}\n`);
    if (url === base + name) return new Response(changes.bytes || executable);
    throw new Error('Unexpected test URL');
  } };
}
async function withUpdater(run, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'liberty-updater-'));
  const server = fixture(options), installed = [];
  const updater = new AppUpdater({ currentVersion: '0.4.1', directory, fetch: server.fetch, supported: true, launchInstaller: async update => installed.push(update) });
  try { await run({ updater, server, directory, installed }); }
  finally { updater.stop(); await fs.rm(directory, { recursive: true, force: true }); }
}
test('update versions compare numerically and never downgrade or accept prerelease names', () => {
  assert.equal(isNewer('v0.4.10', '0.4.9'), true); assert.equal(isNewer('0.4.0', '0.4.1'), false);
  assert.equal(isNewer('0.4.1', '0.4.1'), false); assert.equal(isNewer('v1.0.0-beta', '0.4.1'), false);
});
test('updates download from the official release, verify SHA256, then invoke installation explicitly', async () => withUpdater(async ({ updater, server, directory, installed }) => {
  const oldFile = path.join(directory, 'existing-app.exe'); await fs.writeFile(oldFile, 'old application');
  assert.equal((await updater.check()).ok, true); assert.equal(updater.snapshot().phase, 'available');
  assert.equal((await updater.download()).ok, true); assert.equal(updater.snapshot().phase, 'ready');
  assert.equal(installed.length, 0); assert.equal(await fs.readFile(oldFile, 'utf8'), 'old application');
  assert.equal((await updater.install()).ok, true); assert.equal(installed.length, 1);
  assert.equal(installed[0].sha256, digest(executable)); assert.deepEqual(await fs.readFile(installed[0].filename), executable);
  assert.ok(server.calls.every(call => call.options.credentials === 'omit'));
}));
test('bad checksums and malformed executables leave no installable or partial files', async () => {
  for (const options of [{ hash: '0'.repeat(64) }, { bytes: Buffer.alloc(256), hash: digest(Buffer.alloc(256)) }]) await withUpdater(async ({ updater, directory, installed }) => {
    await updater.check(); assert.equal((await updater.download()).ok, false);
    assert.equal(updater.snapshot().ready, false); assert.equal((await updater.install()).ok, false); assert.equal(installed.length, 0);
    assert.deepEqual(await fs.readdir(directory), []);
  }, options);
});
test('update refuses assets outside this repository and insecure redirect destinations', async () => withUpdater(async ({ updater, server }) => {
  server.release.assets[0].browser_download_url = 'https://other.example/app.exe';
  assert.equal((await updater.check()).ok, false);
  updater.fetch = async () => new Response('', { status: 302, headers: { Location: 'http://github.com/unsafe' } });
  assert.equal((await updater.check()).ok, false);
}));
test('an unchanged release does not offer an update and a modified download is rechecked before installation', async () => withUpdater(async ({ updater, installed }) => {
  updater.state.currentVersion = '0.4.2'; await updater.check(); assert.equal(updater.snapshot().phase, 'current');
  updater.state.currentVersion = '0.4.1'; await updater.check(); await updater.download();
  await fs.writeFile(updater.readyFile.filename, 'modified');
  assert.equal((await updater.install()).ok, false); assert.equal(installed.length, 0); assert.equal(updater.snapshot().ready, false);
}));
test('canceling a download cleans staged data and keeps the current application intact', async () => withUpdater(async ({ updater, directory }) => {
  await updater.check(); const downloading = updater.download(); updater.cancel();
  assert.equal((await downloading).ok, false); assert.equal(updater.snapshot().ready, false);
  assert.deepEqual(await fs.readdir(directory), []);
}));
test('connection errors identify the failed GitHub host and a safe Chromium error code', async () => withUpdater(async ({ updater }) => {
  updater.fetch = async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED https://example.invalid/?token=private'); };
  assert.equal((await updater.check()).ok, false);
  assert.match(updater.snapshot().error, /api\.github\.com \(ERR_NAME_NOT_RESOLVED\)/);
  assert.ok(!updater.snapshot().error.includes('private'));
}));
