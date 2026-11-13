const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BrowserBridge } = require('../src/browser-bridge.cjs');
const origin = 'chrome-extension://' + 'a'.repeat(32);
async function request(bridge, path, body, token, from = origin) {
  return fetch(`http://127.0.0.1:${bridge.port}${path}`, { method: 'POST', headers: { Origin: from, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}
test('browser connector pairs locally and rejects unauthenticated or website-origin updates', async () => {
  const bridge = new BrowserBridge({ port: 0 }); await bridge.start();
  try {
    assert.equal((await request(bridge, '/v1/pair', { code: 'bad', clientId: 'test-client' })).status, 401);
    const pair = bridge.beginPairing();
    const response = await request(bridge, '/v1/pair', { code: pair.code, clientId: 'test-client', browser: 'Chrome' });
    assert.equal(response.status, 200); const { token } = await response.json();
    const body = { clientId: 'test-client', sources: [{ tabId: 5, url: 'https://open.spotify.com/', title: 'Song', artist: 'Artist', playing: true, capabilities: { playPause: true } }] };
    assert.equal((await request(bridge, '/v1/sync', body)).status, 401);
    assert.equal((await request(bridge, '/v1/sync', body, token, 'https://attacker.invalid')).status, 403);
    assert.equal((await request(bridge, '/v1/sync', body, token)).status, 200);
    const source = bridge.sources()[0]; assert.equal(source.source.provider, 'spotify'); assert.equal(source.title, 'Song');
    const action = bridge.command(source.source.id, 'playPause');
    const commands = (await (await request(bridge, '/v1/sync', body, token)).json()).commands;
    assert.equal(commands.length, 1); assert.equal(commands[0].tabId, 5); assert.equal(commands[0].provider, 'spotify');
    await request(bridge, '/v1/sync', { ...body, results: [{ id: commands[0].id, ok: true }] }, token);
    await action;
    await request(bridge, '/v1/sync', { ...body, sources: [] }, token);
    assert.equal(bridge.sources().length, 0);
  } finally { bridge.stop(); }
});
test('a disconnected extension expires and cannot masquerade as an unsupported site', async () => {
  const bridge = new BrowserBridge({ port: 0 }); await bridge.start();
  try {
    const pair = bridge.beginPairing();
    const { token } = await (await request(bridge, '/v1/pair', { code: pair.code, clientId: 'test-client-2', browser: 'Edge' })).json();
    await request(bridge, '/v1/sync', { clientId: 'test-client-2', sources: [{ tabId: 1, url: 'https://attacker.invalid/', title: 'Fake' }, { tabId: 2, url: 'https://www.youtube.com/', title: 'Video', playing: true }] }, token);
    assert.equal(bridge.sources().length, 1); assert.equal(bridge.sources()[0].source.provider, 'youtube');
    for (const player of bridge.players.values()) player.seen -= 9000;
    bridge.expire(); assert.equal(bridge.sources().length, 0);
    bridge.revoke();
    assert.equal((await request(bridge, '/v1/sync', { clientId: 'test-client-2', sources: [] }, token)).status, 401);
  } finally { bridge.stop(); }
});

test('the app palette is shared only after pairing/authentication and updates without exposing settings', async () => {
  const { extensionTheme } = require('../src/extension-theme.cjs');
  let current = extensionTheme('#ff3045', '#e8edf3'), calls = 0;
  const bridge = new BrowserBridge({ port: 0, getTheme: () => { calls++; return { ...current, nickname: 'private', token: 'private', tokens: { ...current.tokens, '--private': 'private' } }; } });
  await bridge.start();
  try {
    const denied = await request(bridge, '/v1/sync', { clientId: 'theme-client', sources: [] });
    assert.equal(denied.status, 401); assert.equal(calls, 0); assert.equal((await denied.json()).theme, undefined);
    const wrongPair = await request(bridge, '/v1/pair', { code: 'invalid', clientId: 'theme-client' });
    assert.equal(wrongPair.status, 401); assert.equal(calls, 0);
    const pair = bridge.beginPairing();
    const paired = await (await request(bridge, '/v1/pair', { code: pair.code, clientId: 'theme-client' })).json();
    assert.ok(paired.token); assert.deepEqual(paired.theme, current); assert.equal(calls, 1);
    current = extensionTheme('#ffffff', '#f700d0');
    const next = await (await request(bridge, '/v1/sync', { clientId: 'theme-client', sources: [], preferences: { color: '#000000' }, theme: { tokens: { '--red': '#000000' } } }, paired.token)).json();
    assert.deepEqual(next.commands, []); assert.deepEqual(next.theme, current);
    assert.equal(JSON.stringify(next).includes('private'), false); assert.equal(next.theme.tokens['--red'], '#ffffff');
    const fromWebsite = await request(bridge, '/v1/sync', { clientId: 'theme-client', sources: [] }, paired.token, 'https://attacker.invalid');
    assert.equal(fromWebsite.status, 403); assert.equal((await fromWebsite.json()).theme, undefined);
    bridge.getTheme = () => { throw new Error('Appearance provider unavailable'); };
    const unaffected = await request(bridge, '/v1/sync', { clientId: 'theme-client', sources: [] }, paired.token);
    assert.equal(unaffected.status, 200); assert.deepEqual(await unaffected.json(), { commands: [] });
  } finally { bridge.stop(); }
});
