const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { _electron } = require('playwright');
async function poll(read, timeout = 65000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw Error('Electron installer readiness/completion timed out');
}
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'liberty-electron-installer-'));
  let app;
  try {
    const target = path.join(directory, 'Liberty-Wave-0.6.3-Windows.exe'), replacement = path.join(directory, 'Liberty-Wave-0.6.4-Windows.exe');
    const filename = path.join(directory, 'download.exe'), bytes = Buffer.from('verified Electron replacement');
    await fs.writeFile(target, 'previous app'); await fs.writeFile(filename, bytes);
    const options = { directory, script: path.join(__dirname, '../native/install-update.ps1'), target, update: { filename, sha256: createHash('sha256').update(bytes).digest('hex'), version: '0.6.4' }, powershell: process.argv[2] || undefined };
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'installer-electron-parent.cjs'), '--installer-options=' + Buffer.from(JSON.stringify(options)).toString('base64'), '--disable-gpu'] });
    const ready = await poll(() => app.evaluate(({ app }) => app.installerStatus?.ready || app.installerStatus?.error));
    assert.equal(ready, true, ready);
    assert.equal(await fs.readFile(target, 'utf8'), 'previous app');
    await app.close(); app = null;
    const status = await poll(async () => {
      const value = JSON.parse((await fs.readFile(path.join(directory, 'last-install.json'), 'utf8')).replace(/^\uFEFF/, ''));
      if (value.phase === 'failed') throw Error(value.error);
      return value.ok ? value : null;
    });
    assert.equal(status.newPath.toLowerCase(), replacement.toLowerCase());
    assert.deepEqual(await fs.readFile(replacement), bytes);
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
    console.log('PASS: actual Electron launches detached Electron-as-Node host, staged readiness precedes exit, PowerShell survives Electron and replaces the verified file.');
  } finally { await app?.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
