const { EventEmitter } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { PlaybackClock } = require('./renderer/playback-clock.js');
const { artworkUrl } = require('./artwork-url.cjs');

const text = (value, length = 128) => Array.from(String(value || '').replace(/[\p{C}]/gu, ' ').trim()).slice(0, length).join('');
function clientId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{16,19}$/.test(value) || BigInt(value) > 18446744073709551615n) throw new Error('Укажите числовой Application ID из Discord Developer Portal');
  return value;
}
function frame(opcode, data) {
  const body = Buffer.from(JSON.stringify(data)); const header = Buffer.alloc(8);
  header.writeUInt32LE(opcode, 0); header.writeUInt32LE(body.length, 4); return Buffer.concat([header, body]);
}
function ipcPath(index, platform = process.platform, env = process.env) {
  return platform === 'win32' ? `\\\\?\\pipe\\discord-ipc-${index}` : path.join(env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || os.tmpdir(), `discord-ipc-${index}`);
}
function activityFor(state, { now = Date.now(), position = state?.position || 0, cover = null } = {}) {
  if (!state?.connected || !state.title?.trim()) return null;
  const activity = { type: 2, details: text(state.title), state: text(`${state.playing ? '' : '⏸ На паузе · '}${state.artist || state.source?.name || 'Liberty Wave'}`), instance: false };
  const image = artworkUrl(state.artworkUrl) || artworkUrl(cover);
  if (image) activity.assets = { large_image: image, large_text: text(state.album || state.title) };
  if (state.playing && !state.live && Number.isFinite(state.duration) && state.duration > 0 && state.duration <= 86400 && (state.playbackRate ?? 1) === 1) {
    const start = Math.round(now - Math.max(0, Math.min(state.duration, position)) * 1000);
    activity.timestamps = { start, end: start + Math.round(state.duration * 1000) };
  }
  return activity;
}
const trackKey = state => JSON.stringify([state?.source?.id, state?.title, state?.artist, state?.album]);
const canonical = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '');

