const assert = require('node:assert/strict');
const path = require('node:path');
const { WindowsAudio } = require('../src/audio.cjs');
const audio = new WindowsAudio(path.join(__dirname, '../native/windows-audio.ps1'));
function wait(event, predicate, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { audio.off(event, listener); reject(new Error(`Audio bridge timeout: ${event}`)); }, timeout);
    function listener(value) { if (predicate(value)) { clearTimeout(timer); audio.off(event, listener); resolve(value); } }
    audio.on(event, listener);
  });
}
(async () => {
  try {
    const initial = wait('state', state => state.target === ''); audio.start(); await initial;
    const target = 'Liberty-Nonexistent-Audio-Session.exe';
    const selected = wait('state', state => state.target === target);
    const level = wait('level', value => typeof value.available === 'boolean' && Number.isFinite(value.level));
    audio.configure({ target, enabled: true, economy: true });
    const state = await selected; assert.equal(state.available, false); assert.equal(state.volume, null);
    const sample = await level; assert.ok(sample.level >= 0 && sample.level <= 1); assert.equal(sample.target, target); assert.equal(sample.available, false); assert.equal(sample.level, 0);
    await assert.rejects(audio.command('volume', .25, target));
    await assert.rejects(audio.command('mute', true, 'Other-Player.exe'));
    audio.configure({ target: '', enabled: false, economy: false });
    await wait('state', state => state.target === '');
    console.log('PASS: actual Node-to-PowerShell audio transport, source selection, peak messages and rejection of missing/changed app sessions.');
  } finally { audio.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
