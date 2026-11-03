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
    assert.ok(Array.isArray(state.microphones));
    assert.equal(state.microphones[0].id, 'default');
    assert.equal(typeof state.speechAvailable, 'boolean');
    assert.equal(state.speechAvailable, true, state.error);
    assert.equal(state.language, 'ru-RU / en-US');
    await bridge.request('probe');
    await bridge.request('configure', { monitor: false, voice: false, keys: [] });
    if (process.platform === 'win32') {
      await bridge.request('configure', { monitor: false, voice: false, keys: [], microphone: '999' });
      const failure = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { bridge.off('state', listener); reject(Error('Missing microphone validation failure')); }, 10000);
        const listener = value => { if (value.phase === 'error') { clearTimeout(timer); bridge.off('state', listener); resolve(value); } };
        bridge.on('state', listener);
      });
      await bridge.request('test', true);
      const failed = await failure;
      assert.equal(failed.listening, false); assert.equal(failed.phase, 'error');
      assert.match(failed.error, /микрофон/i);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
    await bridge.request('configure', { monitor: false, voice: false, keys: [] });
    console.log('PASS: native automation runs with stdin idle, accepts repeated UTF-8 configuration and never opens a microphone while disabled.');
  } finally { bridge.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