class DiscordPresence extends EventEmitter {
  constructor({ connect = name => net.createConnection(name), fetch = globalThis.fetch, retryMs = 15000, throttleMs = 15000, timeoutMs = 3000, now = () => Date.now() } = {}) {
    super(); this.connect = connect; this.fetch = fetch; this.retryMs = retryMs; this.throttleMs = throttleMs; this.timeoutMs = timeoutMs; this.now = now;
    this.enabled = false; this.applicationId = ''; this.phase = 'off'; this.error = ''; this.epoch = 0; this.state = null; this.clock = new PlaybackClock(); this.covers = new Map(); this.cover = null; this.coverKey = ''; this.lastSentAt = -Infinity;
  }
  snapshot() { return { enabled: this.enabled, applicationId: this.applicationId, phase: this.phase, error: this.error }; }
  status(phase, error = '') { if (this.phase === phase && this.error === error) return; this.phase = phase; this.error = error; this.emit('state', this.snapshot()); }
  configure({ enabled = false, applicationId = '' } = {}) {
    let id = ''; try { id = clientId(applicationId); } catch {}
    if (this.enabled === enabled && this.applicationId === id) return;
    this.disconnect(); this.enabled = enabled === true; this.applicationId = id;
    if (!this.enabled) { this.status('off'); return; }
    if (!id) { this.status('missing-id'); return; }
    this.resolveCover(); this.open(0, this.epoch);
  }
  update(state) { this.state = state; this.clock.update(state); if (this.enabled && this.applicationId) { this.resolveCover(); this.flush(); } }
  async resolveCover() {
    const state = this.state, key = trackKey(state);
    if (key === this.coverKey) return;
    this.coverKey = key; this.cover = null; this.coverRequest?.abort();
    if (!state?.connected || !state.title || !state.artist || artworkUrl(state.artworkUrl)) return;
    if (this.covers.has(key)) { this.cover = this.covers.get(key); return; }
    const controller = new AbortController(); this.coverRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 4000); timeout.unref?.();
    try {
      const url = new URL('https://itunes.apple.com/search');
      url.search = new URLSearchParams({ term: `${state.artist} ${state.title}`, entity: 'song', limit: '5' }).toString();
      const response = await this.fetch(url.href, { signal: controller.signal });
      if (!response.ok || Number(response.headers.get('content-length')) > 131072) return;
      let size = 0; const chunks = [];
      for await (const chunk of response.body) { size += chunk.length; if (size > 131072) { controller.abort(); return; } chunks.push(chunk); }
      const results = JSON.parse(Buffer.concat(chunks).toString('utf8')).results;
      const found = Array.isArray(results) && results.find(item => canonical(item.trackName) === canonical(state.title) && canonical(item.artistName) === canonical(state.artist) && (!state.album || canonical(item.collectionName) === canonical(state.album)));
      const cover = found ? artworkUrl(found.artworkUrl100?.replace(/100x100bb(?=\.)/, '512x512bb')) : null;
      if (controller.signal.aborted) return;
      if (this.covers.size >= 64) this.covers.delete(this.covers.keys().next().value);
      this.covers.set(key, cover);
      if (this.coverKey === key && this.enabled) { this.cover = cover; this.flush(); }
    } catch { /* Cover lookup must never interrupt playback or the text status. */ }
    finally { clearTimeout(timeout); }
  }
  open(index, epoch) {
    if (!this.enabled || !this.applicationId || epoch !== this.epoch) return;
    clearTimeout(this.retry); this.status('connecting');
    let socket;
    try { socket = this.connect(ipcPath(index)); } catch { this.retryConnection(index, epoch); return; }
    this.socket = socket; this.ready = false; this.buffer = Buffer.alloc(0);
    let ended = false;
    const fail = rejection => {
      if (ended) return; ended = true;
      if (epoch !== this.epoch || this.socket !== socket) { socket.destroy(); return; }
      clearTimeout(this.connectionTimer); clearTimeout(this.ackTimer); clearTimeout(this.flushTimer);
      socket.destroy();
      this.socket = null; this.pending = null; this.lastSent = null; this.ready = false;
      if (typeof rejection === 'string') {
        this.status('error', rejection); this.retry = setTimeout(() => this.open(0, epoch), this.retryMs); this.retry.unref?.();
      } else this.retryConnection(index, epoch);
    };
    socket.on('error', fail); socket.on('close', fail);
    socket.on('connect', () => { if (epoch === this.epoch) socket.write(frame(0, { v: 1, client_id: this.applicationId })); });
    socket.on('data', chunk => {
      if (epoch !== this.epoch) return;
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > 1048584) { fail(); return; }
      while (this.buffer.length >= 8) {
        const opcode = this.buffer.readUInt32LE(0), size = this.buffer.readUInt32LE(4);
        if (size > 1048576) { fail(); return; }
        if (this.buffer.length < size + 8) break;
        const body = this.buffer.subarray(8, size + 8); this.buffer = this.buffer.subarray(size + 8);
        let data; try { data = JSON.parse(body.toString('utf8')); } catch { fail(); return; }
        if (opcode === 3) { socket.write(frame(4, data)); continue; }
        if (!data || typeof data !== 'object' || Array.isArray(data)) { fail(); return; }
        if (opcode === 2) { fail(!this.ready ? `Discord отклонил подключение${Number.isSafeInteger(data.code) ? ` (код ${data.code})` : ''}. Проверьте Application ID.` : undefined); return; }
        if (opcode !== 1) continue;
        if (!this.ready && data.evt === 'READY') { this.ready = true; clearTimeout(this.connectionTimer); this.lastSentAt = -Infinity; this.status('connected'); this.flush(); }
        else if (data.nonce && data.nonce === this.pending?.nonce) {
          clearTimeout(this.ackTimer);
          if (data.evt === 'ERROR') this.status('error', `Discord отклонил статус${Number.isSafeInteger(data.data?.code) ? ` (код ${data.data.code})` : ''}. Проверьте Application ID и настройки активности.`);
          else { this.lastSent = this.pending.activity; this.status('connected'); }
          this.pending = null; this.flush();
        }
      }
    });
    this.connectionTimer = setTimeout(fail, this.timeoutMs); this.connectionTimer.unref?.();
  }
  retryConnection(index, epoch) {
    if (epoch !== this.epoch || !this.enabled) return;
    if (index < 9) { this.open(index + 1, epoch); return; }
    this.status('waiting'); this.retry = setTimeout(() => this.open(0, epoch), this.retryMs); this.retry.unref?.();
  }
  flush() {
    if (!this.enabled || !this.ready || !this.socket || this.pending) return;
    const activity = activityFor(this.state, { now: this.now(), position: this.clock.position(), cover: this.cover });
    const equal = (a, b) => {
      if (JSON.stringify({ ...a, timestamps: undefined }) !== JSON.stringify({ ...b, timestamps: undefined })) return false;
      return !!a?.timestamps === !!b?.timestamps && (!a?.timestamps || Math.abs(a.timestamps.start - b.timestamps.start) < 2000 && Math.abs(a.timestamps.end - b.timestamps.end) < 2000);
    };
    if (this.lastSent !== undefined && equal(activity, this.lastSent)) return;
    const wait = activity === null ? 0 : Math.max(0, this.lastSentAt + this.throttleMs - this.now());
    clearTimeout(this.flushTimer);
    if (wait > 0) { this.flushTimer = setTimeout(() => this.flush(), wait); this.flushTimer.unref?.(); return; }
    const nonce = randomUUID(); this.pending = { nonce, activity }; this.lastSentAt = this.now();
    this.socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce }));
    this.ackTimer = setTimeout(() => { this.socket?.destroy(); }, this.timeoutMs); this.ackTimer.unref?.();
  }
  disconnect() {
    this.epoch++; clearTimeout(this.retry); clearTimeout(this.connectionTimer); clearTimeout(this.ackTimer); clearTimeout(this.flushTimer); this.coverRequest?.abort(); this.coverKey = '';
    const socket = this.socket;
    if (socket && this.ready && !socket.destroyed) socket.end(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: randomUUID() }));
    else socket?.destroy();
    const closed = socket && !socket.destroyed ? new Promise(resolve => { const timer = setTimeout(() => { socket.destroy(); resolve(); }, 250); timer.unref?.(); socket.once('close', () => { clearTimeout(timer); resolve(); }); }) : Promise.resolve();
    this.socket = null; this.ready = false; this.pending = null; this.lastSent = undefined; this.lastSentAt = -Infinity;
    return closed;
  }
  stop() { const closed = this.disconnect(); this.enabled = false; this.status('off'); return closed; }
}
module.exports = { DiscordPresence, activityFor, clientId, frame, ipcPath };
