const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { normalizeState, validateCommand } = require('./media.cjs');
const { descriptor } = require('./sources.cjs');
const { fromUrl } = require('../browser-extension/services.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const extensionOrigin = origin => !origin || /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9-]{36})$/.test(origin);

class BrowserBridge extends EventEmitter {
  constructor({ port = 16837, dataFile } = {}) {
    super(); this.port = port; this.dataFile = dataFile; this.clients = new Map(); this.players = new Map(); this.pending = new Map(); this.available = false; this.failedPairings = []; this.nextId = 0;
    try { for (const c of JSON.parse(fs.readFileSync(dataFile, 'utf8'))) if (typeof c.id === 'string' && /^[a-f0-9]{64}$/.test(c.hash)) this.clients.set(c.id, { ...c, queue: [] }); } catch {}
  }
  async start() {
    this.server = http.createServer((request, response) => this.handle(request, response));
    this.server.requestTimeout = 10000; this.server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, '127.0.0.1', resolve); });
    this.port = this.server.address().port; this.available = true;
    this.timer = setInterval(() => this.expire(), 2000); this.timer.unref();
  }
  beginPairing() {
    if (!this.available) throw new Error('Подключение браузера недоступно. Перезапустите виджет.');
    this.pairing = { code: crypto.randomBytes(4).toString('hex').toUpperCase(), expiresAt: Date.now() + 300000 };
    return { ...this.pairing };
  }
  sources() { return [...this.players.values()].map(p => p.state); }
  persist() { if (this.dataFile) fs.writeFileSync(this.dataFile, JSON.stringify([...this.clients.values()].map(({ id, hash, name }) => ({ id, hash, name }))), { mode: 0o600 }); }
  expire() {
    let changed = false;
    for (const [id, p] of this.players) if (Date.now() - p.seen > 8000) { this.players.delete(id); changed = true; }
    if (changed) this.emit('change');
  }
  revoke() { this.clients.clear(); this.players.clear(); this.persist(); this.emit('change'); }
  async handle(request, response) {
    const origin = request.headers.origin || '';
    const send = (code, data) => { response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(origin && extensionOrigin(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) }); response.end(JSON.stringify(data)); };
    if (!extensionOrigin(origin)) return send(403, { error: 'Extension origin required' });
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Origin': origin || 'null', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type,authorization', 'Access-Control-Max-Age': '300' }); response.end(); return;
    }
    if (request.method !== 'POST' || !['/v1/pair', '/v1/sync'].includes(request.url)) return send(404, { error: 'Not found' });
    try {
      let size = 0, chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > (request.url === '/v1/pair' ? 8192 : 12000000)) { send(413, { error: 'Body too large' }); return; } chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'Invalid JSON' }); }
      if (request.url === '/v1/pair') {
        this.failedPairings = this.failedPairings.filter(t => Date.now() - t < 60000);
        if (this.failedPairings.length >= 5) return send(429, { error: 'Повторите через минуту' });
        if (!this.pairing || this.pairing.expiresAt < Date.now() || String(body.code).toUpperCase() !== this.pairing.code || !/^[\w-]{8,80}$/.test(body.clientId || '')) { this.failedPairings.push(Date.now()); return send(401, { error: 'Неверный или просроченный код' }); }
        const token = crypto.randomBytes(32).toString('base64url');
        if (this.clients.size >= 8 && !this.clients.has(body.clientId)) return send(409, { error: 'Отключите старые браузеры в разделе «Источники» Liberty Wave' });
        this.clients.set(body.clientId, { id: body.clientId, hash: hash(token), name: String(body.browser || 'Browser').slice(0, 40), queue: [] });
        this.pairing = null; this.persist();
        return send(200, { token });
      }
      const client = this.clients.get(body.clientId);
      const tokenHash = hash(String(request.headers.authorization || '').replace(/^Bearer /, ''));
      if (!client || !crypto.timingSafeEqual(Buffer.from(client.hash, 'hex'), Buffer.from(tokenHash, 'hex'))) return send(401, { error: 'Подключите расширение заново' });
      if (!Array.isArray(body.sources) || body.sources.length > 16 || !Array.isArray(body.results || [])) return send(400, { error: 'Invalid sources' });
      const alive = new Set();
      for (const entry of body.sources) {
        const service = fromUrl(entry.url);
        if (!service || !Number.isSafeInteger(entry.tabId) || entry.tabId < 0) continue;
        const id = `web:${client.id}:${entry.tabId}`;
        const source = descriptor({ id, provider: service.id, kind: 'browser', browser: client.name, title: entry.title, playing: entry.playing });
        const state = normalizeState({ ...entry, source, connected: true });
        this.players.set(id, { clientId: client.id, tabId: entry.tabId, state, seen: Date.now() }); alive.add(id);
      }
      for (const [id, p] of this.players) if (p.clientId === client.id && !alive.has(id)) this.players.delete(id);
      for (const result of (body.results || []).slice(0, 40)) {
        const pending = this.pending.get(result.id);
        if (pending && pending.clientId === client.id) { clearTimeout(pending.timer); this.pending.delete(result.id); result.ok === true ? pending.resolve() : pending.reject(new Error(String(result.error || 'Вкладка отклонила команду').slice(0, 200))); }
      }
      const commands = client.queue.splice(0).filter(c => this.pending.has(c.id));
      this.emit('change');
      return send(200, { commands });
    } catch (error) { if (!response.headersSent) send(500, { error: 'Browser bridge error' }); }
  }
  command(id, command, value) {
    validateCommand(command, value);
    const player = this.players.get(id);
    const client = this.clients.get(player?.clientId);
    if (!player || !client || Date.now() - player.seen > 8000) return Promise.reject(new Error('Вкладка уже закрыта'));
    const requestId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('Вкладка не ответила')); }, 12000);
      this.pending.set(requestId, { resolve, reject, timer, clientId: player.clientId });
      client.queue.push({ id: requestId, tabId: player.tabId, provider: player.state.source.provider, command, value });
    });
  }
  stop() { clearInterval(this.timer); this.available = false; if (this.server?.listening) this.server.close(); this.server?.closeAllConnections(); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Виджет закрыт')); } this.pending.clear(); }
}
module.exports = { BrowserBridge };
