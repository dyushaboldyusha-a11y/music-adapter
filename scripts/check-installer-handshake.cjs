const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { launchPortableInstaller } = require('../src/install-launcher.cjs');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'liberty-installer-'));
  const downloads = path.join(directory, 'Загрузки с пробелами'), cache = path.join(directory, 'updates');
  await fs.mkdir(downloads); await fs.mkdir(cache);
  const target = path.join(downloads, 'Liberty-Wave-0.5.1-Windows.exe');
  const replacement = path.join(downloads, 'Liberty-Wave-0.6.1-Windows.exe');
  const update = path.join(cache, 'download.exe');
  const bytes = Buffer.from('verified new application'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const parent = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  let child, extraParent;
  try {
    await fs.writeFile(target, 'previous application'); await fs.writeFile(update, bytes);
    child = await launchPortableInstaller({ directory: cache, script: path.resolve(__dirname, '../native/install-update.ps1'), target, update: { filename: update, sha256, version: '0.6.1' }, waitPid: parent.pid, powershell: process.platform === 'win32' ? undefined : 'powershell.exe', spawn: (file, args, options) => spawn(file, [...args, '-NoRelaunch'], options) });
    assert.equal(await fs.readFile(target, 'utf8'), 'previous application', 'Readiness must precede changing or closing the old app');
    await assert.rejects(fs.stat(replacement), { code: 'ENOENT' });
    const token = JSON.parse((await fs.readFile(path.join(cache, 'installer-ready.json'), 'utf8')).replace(/^\uFEFF/, '')).token;
    assert.deepEqual(await fs.readFile(`${replacement}.${token}.pending.exe`), bytes);
    const exited = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('Installer did not finish')), 15000); child.once('exit', code => { clearTimeout(timeout); resolve(code); }); });
    parent.kill(); assert.equal(await exited, 0);
    await assert.rejects(fs.stat(target), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(replacement), bytes);
    await assert.rejects(fs.stat(update), { code: 'ENOENT' });
    assert.ok(!(await fs.readdir(downloads)).some(name => /pending|backup/.test(name)));
    const result = JSON.parse((await fs.readFile(path.join(cache, 'last-install.json'), 'utf8')).replace(/^\uFEFF/, ''));
    assert.equal(result.ok, true); assert.equal(result.newPath, replacement);
    // A pre-existing unrelated destination must survive and the old app must not close.
    await fs.writeFile(target, 'previous application'); await fs.writeFile(replacement, 'unrelated existing file'); await fs.writeFile(update, bytes);
    await assert.rejects(launchPortableInstaller({ directory: cache, script: path.resolve(__dirname, '../native/install-update.ps1'), target, update: { filename: update, sha256, version: '0.6.1' }, waitPid: process.pid, powershell: process.platform === 'win32' ? undefined : 'powershell.exe', spawn: (file, args, options) => spawn(file, [...args, '-NoRelaunch'], options) }), /different file already uses/);
    assert.equal(await fs.readFile(target, 'utf8'), 'previous application'); assert.equal(await fs.readFile(replacement, 'utf8'), 'unrelated existing file');
    // Also fail after the original has been moved aside: a changed destination
    // must roll the old executable back, without deleting the foreign file.
    await fs.writeFile(replacement, bytes);
    extraParent = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    child = await launchPortableInstaller({ directory: cache, script: path.resolve(__dirname, '../native/install-update.ps1'), target, update: { filename: update, sha256, version: '0.6.1' }, waitPid: extraParent.pid, powershell: process.platform === 'win32' ? undefined : 'powershell.exe', spawn: (file, args, options) => spawn(file, [...args, '-NoRelaunch'], options) });
    await fs.writeFile(replacement, 'changed after staging');
    const failed = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('Rollback did not finish')), 15000); child.once('exit', code => { clearTimeout(timeout); resolve(code); }); });
    extraParent.kill(); assert.equal(await failed, 1);
    assert.equal(await fs.readFile(target, 'utf8'), 'previous application'); assert.equal(await fs.readFile(replacement, 'utf8'), 'changed after staging');
    assert.ok(!(await fs.readdir(downloads)).some(name => /pending|backup/.test(name)));
    console.log('PASS: actual Node → PowerShell startup handshake, staged checksum, wait for live parent, same-folder versioned replacement, source/backup cleanup and collision protection. No downloaded executable is launched.');
  } catch (error) {
    for (const name of ['installer-start.log', 'last-install.json', 'installer-ready.json']) {
      try { console.error(name + ': ' + (await fs.readFile(path.join(cache, name), 'utf8')).slice(0, 10000)); } catch {}
    }
    console.error('Parent probe:', { pid: parent.pid, exitCode: parent.exitCode, signalCode: parent.signalCode });
    throw error;
  } finally { parent.kill(); extraParent?.kill(); child?.kill(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
