const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
async function waitFor(read, predicate, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const value = await read(); if (predicate(value)) return value; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw Error('Installer did not complete after its launching parent exited');
}
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'liberty-parent-exit-'));
  let parent;
  try {
    for (const folder of ['normal', 'Папка с пробелами', 'retry']) {
      const directory = path.join(root, folder), cache = path.join(directory, 'updates');
      await fs.mkdir(cache, { recursive: true });
      const target = path.join(directory, 'Liberty-Wave-0.6.3-Windows.exe'), replacement = path.join(directory, 'Liberty-Wave-0.6.4-Windows.exe');
      const bytes = Buffer.from('verified test replacement'), filename = path.join(cache, 'download.exe');
      await fs.writeFile(target, 'previous app'); await fs.writeFile(filename, bytes);
      if (folder === 'retry') await fs.writeFile(replacement, bytes); // Reuse an already verified destination.
      parent = fork(path.join(__dirname, 'installer-parent.cjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      const message = once(parent, 'message', { signal: AbortSignal.timeout(65000) });
      parent.send({ directory: cache, script: path.join(__dirname, '../native/install-update.ps1'), target, update: { filename, version: '0.6.4', sha256: createHash('sha256').update(bytes).digest('hex') }, powershell: process.argv[2] || undefined, hosted: process.argv.includes('--hosted') ? true : undefined });
      const [ready] = await message; assert.equal(ready.ready, true, ready.error);
      assert.equal(await fs.readFile(target, 'utf8'), 'previous app');
      const exited = once(parent, 'exit'); parent.send('exit'); assert.deepEqual(await exited, [0, null]); parent = null;
      const status = await waitFor(async () => JSON.parse((await fs.readFile(path.join(cache, 'last-install.json'), 'utf8')).replace(/^\uFEFF/, '')), value => value.phase === 'complete' || value.phase === 'failed');
      assert.equal(status.ok, true, status.error);
      assert.deepEqual(await fs.readFile(replacement), bytes);
      await waitFor(() => fs.readdir(directory), names => !names.some(n => /pending|backup/.test(n)));
      await assert.rejects(fs.stat(target), { code: 'ENOENT' });
      await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
      console.log(`PASS: installer survives its launching parent's exit, verified replacement and cleanup: ${folder}`);
    }
  } finally { parent?.kill(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
