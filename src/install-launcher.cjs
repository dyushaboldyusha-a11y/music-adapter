const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn: defaultSpawn } = require('node:child_process');

// Creating powershell.exe is not evidence that its script has started. Keep the
// application alive until the helper has verified and staged the replacement.
async function launchPortableInstaller({ directory, script, target, update, waitPid, spawn = defaultSpawn, timeout = 60000, pollInterval = 100, powershell }) {
  await fs.promises.mkdir(directory, { recursive: true });
  const helper = path.join(directory, 'install-update.ps1'), readyPath = path.join(directory, 'installer-ready.json');
  const statusPath = path.join(directory, 'last-install.json'), logPath = path.join(directory, 'installer-start.log');
  if (!/^\d+\.\d+\.\d+$/.test(update.version)) throw new Error('Некорректная версия обновления');
  const destination = path.join(path.dirname(target), `Liberty-Wave-${update.version}-Windows.exe`);
  const token = randomBytes(16).toString('hex');
  await fs.promises.copyFile(script, helper);
  await fs.promises.rm(readyPath, { force: true });
  await fs.promises.writeFile(statusPath, JSON.stringify({ ok: false, phase: 'launching', at: Date.now() }));
  const log = fs.openSync(logPath, 'w');
  let child;
  try {
    const executable = powershell || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-TargetPath', target, '-NewTargetPath', destination, '-UpdatePath', update.filename, '-ExpectedSha256', update.sha256, '-WaitPid', String(waitPid), '-StatusPath', statusPath, '-ReadyPath', readyPath, '-ReadyToken', token], { cwd: directory, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', log, log] });
  } catch {
    const error = new Error('Не удалось создать процесс установщика Windows. Приложение остаётся открытым');
    await fs.promises.writeFile(statusPath, JSON.stringify({ ok: false, phase: 'launch-failed', error: error.message, at: Date.now() })).catch(() => {});
    throw error;
  } finally { fs.closeSync(log); }
  try {
    await new Promise((resolve, reject) => {
      let settled = false, timer;
      const done = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      child.on('error', () => done(new Error('Не удалось запустить установщик Windows. Приложение остаётся открытым')));
      child.once('exit', code => done(new Error(`Установщик завершился до подтверждения запуска (код ${code}). Подробности в installer-start.log`)));
      const deadline = Date.now() + timeout;
      const poll = async () => {
        if (settled) return;
        try {
          const text = await fs.promises.readFile(readyPath, 'utf8');
          const ready = JSON.parse(text.replace(/^\uFEFF/, ''));
          if (ready.token === token && ready.pid === child.pid && ready.sha256 === update.sha256 && ready.phase === 'ready') {
            if (child.exitCode !== null && child.exitCode !== undefined) return done(new Error('Установщик неожиданно завершился. Приложение остаётся открытым'));
            return done();
          }
        } catch {}
        if (Date.now() >= deadline) return done(new Error('Установщик не подтвердил готовность. Приложение остаётся открытым; подробности в installer-start.log'));
        timer = setTimeout(poll, pollInterval);
      };
      poll();
    });
    child.unref(); return child;
  } catch (error) {
    // This process has not exited, so the helper cannot have replaced its target.
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 2000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    await fs.promises.rm(`${destination}.${token}.pending.exe`, { force: true }).catch(() => {});
    try {
      if ((await fs.promises.stat(statusPath)).size < 65536) {
        const status = JSON.parse((await fs.promises.readFile(statusPath, 'utf8')).replace(/^\uFEFF/, ''));
        if (status.phase === 'failed' && typeof status.error === 'string' && status.error) error.message = `Установщик не подготовил обновление: ${status.error.slice(0, 1000)}`;
      }
    } catch {}
    await fs.promises.writeFile(statusPath, JSON.stringify({ ok: false, phase: 'launch-failed', error: error.message, at: Date.now() })).catch(() => {});
    throw error;
  }
}
module.exports = { launchPortableInstaller };
