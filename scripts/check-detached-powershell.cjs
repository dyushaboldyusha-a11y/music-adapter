const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liberty-ps-start-'));
  try {
    const script = path.join(directory, 'probe.ps1');
    fs.writeFileSync(script, "param([string]$Marker)\r\n[IO.File]::WriteAllText($Marker, 'started')\r\n", 'utf8');
    for (const [name, input, windowsHide, encoded] of [['ignored-hidden', 'ignore', true, false], ['piped-hidden', 'pipe', true, false], ['ignored-visible', 'ignore', false, false], ['piped-visible', 'pipe', false, false], ['encoded-hidden', 'ignore', true, true]]) {
      const marker = path.join(directory, name), log = path.join(directory, name + '.log'), fd = fs.openSync(log, 'w');
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
      if (encoded) args.push('-EncodedCommand', Buffer.from(`[IO.File]::WriteAllText('${marker.replaceAll("'", "''")}', 'started')`, 'utf16le').toString('base64'));
      else args.push('-File', script, '-Marker', marker);
      const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), args, { detached: true, windowsHide, stdio: [input, fd, fd] });
      fs.closeSync(fd);
      const outcome = await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill(); resolve('timeout'); }, 10000);
        child.once('error', error => { clearTimeout(timer); resolve(error.message); });
        child.once('exit', code => { clearTimeout(timer); resolve(code); });
      });
      child.stdin?.destroy();
      console.log(`PowerShell startup ${name}: exit=${outcome}, marker=${fs.existsSync(marker)}, log=${JSON.stringify(fs.readFileSync(log, 'utf8').slice(0, 500))}`);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
