const assert = require('node:assert/strict');
const path = require('node:path');
const { WindowsMedia } = require('../src/media.cjs');

if (process.platform !== 'win32') throw new Error('This check requires Windows.');
const media = new WindowsMedia(path.join(__dirname, '../native/windows-media.ps1'));
async function check() {
  const initialState = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No initial Windows media state.')), 25000);
    media.once('state', state => { clearTimeout(timer); resolve(state); });
  });
  media.start();
  try {
    const state = await initialState;
    assert.equal(state.error, null, `WinRT initialization failed: ${state.error}`);
    for (const id of [-1, -2]) {
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { media.lines.off('line', receive); reject(new Error('Missing command response from Windows bridge.')); }, 6000);
        function receive(line) {
          try {
            const message = JSON.parse(line.replace(/^\uFEFF/, ''));
            if (message.type === 'result' && message.id === id) {
              clearTimeout(timer); media.lines.off('line', receive); resolve(message);
            }
          } catch {}
        }
        media.lines.on('line', receive);
      });
      media.child.stdin.write(JSON.stringify({ id, command: 'invalid-command', value: 'Проверка 🎵' }) + '\n', 'utf8');
      const response = await result;
      assert.equal(response.ok, false, 'Invalid command must not succeed.');
      assert.ok(!response.error.includes('Invalid JSON'), 'Bridge must parse UTF-8 JSON.');
    }
    console.log('PASS: real Node client, Windows WinRT initialization, media states and repeated command round trips.');
  } finally { media.stop(); }
}
check().catch(error => { console.error(error); process.exitCode = 1; });
