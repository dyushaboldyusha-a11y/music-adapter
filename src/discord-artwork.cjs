const { artworkUrl } = require('./artwork-url.cjs');

const canonical = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '');
function credit(value) {
  const names = [];
  const title = String(value || '').replace(/\s*[([]\s*(?:feat(?:uring)?|ft)\.?\s+([^\])]+)[\])]/gi, (_, artists) => { names.push(artists); return ''; });
  return { title: canonical(title), names };
}
function artistKeys(names) {
  return [...new Set(names.flatMap(name => String(name).split(/\s*(?:,|;|&|\bfeat(?:uring)?\.?\s+|\bft\.?\s+)\s*/i)).map(canonical).filter(Boolean))].sort();
}
function matches(state, item) {
  const expected = credit(state.title), actual = credit(item.title);
  if (!expected.title || expected.title !== actual.title) return false;
  const left = [state.artist, ...expected.names], right = [...item.artists, ...actual.names];
  if (!canonical(state.artist) || !right.length) return false;
  // An artist can legitimately contain commas or an ampersand. Preserve the
  // full-credit comparison as well as explicitly listed collaboration credits.
  if (canonical(left.join(' ')) !== canonical(right.join(' ')) && JSON.stringify(artistKeys(left)) !== JSON.stringify(artistKeys(right))) return false;
  if (state.album && (!item.albums.length || !item.albums.some(album => canonical(album) === canonical(state.album)))) return false;
  if (Number.isFinite(state.duration) && state.duration > 0 && Number.isFinite(item.duration) && item.duration > 0 && Math.abs(state.duration - item.duration) > 3) return false;
  return true;
}
function yandexCover(value) {
  if (typeof value !== 'string') return null;
  const url = value.replace(/%%/g, '512x512');
  return artworkUrl(url.startsWith('//') ? `https:${url}` : /^https:\/\//i.test(url) ? url : `https://${url}`);
}
function selectYandexCover(state, results) {
  if (!Array.isArray(results)) return null;
  for (const item of results) {
    if (!item || typeof item.title !== 'string') continue;
    const version = typeof item.version === 'string' ? item.version : '';
    const title = version && !canonical(item.title).endsWith(canonical(version)) ? `${item.title} (${version})` : item.title;
    const albums = Array.isArray(item.albums) ? item.albums.filter(album => album && typeof album.title === 'string') : [];
    const artists = Array.isArray(item.artists) ? item.artists.filter(artist => artist && typeof artist.name === 'string').map(artist => artist.name) : [];
    const normalized = { title, artists, albums: albums.map(album => album.title), duration: item.durationMs / 1000 };
    if (matches(state, normalized)) {
      const matching = state.album ? albums.filter(album => canonical(album.title) === canonical(state.album)) : albums;
      // A search result may list several releases. Its top-level cover belongs
      // to the primary release, not necessarily the album Windows is playing.
      const cover = matching.map(album => yandexCover(album.coverUri)).find(Boolean) || (!state.album || matching.includes(albums[0]) ? yandexCover(item.coverUri) : null);
      if (cover) return cover;
    }
  }
  return null;
}
function selectAppleCover(state, results) {
  if (!Array.isArray(results)) return null;
  for (const item of results) {
    if (!item || typeof item.trackName !== 'string' || typeof item.artistName !== 'string' || typeof item.artworkUrl100 !== 'string') continue;
    if (!matches(state, { title: item.trackName, artists: [item.artistName], albums: [item.collectionName], duration: item.trackTimeMillis / 1000 })) continue;
    const cover = artworkUrl(item.artworkUrl100?.replace(/100x100bb(?=\.)/, '512x512bb'));
    if (cover) return cover;
  }
  return null;
}

async function readCatalog(fetch, url, parentSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener('abort', abort, { once: true });
  if (parentSignal.aborted) controller.abort();
  const timer = setTimeout(abort, 1300); timer.unref?.();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(new Error('Cover lookup cancelled')); controller.signal.addEventListener('abort', rejectAbort, { once: true }); });
  try {
    if (controller.signal.aborted) throw new Error('Cover lookup cancelled');
    return await Promise.race([aborted, (async () => {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error' });
      if (!response.ok || Number(response.headers.get('content-length')) > 262144) {
        response.body?.cancel().catch(() => {});
        const error = new Error('Cover catalog unavailable or oversized');
        if (!response.ok) error.transient = response.status === 429 || response.status >= 500;
        throw error;
      }
      let bytes = 0; const chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 262144) { controller.abort(); throw new Error('Cover catalog response exceeds limit'); }
        chunks.push(Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    })()]);
  } finally {
    clearTimeout(timer); parentSignal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectAbort);
    controller.abort();
  }
}
async function lookupCover(state, { fetch, signal }) {
  let transient = false;
  const request = async url => {
    if (signal.aborted) return null;
    try { return await readCatalog(fetch, url, signal); }
    catch (error) { transient ||= error.transient !== false; return null; }
  };
  if (state.source?.provider === 'yandex') {
    const url = new URL('https://api.music.yandex.net/search');
    url.search = new URLSearchParams({ text: `${state.artist} ${state.title}`, type: 'track', page: '0', nocorrect: 'true' }).toString();
    const data = await request(url.href);
    const cover = selectYandexCover(state, data?.result?.tracks?.results);
    if (cover) return { cover, transient: false };
  }
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({ term: `${state.artist} ${state.title}`, entity: 'song', limit: '25' }).toString();
  const data = await request(url.href);
  let cover = selectAppleCover(state, data?.results);
  if (!cover && !signal.aborted) {
    url.search = new URLSearchParams({ term: state.artist, entity: 'song', attribute: 'artistTerm', limit: '50' }).toString();
    cover = selectAppleCover(state, (await request(url.href))?.results);
  }
  return { cover, transient };
}

module.exports = { lookupCover, selectYandexCover, selectAppleCover };
