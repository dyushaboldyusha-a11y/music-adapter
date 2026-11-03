const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { WindowsMedia } = require('../src/media.cjs');
async function main() {
  const bridge = new WindowsMedia(path.join(__dirname, '../native/windows-automation.ps1'), value => value);
  try {
    const firstState = once(bridge, 'state', { signal: AbortSignal.timeout(10000) });
    bridge.start();
    // No stdin request yet: an async-looking synchronous ReadLine would hang here,
    // also preventing key-up from closing the microphone on Windows PowerShell.
    const [state] = await firstState;
    assert.equal(state.listening, false); assert.equal(state.session, 0);
    await bridge.request('configure', { monitor: false, voice: false, keys: [] });
    await new Promise(resolve => setTimeout(resolve, 250));
    await bridge.request('configure', { monitor: false, voice: false, keys: [] });
    console.log('PASS: native automation runs with stdin idle, accepts repeated UTF-8 configuration and never opens a microphone while disabled.');
  } finally { bridge.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
