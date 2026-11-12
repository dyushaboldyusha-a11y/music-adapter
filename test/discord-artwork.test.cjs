const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectYandexCover, selectAppleCover, lookupCover } = require('../src/discord-artwork.cjs');
const { artworkUrl } = require('../src/artwork-url.cjs');
const image = 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg';
const state = { title: 'all i need', artist: '8rings', album: 'all i need', duration: 100, source: { provider: 'yandex' } };
const yandexTrack = extra => ({ title: 'all i need', artists: [{ name: '8rings' }], albums: [{ title: 'all i need' }], durationMs: 100000, coverUri: 'avatars.yandex.net/get-music-content/123/album/%%', ...extra });
const appleTrack = extra => ({ trackName: state.title, artistName: state.artist, collectionName: state.album, trackTimeMillis: 100000, artworkUrl100: image, ...extra });
test('Yandex selection matches the complete track and source album without substituting a remix or namesake', () => {
  assert.equal(selectYandexCover(state, [yandexTrack({ artists: [{ name: 'Other' }] }), yandexTrack({ version: 'Remix' }), yandexTrack({ albums: [{ title: 'Other album' }] }), yandexTrack({ durationMs: 200000 })]), null);
  assert.equal(selectYandexCover(state, [yandexTrack()]), 'https://avatars.yandex.net/get-music-content/123/album/512x512');
  assert.equal(selectYandexCover({ ...state, title: 'all i need (Remix)' }, [yandexTrack({ version: 'Remix' })]), 'https://avatars.yandex.net/get-music-content/123/album/512x512');
  assert.equal(selectYandexCover(state, [yandexTrack({ coverUri: 'evil.invalid/image' })]), null);
});
test('matching understands explicit collaborator credits while preserving editions and nonempty albums', () => {
  const duet = { ...state, title: 'all i need (feat. Guest)', artist: '8rings' };
  assert.ok(selectYandexCover(duet, [yandexTrack({ artists: [{ name: '8rings' }, { name: 'Guest' }] })]));
  assert.ok(selectYandexCover({ ...state, artist: 'Guest & 8rings' }, [yandexTrack({ artists: [{ name: '8rings' }, { name: 'Guest' }] })]));
  assert.equal(selectYandexCover(state, [yandexTrack({ artists: [{ name: '8rings' }, { name: 'Guest' }] })]), null);
  assert.equal(selectAppleCover(state, [appleTrack({ collectionName: 'Different' })]), null);
  assert.equal(selectAppleCover(state, [appleTrack({ trackName: 'all i need (Live)' })]), null);
  assert.equal(selectAppleCover(state, [appleTrack()]), image.replace('100x100', '512x512'));
});
test('Yandex chooses the matching album cover instead of a different release primary cover', () => {
  const result = yandexTrack({ coverUri: 'avatars.yandex.net/primary/%%', albums: [{ title: 'Other', coverUri: 'avatars.yandex.net/other/%%' }, { title: state.album, coverUri: 'avatars.yandex.net/expected/%%' }] });
  assert.equal(selectYandexCover(state, [result]), 'https://avatars.yandex.net/expected/512x512');
  result.albums[1].coverUri = null;
  assert.equal(selectYandexCover(state, [result]), null);
});
test('malformed catalog items are skipped without preventing later exact results', () => {
  assert.ok(selectYandexCover(state, [null, {}, yandexTrack({ artists: [null], albums: [null] }), yandexTrack()]));
  assert.ok(selectAppleCover(state, [null, {}, appleTrack({ artworkUrl100: 123 }), appleTrack()]));
});
test('native Yandex public search is preferred and never needs authentication or image uploads', async () => {
  const calls = [];
  const result = await lookupCover(state, { signal: new AbortController().signal, fetch: async (url, options) => {
    calls.push(url); assert.equal(options.credentials, 'omit'); assert.equal(options.headers, undefined);
    return new Response(JSON.stringify({ result: { tracks: { results: [yandexTrack()] } } }));
  } });
  assert.equal(new URL(calls[0]).hostname, 'api.music.yandex.net'); assert.equal(calls.length, 1); assert.ok(result.cover.includes('avatars.yandex.net'));
});
test('an unavailable Yandex catalog falls back to broader exact Apple search and artist search', async () => {
  const calls = [];
  const result = await lookupCover(state, { signal: new AbortController().signal, fetch: async url => {
    const u = new URL(url); calls.push(u);
    if (u.hostname === 'api.music.yandex.net') return new Response('{}', { status: 451 });
    return new Response(JSON.stringify({ results: u.searchParams.has('attribute') ? [appleTrack()] : [appleTrack({ artistName: 'Different' })] }));
  } });
  assert.ok(result.cover.includes('512x512')); assert.equal(calls.length, 3);
  assert.equal(calls[1].searchParams.get('limit'), '25'); assert.equal(calls[2].searchParams.get('attribute'), 'artistTerm'); assert.equal(calls[2].searchParams.get('limit'), '50');
});
test('catalog response limits apply to declared and streamed bodies and cancellation stops fallback requests', async () => {
  let calls = 0;
  const result = await lookupCover(state, { signal: new AbortController().signal, fetch: async () => {
    calls++; return calls === 1 ? new Response('{}', { headers: { 'content-length': '300000' } }) : new Response(' '.repeat(270000));
  } });
  assert.equal(result.cover, null); assert.equal(result.transient, true); assert.equal(calls, 3);
  const controller = new AbortController(); controller.abort();
  await lookupCover(state, { signal: controller.signal, fetch: () => { throw new Error('Must stay offline after abort'); } });
});
test('Discord artwork validation retains its 256-character limit after URL normalization', () => {
  assert.equal(artworkUrl('https://i.scdn.co/' + 'é'.repeat(60)), null);
  assert.equal(artworkUrl('https://i.scdn.co/' + 'a'.repeat(240)), null);
  assert.equal(artworkUrl('https://i.scdn.co/image/cover'), 'https://i.scdn.co/image/cover');
});
