const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DiscordPresence, DEFAULT_DISCORD_APPLICATION_ID, activityFor, clientId, frame, ipcPath } = require('../src/discord-presence.cjs');
const { normalizeState, validateCommand } = require('../src/media.cjs');
const id = '1234567890123456789';
const cover = 'https://i.scdn.co/image/example';
const track = extra => ({ connected: true, title: 'Трек', artist: 'Исполнитель', album: 'Альбом', playing: true, position: 30, duration: 180, source: { id: 'native:one', name: 'Плеер' }, artworkUrl: cover, ...extra });
const wait = async predicate => { const until = Date.now() + 3000; while (!predicate()) { if (Date.now() > until) throw new Error('Discord test timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };
async function localDiscord(t, { error = false, ready = true } = {}) {
  const name = process.platform === 'win32' ? `\\\\?\\pipe\\wave-test-${randomUUID()}` : path.join(os.tmpdir(), `wave-${randomUUID()}.sock`);
  const packets = [], sockets = [];
  const server = net.createServer(socket => {
    sockets.push(socket); socket.on('error', () => {}); let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8 && buffer.length >= 8 + buffer.readUInt32LE(4)) {
        const opcode = buffer.readUInt32LE(0), length = buffer.readUInt32LE(4), data = JSON.parse(buffer.subarray(8, length + 8)); buffer = buffer.subarray(length + 8); packets.push({ opcode, data });
        if (opcode === 0 && ready) { const packet = frame(1, { evt: 'READY', data: {} }); socket.write(packet.subarray(0, 3)); setImmediate(() => { if (!socket.destroyed) socket.write(packet.subarray(3)); }); }
        if (opcode === 1) socket.write(frame(1, { cmd: data.cmd, nonce: data.nonce, evt: error ? 'ERROR' : null, data: error ? { code: 4000, message: 'remote text' } : {} }));
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(name, resolve); });
  const presence = new DiscordPresence({ connect: () => net.createConnection(name), fetch: async () => { throw new Error('Unexpected cover lookup'); }, throttleMs: 40, emptyGraceMs: 80, retryMs: 25, timeoutMs: 200 });
  t.after(async () => { presence.stop(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { presence, packets, sockets, activities: () => packets.filter(p => p.data.cmd === 'SET_ACTIVITY') };
}
test('Discord ID, named pipes, artwork URLs and internal fade commands validate input', () => {
  assert.equal(clientId(id), id); assert.equal(clientId('18446744073709551615'), '18446744073709551615');
  for (const value of ['', 123, '1', '0123456789012345678', '18446744073709551616', '1234567890123456789\n']) assert.throws(() => clientId(value));
  assert.equal(ipcPath(4, 'win32'), '\\\\?\\pipe\\discord-ipc-4'); assert.equal(ipcPath(1, 'linux', { XDG_RUNTIME_DIR: '/run/user/1000' }), '/run/user/1000/discord-ipc-1');
  for (const value of ['http://i.scdn.co/x', 'https://user:pass@i.scdn.co/x', 'https://i.scdn.co.evil.invalid/x', 'data:image/png;base64,YQ==', 'https://127.0.0.1/x']) assert.equal(normalizeState({ artworkUrl: value }).artworkUrl, null);
  assert.equal(normalizeState({ artworkUrl: cover }).artworkUrl, cover);
  for (const value of [null, 600, { duration: NaN }, { duration: 149 }, { duration: 1501 }, { duration: 600, extra: true }]) assert.throws(() => validateCommand('fadePlayback', value));
  assert.doesNotThrow(() => validateCommand('fadePlayback', { duration: 600 }));
});
test('activity represents progress, pause, live playback and covers without sending audio or local thumbnails', () => {
  const playing = activityFor(track(), { now: 100000 });
  assert.deepEqual(playing.timestamps, { start: 70000, end: 250000 }); assert.equal(playing.type, 2); assert.equal(playing.assets.large_image, cover);
  const paused = activityFor(track({ playing: false, artwork: 'data:image/png;base64,private', artworkUrl: '' }));
  assert.equal(paused.timestamps, undefined); assert.ok(paused.state.includes('На паузе')); assert.equal(paused.assets, undefined); assert.ok(!JSON.stringify(paused).includes('private'));
  for (const extra of [{ live: true }, { playbackRate: 2 }, { duration: Infinity }]) assert.equal(activityFor(track(extra)).timestamps, undefined);
  assert.equal(activityFor(track({ connected: false })), null); assert.equal(activityFor(track({ title: ' ' })), null);
  assert.ok(Array.from(activityFor(track({ title: '🎶'.repeat(300) })).details).length <= 128);
});
test('disabled and missing-ID integration never connects or requests covers', () => {
  let connections = 0, lookups = 0;
  const presence = new DiscordPresence({ connect: () => { connections++; throw new Error(); }, fetch: () => { lookups++; } });
  presence.update(track({ artworkUrl: '' })); presence.configure({ enabled: false, applicationId: id });
  presence.configure({ enabled: true, applicationId: '' }); assert.equal(presence.snapshot().phase, 'missing-id');
  assert.equal(connections, 0); assert.equal(lookups, 0); presence.stop();
});
test('real local RPC handles fragmented READY, ping, seek, pause, source loss and disabling', async t => {
  const { presence, activities, packets, sockets } = await localDiscord(t);
  presence.update(track()); presence.configure({ enabled: true });
  await wait(() => activities().length === 1 && presence.lastSent);
  assert.deepEqual(packets[0].data, { v: 1, client_id: DEFAULT_DISCORD_APPLICATION_ID }); assert.equal(activities()[0].data.args.activity.details, 'Трек');
  sockets[0].write(frame(3, { ping: 1 })); await wait(() => packets.some(p => p.opcode === 4));
  presence.update(track({ position: 90 })); await wait(() => activities().length === 2);
  assert.ok(activities()[1].data.args.activity.timestamps.start < activities()[0].data.args.activity.timestamps.start - 59000);
  presence.update(track({ position: 90, playing: false })); await wait(() => activities().length === 3);
  assert.equal(activities()[2].data.args.activity.timestamps, undefined);
  presence.update(track({ connected: false })); await wait(() => activities().length === 4); assert.equal(activities()[3].data.args.activity, null);
  presence.configure({ enabled: false, applicationId: id }); await wait(() => activities().length === 5);
  assert.equal(activities()[4].data.args.activity, null); assert.equal(presence.snapshot().phase, 'off');
});
test('Discord restart reconnects with the latest song and changing IDs survives the old socket closing', async t => {
  const { presence, activities, sockets, packets } = await localDiscord(t);
  presence.update(track()); presence.configure({ enabled: true, applicationId: id }); await wait(() => activities().length === 1);
  sockets[0].destroy(); presence.update(track({ title: 'Новый трек' }));
  await wait(() => activities().some(p => p.data.args.activity?.details === 'Новый трек'));
  presence.configure({ enabled: true, applicationId: '1234567890123456790' });
  await wait(() => packets.some(p => p.opcode === 0 && p.data.client_id.endsWith('790')) && presence.lastSent?.details === 'Новый трек');
  assert.equal(presence.snapshot().phase, 'connected');
});
test('Discord rejection and malformed oversized frames are handled without crashing', async t => {
  const { presence, activities, sockets } = await localDiscord(t, { error: true });
  presence.update(track()); presence.configure({ enabled: true, applicationId: id });
  await wait(() => presence.snapshot().phase === 'error'); assert.ok(presence.snapshot().error.includes('4000')); assert.equal(activities().length, 1);
  const invalid = Buffer.alloc(8); invalid.writeUInt32LE(1, 0); invalid.writeUInt32LE(1048577, 4); sockets[0].write(invalid);
  await wait(() => sockets.length >= 2); sockets[1].write(frame(1, null)); await wait(() => sockets.length >= 3);
  presence.stop(); assert.equal(presence.snapshot().phase, 'off');
});
test('a refused Discord handshake reports an ID error and retries with backoff', async t => {
  const { presence, sockets } = await localDiscord(t, { ready: false });
  presence.configure({ enabled: true, applicationId: id }); await wait(() => sockets.length === 1);
  sockets[0].write(frame(2, { code: 4000, message: 'Invalid client id' }));
  await wait(() => presence.snapshot().phase === 'error'); assert.ok(presence.snapshot().error.includes('Application ID'));
  await wait(() => sockets.length >= 2); presence.stop();
});
test('native cover lookup accepts only exact metadata, caches results and stays off after disabling', async () => {
  let lookups = 0;
  const presence = new DiscordPresence({ connect: () => { throw new Error('Discord closed'); }, fetch: async url => {
    lookups++; assert.equal(new URL(url).hostname, 'itunes.apple.com');
    return new Response(JSON.stringify({ results: [{ trackName: 'Трек', artistName: 'Другой', collectionName: 'Альбом', artworkUrl100: cover }, { trackName: 'Трек', artistName: 'Исполнитель', collectionName: 'Альбом', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg' }] }));
  } });
  try {
    presence.update(track({ artworkUrl: '' })); presence.configure({ enabled: true, applicationId: id });
    await wait(() => presence.cover); assert.equal(presence.cover, 'https://is1-ssl.mzstatic.com/image/512x512bb.jpg');
    presence.update(track({ artworkUrl: '', position: 32 })); assert.equal(lookups, 1);
    presence.configure({ enabled: false, applicationId: id }); presence.update(track({ title: 'Другое', artworkUrl: '' })); assert.equal(lookups, 1);
  } finally { presence.stop(); }
});

test('a transient empty session between songs does not clear Discord presence', async t => {
  const { presence, activities } = await localDiscord(t);
  presence.update(track()); presence.configure({ enabled: true });
  await wait(() => presence.lastSent);
  presence.update(track({ connected: false, title: '' }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(activities().some(p => p.data.args.activity === null), false);
  presence.update(track({ title: 'Следующий трек' }));
  await wait(() => presence.lastSent?.details === 'Следующий трек');
  assert.equal(activities().some(p => p.data.args.activity === null), false);
  presence.update(track({ connected: false }));
  await wait(() => activities().some(p => p.data.args.activity === null));
});
