// A detached Node/Electron-as-Node host can run without a Windows console.
// Windows PowerShell cannot reliably start with DETACHED_PROCESS itself.
// Keep its ordinary child (and libuv job) alive until installation completes.
const { spawn } = require('node:child_process');
try {
  const { executable, args, directory } = JSON.parse(process.argv[2]);
  const child = spawn(executable, [...args, '-HostPid', String(process.pid)], { cwd: directory, detached: false, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  child.once('error', error => { console.error('Installer host:', error.message); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
} catch (error) { console.error('Installer host:', error.message); process.exitCode = 1; }
