importScripts('services.js');
const BASE = 'http://127.0.0.1:16837';
const players = new Map(), covers = new Map();
let timer, syncing = false, dirty = false, lastError = '', results = [];
async function config() { const c = await chrome.storage.local.get(['clientId', 'token']); if (!c.clientId) { c.clientId = crypto.randomUUID(); await chrome.storage.local.set({ clientId: c.clientId }); } return c; }
async function post(path, body, token) {
  const response = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 && path !== '/v1/pair') await chrome.storage.local.remove('token'); throw new Error(data.error || 'Нет подключения'); }
  return data;
}
async function cover(url) {
  if (!url) return null;
  if (/^data:image\/(png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/i.test(url)) return url.length < 3000000 ? url : null;
  let host;
  try { const u = new URL(url); if (u.protocol !== 'https:') return null; host = u.hostname; } catch { return null; }
  if (!['yandex.net', 'scdn.co', 'spotifycdn.com', 'sndcdn.com', 'ytimg.com', 'userapi.com', 'vk-cdn.net'].some(d => host === d || host.endsWith('.' + d))) return null;
  if (!covers.has(url)) {
    if (covers.size >= 24) covers.delete(covers.keys().next().value);
    covers.set(url, (async () => {
      try {
        const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(4000) });
        if (!response.ok || Number(response.headers.get('content-length')) > 2000000) return null;
        const reader = response.body.getReader(); let bytes = 0, chunks = [];
        while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 2000000) { await reader.cancel(); return null; } chunks.push(next.value); }
        const data = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        let mime = response.headers.get('content-type')?.split(';')[0] || '';
        if (data[0] === 137 && data[1] === 80) mime = 'image/png'; else if (data[0] === 255 && data[1] === 216) mime = 'image/jpeg'; else if (data[0] === 71 && data[1] === 73) mime = 'image/gif'; else if (data[0] === 82 && data[8] === 87) mime = 'image/webp';
        if (!/^image\/(png|jpe?g|webp|gif|bmp)$/.test(mime)) return null;
        let binary = ''; for (let start = 0; start < data.length; start += 16384) binary += String.fromCharCode(...data.subarray(start, start + 16384));
        return `data:${mime};base64,${btoa(binary)}`;
      } catch { covers.delete(url); return null; }
    })());
  }
  return covers.get(url);
}
function schedule() { dirty = true; if (!timer) timer = setTimeout(() => { timer = null; sync(); }, 200); }
async function sync() {
  if (syncing) { dirty = true; return; }
  syncing = true; dirty = false;
  try {
    const c = await config(); if (!c.token) return;
    const sources = await Promise.all([...players.entries()].slice(0, 16).map(async ([tabId, item]) => ({ ...item.state, tabId, url: item.url, artwork: await cover(item.state.artworkUrl) })));
    const outgoing = results; results = [];
    let data;
    try { data = await post('/v1/sync', { clientId: c.clientId, sources, results: outgoing }, c.token); }
    catch (error) { results.unshift(...outgoing); throw error; }
    lastError = '';
    for (const action of data.commands || []) {
      let result;
      try {
        if (LibertyServices.fromUrl(players.get(action.tabId)?.url)?.id !== action.provider) throw new Error('Source changed');
        result = await chrome.tabs.sendMessage(action.tabId, { type: 'player-command', command: action.command, value: action.value });
      }
      catch { result = { ok: false, error: 'Вкладка закрыта или перезагружена' }; }
      results.push({ id: action.id, ...result }); dirty = true;
    }
  } catch (error) { lastError = error.message === 'Failed to fetch' ? 'Откройте настольный виджет Liberty' : error.message; }
  finally { syncing = false; if (dirty && !timer) timer = setTimeout(() => { timer = null; sync(); }, 100); }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'player-state') {
    const service = LibertyServices.fromUrl(sender.url);
    if (!service || !Number.isInteger(sender.tab?.id)) return;
    if (message.state && typeof message.state === 'object') players.set(sender.tab.id, { state: message.state, seen: Date.now(), url: new URL(sender.url).origin + '/' }); else players.delete(sender.tab.id);
    schedule(); return;
  }
  if (sender.url !== chrome.runtime.getURL('popup.html')) return;
  if (message.type === 'status') { config().then(c => respond({ paired: !!c.token, players: players.size, error: lastError })); return true; }
  if (message.type === 'pair') {
    (async () => { try { const c = await config(); const data = await post('/v1/pair', { code: String(message.code || '').trim().toUpperCase(), clientId: c.clientId, browser: LibertyServices.browserName(navigator.userAgent) }); await chrome.storage.local.set({ token: data.token }); lastError = ''; schedule(); respond({ ok: true }); } catch (error) { respond({ ok: false, error: error.message === 'Failed to fetch' ? 'Откройте Liberty и нажмите «Подключить браузер»' : error.message }); } })();
    return true;
  }
  if (message.type === 'disconnect') { chrome.storage.local.remove('token').then(() => respond({ ok: true })); return true; }
});
chrome.tabs.onRemoved.addListener(id => { players.delete(id); schedule(); });
chrome.tabs.onUpdated.addListener((id, change) => { if (change.status === 'loading') { players.delete(id); schedule(); } });
chrome.alarms.create('liberty-sync', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => schedule());

// Keep the local connection alive while music tabs exist, including paused
// background tabs whose document timers are throttled by Chromium.
setInterval(() => { if (players.size) schedule(); }, 2000);
