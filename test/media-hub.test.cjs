const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MediaHub } = require('../src/media-hub.cjs');
const { normalizeState } = require('../src/media.cjs');
const { descriptor } = require('../src/sources.cjs');
const { services, fromUrl } = require('../browser-extension/services.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
test('recognizes every requested web service without guessing from track names', () => {
  for (const service of services) for (const host of service.hosts) assert.equal(fromUrl(`https://${host}/anything`).id, service.id);
  assert.equal(fromUrl('https://spotify.com.attacker.invalid/'), null);
  assert.equal(fromUrl('http://open.spotify.com/'), null);
});
test('explicit source selection targets exactly that player and does not fall back after it closes', async () => {
  const native = new EventEmitter(); native.start = () => {}; native.stop = () => {};
  const app = descriptor({ id: 'native:spotify', provider: 'spotify', kind: 'app', playing: true });
  const calls = [];
  native.selectSource = async id => { await tick(); native.emit('state', normalizeState({ connected: true, source: app, sources: [app], title: 'Native song', playing: true, capabilities: { playPause: true } })); };
  native.command = async (...args) => calls.push(args);
  const browser = new EventEmitter(); let web = [normalizeState({ connected: true, source: descriptor({ id: 'web:test:9', provider: 'youtube', kind: 'browser', browser: 'Chrome' }), title: 'Video', playing: true, capabilities: { playPause: true } })];
  browser.sources = () => web; browser.command = async (...args) => calls.push(args); browser.stop = () => {};
  const hub = new MediaHub(native, browser);
  native.emit('state', normalizeState({ sources: [app] })); await tick();
  await hub.selectSource('web:test:9'); await hub.command('playPause');
  assert.equal(calls[0][0], 'web:test:9');
  web = []; browser.emit('change');
  assert.equal(hub.state.connected, false); assert.equal(hub.state.selection, 'web:test:9');
  await assert.rejects(hub.command('playPause'));
  assert.equal(calls.length, 1, 'Must not pause Spotify after the selected tab closed');
  await hub.selectSource('native:spotify'); await tick();
  await hub.command('playPause'); assert.equal(calls[1][2], 'native:spotify');
});
test('manual Yandex selection survives polling and an explicit bridge restart without switching to another app', async () => {
  const native = new EventEmitter(); native.selectSource = async () => {}; native.command = async () => {}; native.stop = () => {};
  const browser = new EventEmitter(); browser.sources = () => []; browser.stop = () => {};
  const hub = new MediaHub(native, browser);
  const source = id => descriptor({ id, provider: 'yandex', appId: 'YandexMusic.exe', kind: 'app', playing: true });
  const report = id => native.emit('state', normalizeState({ source: source(id), sources: [source(id)], connected: true, playing: true, title: 'Track', capabilities: { playPause: true } }));
  report('native:original'); await hub.selectSource('native:original');
  for (let i = 0; i < 20; i++) { report('native:original'); assert.equal(hub.state.connected, true); assert.equal(hub.state.selection, 'native:original'); }
  native.emit('state', normalizeState({})); assert.equal(hub.state.connected, false);
  native.emit('bridge-started'); report('native:after-restart');
  assert.equal(hub.state.connected, true); assert.equal(hub.state.selection, 'native:after-restart');
  native.emit('state', normalizeState({})); report('native:another-instance');
  assert.equal(hub.state.connected, false, 'Closing the chosen app must not silently rebind an unrelated instance');
  await assert.rejects(hub.command('playPause'));
});
