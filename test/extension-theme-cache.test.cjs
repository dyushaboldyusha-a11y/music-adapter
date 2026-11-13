const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { extensionTheme } = require('../src/extension-theme.cjs');

const source = fs.readFileSync(require.resolve('../browser-extension/background.js'), 'utf8');
const popup = 'chrome-extension://' + 'a'.repeat(32) + '/popup.html';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function background({ initial = {}, failThemeRead = false, failThemeWrite = false } = {}) {
  const storage = { clientId: 'fixture-client', ...clone(initial) }, session = {}, requests = [], commands = [], writes = [];
  let listener, reply = { commands: [] }, timer = 0;
  const area = data => ({
    async get(keys) {
      if (data === storage && keys === 'popupTheme' && failThemeRead) throw new Error('Theme cache read failed');
      const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(data);
      return Object.fromEntries(names.filter(key => key in data).map(key => [key, clone(data[key])]));
    },
    async set(values) {
      if (data === storage && 'popupTheme' in values && failThemeWrite) throw new Error('QUOTA_BYTES exceeded');
      if (data === storage) writes.push(clone(values));
      Object.assign(data, clone(values));
    },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  });
  const event = { addListener() {} };
  const context = vm.createContext({
    console, URL, AbortSignal, Response, crypto: webcrypto, navigator: { userAgent: 'fixture' }, btoa,
    importScripts() {}, LibertyServices: { browserName: () => 'Chrome', fromUrl: url => url?.startsWith('https://open.spotify.com/') ? { id: 'spotify' } : null },
    setTimeout: () => ++timer, clearTimeout() {}, setInterval: () => ++timer,
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      requests.push({ path, body: JSON.parse(options.body) });
      return new Response(JSON.stringify(path === '/v1/pair' ? { token: 'fixture-token', ...clone(reply) } : clone(reply)));
    },
    chrome: {
      storage: { local: area(storage), session: area(session) },
      runtime: { getURL: name => popup.replace('popup.html', name), sendMessage: async () => ({ ok: true }), onMessage: { addListener: callback => { listener = callback; } } },
      tabs: { sendMessage: async (tabId, command) => { commands.push({ tabId, ...clone(command) }); return { ok: true }; }, onRemoved: event, onUpdated: event },
      alarms: { create() {}, onAlarm: event }
    }
  });
  vm.runInContext(source, context, { filename: 'background.js' });
  return {
    storage, requests, commands, writes,
    setReply(value) { reply = clone(value); },
    sync: () => vm.runInContext('sync()', context),
    addPlayer() { listener({ type: 'player-state', state: { title: 'Track' } }, { url: 'https://open.spotify.com/track/fixture', tab: { id: 7 } }, () => {}); },
    async message(value) {
      let responded = false, result;
      const pending = listener(value, { url: popup }, data => { responded = true; result = clone(data); });
      if (pending === true) {
        for (let i = 0; i < 100 && !responded; i++) await new Promise(resolve => setImmediate(resolve));
        assert.equal(responded, true, 'The popup request must finish despite a theme-cache failure');
      }
      return result;
    }
  };
}

test('theme cache write failure cannot discard music commands or their acknowledgements', async () => {
  const worker = background({ initial: { token: 'fixture-token' }, failThemeWrite: true });
  worker.addPlayer();
  worker.setReply({ theme: extensionTheme(), commands: [{ id: 41, tabId: 7, provider: 'spotify', command: 'next' }] });
  await worker.sync();
  assert.deepEqual(worker.commands, [{ tabId: 7, type: 'player-command', command: 'next' }]);
  worker.setReply({ commands: [] });
  await worker.sync();
  assert.deepEqual(worker.requests[1].body.results, [{ id: 41, ok: true }]);
  assert.equal((await worker.message({ type: 'status' })).error, '');
});

test('successful pairing remains successful when only saving its palette fails', async () => {
  const worker = background({ failThemeWrite: true });
  worker.setReply({ theme: extensionTheme() });
  assert.deepEqual(await worker.message({ type: 'pair', code: 'A1B2C3D4' }), { ok: true });
  assert.equal(worker.storage.token, 'fixture-token');
  assert.equal((await worker.message({ type: 'status' })).paired, true);
});

test('unreadable palette cache uses the popup fallback without blocking connection status', async () => {
  const worker = background({ initial: { token: 'fixture-token' }, failThemeRead: true });
  const status = await worker.message({ type: 'status' });
  assert.equal(status.paired, true);
  assert.equal(status.theme, null);
  assert.equal(status.error, '');
});

test('unchanged palettes avoid repeated writes and a restarted worker restores the saved palette', async () => {
  const worker = background({ initial: { token: 'fixture-token' } });
  const theme = extensionTheme('#ffffff', '#f700d0');
  worker.setReply({ theme, commands: [] });
  await worker.sync(); await worker.sync();
  assert.equal(worker.writes.filter(write => 'popupTheme' in write).length, 1);
  const restarted = background({ initial: worker.storage });
  assert.deepEqual((await restarted.message({ type: 'status' })).theme, theme);
});
