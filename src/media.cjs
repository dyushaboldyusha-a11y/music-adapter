const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { descriptor } = require('./sources.cjs');

const COMMANDS = new Set(['playPause', 'next', 'previous', 'seek', 'shuffle', 'repeat', 'volume', 'mute']);
const EMPTY_STATE = Object.freeze({ connected: false, title: '', artist: '', album: '', artwork: null, playing: false, position: 0, duration: 0, shuffle: false, repeat: 'none', volume: null, muted: false, capabilities: {}, error: null });

function validateCommand(command, value) {
  if (!COMMANDS.has(command)) throw new Error('Неизвестная команда');
  if (command === 'seek' && (!Number.isFinite(value) || value < 0 || value > 86400)) throw new Error('Некорректная позиция трека');
  if (command === 'shuffle' && typeof value !== 'boolean') throw new Error('Некорректное значение перемешивания');
  if (command === 'repeat' && !['none', 'track', 'list'].includes(value)) throw new Error('Некорректный режим повтора');
  if (command === 'volume' && (!Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Некорректная громкость');
  if (command === 'mute' && typeof value !== 'boolean') throw new Error('Некорректное состояние звука');
}

function normalizeState(input = {}) {
  const numeric = value => Number.isFinite(value) && value >= 0 ? value : 0;
  const artwork = typeof input.artwork === 'string' && /^data:image\/(png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/i.test(input.artwork) && input.artwork.length < 12_000_000 ? input.artwork : null;
  return { ...EMPTY_STATE, connected: input.connected === true, title: String(input.title || '').slice(0, 500), artist: String(input.artist || '').slice(0, 500), album: String(input.album || '').slice(0, 500), artwork, playing: input.playing === true, live: input.live === true, position: Math.min(numeric(input.position), numeric(input.duration)), duration: numeric(input.duration), playbackRate: Number.isFinite(input.playbackRate) ? Math.max(0, Math.min(16, input.playbackRate)) : 1, sampledAt: Number.isFinite(input.sampledAt) && input.sampledAt > 0 ? input.sampledAt : null, sampleOrigin: typeof input.sampleOrigin === 'string' ? input.sampleOrigin.slice(0, 80) : '', sampleSequence: Number.isSafeInteger(input.sampleSequence) && input.sampleSequence >= 0 ? input.sampleSequence : null, timelineEpoch: Number.isSafeInteger(input.timelineEpoch) ? input.timelineEpoch : 0, shuffle: input.shuffle === true, repeat: ['none', 'track', 'list'].includes(input.repeat) ? input.repeat : 'none', volume: Number.isFinite(input.volume) ? Math.max(0, Math.min(1, input.volume)) : null, muted: input.muted === true, capabilities: Object.fromEntries([...COMMANDS].map(key => [key, input.capabilities?.[key] === true])), source: descriptor(input.source), sources: Array.isArray(input.sources) ? input.sources.map(descriptor).filter(Boolean).slice(0, 30) : [], error: input.error ? String(input.error).slice(0, 500) : null };
}

class WindowsMedia extends EventEmitter {
  constructor(scriptPath, normalize = normalizeState) { super(); this.scriptPath = scriptPath; this.normalize = normalize; this.pending = new Map(); this.nextId = 0; this.stopped = false; }
  start() {
    if (this.stopped) return;
    this.child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => {});
    this.child.once('spawn', () => this.emit('bridge-started'));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      try {
        const message = JSON.parse(line.replace(/^\uFEFF/, ''));
        if (message.type === 'state') this.emit('state', this.normalize(message.state));
        if (message.type === 'level') this.emit('level', { target: typeof message.target === 'string' ? message.target.slice(0, 300) : '', available: message.available === true, level: Number.isFinite(message.level) ? Math.max(0, Math.min(1, message.level)) : 0 });
        if (message.type === 'result') {
          const pending = this.pending.get(message.id);
          if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); message.ok ? pending.resolve() : pending.reject(new Error(message.error || 'Приложение отклонило команду')); }
        }
      } catch { /* Ignore diagnostic lines; only JSON is part of the bridge protocol. */ }
    });
    let diagnostic = '';
    this.child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-1000); });
    let ended = false;
    const onEnd = () => {
      if (ended) return; ended = true;
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Соединение с плеером прервано')); }
      this.pending.clear();
      if (!this.stopped) {
        console.error('Windows media bridge:', diagnostic || 'exited');
        this.emit('state', { ...EMPTY_STATE, error: 'Нет доступа к медиасессиям Windows. Подключение будет повторено.' });
        this.retry = setTimeout(() => this.start(), 5000);
      }
    };
    this.child.on('error', onEnd); this.child.on('exit', onEnd);
  }
  command(command, value, sourceId) {
    validateCommand(command, value);
    return this.request(command, value, sourceId);
  }
  selectSource(id) { return this.request('selectSource', id); }
  request(command, value, sourceId) {
    if (!this.child || this.child.exitCode !== null || !this.child.stdin.writable) return Promise.reject(new Error('Нет подключения к плееру'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Плеер не ответил на команду')); }, 6000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, command, value, sourceId }) + '\n');
    });
  }
  stop() { this.stopped = true; clearTimeout(this.retry); this.lines?.close(); this.child?.stdin.end(); this.child?.kill(); for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Приложение закрыто')); } this.pending.clear(); }
}

