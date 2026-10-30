const { WindowsMedia } = require('./media.cjs');

function normalizeAudio(input = {}) {
  return { target: typeof input.target === 'string' ? input.target.slice(0, 300) : '', available: input.available === true, volume: Number.isFinite(input.volume) ? Math.max(0, Math.min(1, input.volume)) : null, muted: input.muted === true };
}
class WindowsAudio extends WindowsMedia {
  constructor(scriptPath) {
    super(scriptPath, normalizeAudio);
    this.configuration = { target: '', enabled: false, economy: false };
    this.state = normalizeAudio();
    this.on('state', state => { this.state = normalizeAudio(state); });
    this.on('bridge-started', () => { if (!this.stopped) { const configuration = this.configuration; this.configuration = {}; this.configure(configuration); } });
  }
  configure(configuration) {
    if (JSON.stringify(configuration) === JSON.stringify(this.configuration)) return;
    this.configuration = configuration;
    this.request('configure', configuration).catch(() => { this.configuration = {}; });
  }
}

// Volume steps share one queue: held shortcuts must not reuse a stale volume or
// accidentally apply to a different player after a source change.
class VolumeQueue {
  constructor(getState, command) { this.getState = getState; this.command = command; this.pending = Promise.resolve(); }
  step(delta) { return this.enqueue('volume', delta); }
  mute() { return this.enqueue('mute'); }
  enqueue(action, delta) {
    const source = this.getState().source?.id;
    this.pending = this.pending.catch(() => {}).then(async () => {
      const state = this.getState();
      if (!source || state.source?.id !== source || !state.connected) return { ok: false };
      if (action === 'volume' && Number.isFinite(state.volume)) return this.command('volume', Math.round(Math.max(0, Math.min(1, state.volume + delta)) * 100) / 100);
      if (action === 'mute') return this.command('mute', !state.muted);
      return { ok: false };
    });
    return this.pending;
  }
}
module.exports = { WindowsAudio, VolumeQueue, normalizeAudio };
