const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { launchPortableInstaller } = require('../src/install-launcher.cjs');
class Child extends EventEmitter {
  constructor() { super(); this.pid = 42; this.exitCode = null; this.signalCode = null; this.unreferenced = false; }
  kill() { this.signalCode = 'SIGTERM'; this.exitCode = 1; this.emit('exit', 1); }
  unref() { this.unreferenced = true; }
}
async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'liberty-launch-'));
  const source = path.join(directory, 'source.ps1'), target = path.join(directory, 'Liberty-Wave-0.5.1-Windows.exe');
  await fs.writeFile(source, '# test helper'); await fs.writeFile(target, 'old app');
  const options = { directory, script: source, target, update: { filename: path.join(directory, 'download.exe'), sha256: 'a'.repeat(64), version: '0.6.1' }, waitPid: process.pid, timeout: 500, pollInterval: 5, powershell: 'test-powershell' };
  try { await run(options); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
test('installer launch waits for matching staging acknowledgement and names the new executable in the same folder', async () => fixture(async options => {
  const child = new Child(); let released = false;
  const promise = launchPortableInstaller({ ...options, spawn: (command, args, spawnOptions) => {
    assert.equal(command, 'test-powershell'); assert.equal(spawnOptions.cwd, options.directory); assert.equal(spawnOptions.detached, true);
    const value = key => args[args.indexOf(key) + 1];
    assert.equal(value('-NewTargetPath'), path.join(options.directory, 'Liberty-Wave-0.6.1-Windows.exe'));
    assert.equal(value('-TargetPath'), options.target);
    setTimeout(async () => { assert.equal(released, false); await fs.writeFile(value('-ReadyPath'), JSON.stringify({ phase: 'ready', token: value('-ReadyToken'), pid: child.pid, sha256: options.update.sha256 })); }, 30);
    return child;
  } });
  assert.equal(await promise, child); released = true;
  assert.equal(child.unreferenced, true); assert.equal(await fs.readFile(options.target, 'utf8'), 'old app');
}));
test('spawn success without script readiness times out, preserves the original and records the failure', async () => fixture(async options => {
  const child = new Child();
  await assert.rejects(launchPortableInstaller({ ...options, timeout: 30, spawn: () => { setTimeout(() => child.emit('spawn'), 0); return child; } }), /не подтвердил готовность/);
  assert.equal(child.signalCode, 'SIGTERM'); assert.equal(child.unreferenced, false);
  assert.equal(await fs.readFile(options.target, 'utf8'), 'old app');
  assert.equal(JSON.parse(await fs.readFile(path.join(options.directory, 'last-install.json'), 'utf8')).phase, 'launch-failed');
}));
test('a stale or mismatched acknowledgement cannot close the running application', async () => fixture(async options => {
  const child = new Child();
  await assert.rejects(launchPortableInstaller({ ...options, timeout: 30, spawn: (_command, args) => {
    const ready = args[args.indexOf('-ReadyPath') + 1];
    setTimeout(() => fs.writeFile(ready, JSON.stringify({ phase: 'ready', token: 'stale-token', pid: child.pid, sha256: options.update.sha256 })), 0);
    return child;
  } }), /не подтвердил готовность/);
  assert.equal(child.unreferenced, false);
}));
test('early script failure and inability to create PowerShell both keep the old executable', async () => fixture(async options => {
  const child = new Child();
  await assert.rejects(launchPortableInstaller({ ...options, spawn: () => { setTimeout(() => { child.exitCode = 1; child.emit('exit', 1); }, 0); return child; } }), /завершился до подтверждения/);
  await assert.rejects(launchPortableInstaller({ ...options, spawn: () => { throw Error('blocked'); } }), /создать процесс/);
  assert.equal(await fs.readFile(options.target, 'utf8'), 'old app');
}));
