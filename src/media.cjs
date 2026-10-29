const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

const COMMANDS = new Set(['playPause', 'next', 'previous', 'seek', 'shuffle', 'repeat']);
const EMPTY_STATE = Object.freeze({ connected: false, title: '', artist: '', album: '', artwork: null, playing: false, position: 0, duration: 0, shuffle: false, repeat: 'none', capabilities: {}, error: null });

function validateCommand(command, value) {
  if (!COMMANDS.has(command)) throw new Error('Неизвестная команда');
  if (command === 'seek' && (!Number.isFinite(value) || value < 0 || value > 86400)) throw new Error('Некорректная позиция трека');
  if (command === 'shuffle' && typeof value !== 'boolean') throw new Error('Некорректное значение перемешивания');
  if (command === 'repeat' && !['none', 'track', 'list'].includes(value)) throw new Error('Некорректный режим повтора');
}

function normalizeState(input = {}) {
  const numeric = value => Number.isFinite(value) && value >= 0 ? value : 0;
  const artwork = typeof input.artwork === 'string' && /^data:image\/(png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/i.test(input.artwork) && input.artwork.length < 12_000_000 ? input.artwork : null;
  return { ...EMPTY_STATE, connected: input.connected === true, title: String(input.title || '').slice(0, 500), artist: String(input.artist || '').slice(0, 500), album: String(input.album || '').slice(0, 500), artwork, playing: input.playing === true, position: Math.min(numeric(input.position), numeric(input.duration)), duration: numeric(input.duration), shuffle: input.shuffle === true, repeat: ['none', 'track', 'list'].includes(input.repeat) ? input.repeat : 'none', capabilities: Object.fromEntries([...COMMANDS].map(key => [key, input.capabilities?.[key] === true])), error: input.error ? String(input.error).slice(0, 500) : null };
}

class WindowsMedia extends EventEmitter {
  constructor(scriptPath) { super(); this.scriptPath = scriptPath; this.pending = new Map(); this.nextId = 0; this.stopped = false; }
  start() {
    if (this.stopped) return;
    this.child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => {});
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      try {
        const message = JSON.parse(line.replace(/^\uFEFF/, ''));
        if (message.type === 'state') this.emit('state', normalizeState(message.state));
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
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Соединение с Яндекс Музыкой прервано')); }
      this.pending.clear();
      if (!this.stopped) {
        console.error('Windows media bridge:', diagnostic || 'exited');
        this.emit('state', { ...EMPTY_STATE, error: 'Нет доступа к медиасессиям Windows. Подключение будет повторено.' });
        this.retry = setTimeout(() => this.start(), 5000);
      }
    };
    this.child.on('error', onEnd); this.child.on('exit', onEnd);
  }
  command(command, value) {
    validateCommand(command, value);
    if (!this.child || this.child.exitCode !== null || !this.child.stdin.writable) return Promise.reject(new Error('Нет подключения к Яндекс Музыке'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Яндекс Музыка не ответила на команду')); }, 6000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, command, value }) + '\n');
    });
  }
  stop() { this.stopped = true; clearTimeout(this.retry); this.lines?.close(); this.child?.stdin.end(); this.child?.kill(); for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Приложение закрыто')); } this.pending.clear(); }
}

class DemoMedia extends EventEmitter {
  constructor() {
    super();
    this.index = 0;
    this.state = { ...EMPTY_STATE, connected: true, title: 'After Dark', artist: 'Mr.Kitty', album: 'Time', playing: true, position: 84, duration: 258, capabilities: { playPause: true, next: true, previous: true, seek: true, shuffle: true, repeat: true }, demo: true };
  }
  start() { this.emit('state', { ...this.state }); this.timer = setInterval(() => { if (this.state.playing) this.state.position = Math.min(this.state.duration, this.state.position + 1); this.emit('state', { ...this.state }); }, 1000); }
  async command(command, value) {
    validateCommand(command, value);
    if (command === 'playPause') this.state.playing = !this.state.playing;
    if (command === 'seek') this.state.position = Math.min(this.state.duration, value);
    if (command === 'shuffle') this.state.shuffle = value;
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