class DemoMedia extends EventEmitter {
  constructor() {
    super();
    this.index = 0;
    this.sources = [descriptor({ id: 'demo:yandex', provider: 'yandex', kind: 'app' }), descriptor({ id: 'demo:spotify', provider: 'spotify', kind: 'app' }), ...['yandex', 'spotify', 'soundcloud', 'youtube', 'vk'].map(provider => descriptor({ id: `demo:web-${provider}`, provider, kind: 'browser', browser: 'Chrome' }))];
    this.state = { ...EMPTY_STATE, connected: true, title: 'After Dark', artist: 'Mr.Kitty', album: 'Time', playing: true, position: 84, duration: 258, capabilities: { playPause: true, next: true, previous: true, seek: true, shuffle: true, repeat: true, volume: true, mute: true }, volume: .65, muted: false, demo: true, source: this.sources[0], sources: this.sources, selection: 'auto' };
  }
  async selectSource(id) { const source = id === 'auto' ? this.sources[0] : this.sources.find(s => s.id === id); if (!source) throw new Error('Источник недоступен'); this.state.source = source; this.state.selection = id; this.state.capabilities = { ...this.state.capabilities, shuffle: source.kind === 'app', repeat: source.kind === 'app' }; this.emit('state', { ...this.state }); }
  start() { this.emit('state', { ...this.state }); this.timer = setInterval(() => { if (this.state.playing) this.state.position = Math.min(this.state.duration, this.state.position + 1); this.emit('state', { ...this.state }); }, 1000); }
  async command(command, value) {
    validateCommand(command, value);
    if (command === 'playPause') this.state.playing = !this.state.playing;
    if (command === 'seek') this.state.position = Math.min(this.state.duration, value);
    if (command === 'shuffle') this.state.shuffle = value;
    if (command === 'volume') { this.state.volume = value; if (value > 0) this.state.muted = false; }
    if (command === 'mute') this.state.muted = value;
    if (command === 'repeat') this.state.repeat = value;
    if (command === 'next' || command === 'previous') {
      this.index = this.index ? 0 : 1;
      Object.assign(this.state, this.index ? { title: 'The Perfect Girl', artist: 'Mareux', album: 'The Perfect Girl', duration: 194 } : { title: 'After Dark', artist: 'Mr.Kitty', album: 'Time', duration: 258 });
      this.state.position = 0;
    }
    this.emit('state', { ...this.state });
  }
  stop() { clearInterval(this.timer); }
}

module.exports = { WindowsMedia, DemoMedia, EMPTY_STATE, validateCommand, normalizeState };
