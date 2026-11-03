const { WindowsMedia } = require('./media.cjs');
const { normalizeAccelerator } = require('./shared/shortcuts.js');

function heldKeys(accelerator) {
  if (!accelerator) return [];
  const keys = { Control: 17, Alt: 18, Shift: 16, Super: 91, Space: 32, Tab: 9, Enter: 13, Escape: 27, Backspace: 8, Delete: 46, Insert: 45, Home: 36, End: 35, PageUp: 33, PageDown: 34, Up: 38, Down: 40, Left: 37, Right: 39, numdec: 110, numadd: 107, numsub: 109, nummult: 106, numdiv: 111, '-': 189, '=': 187, '[': 219, ']': 221, '\\': 220, ';': 186, "'": 222, ',': 188, '.': 190, '/': 191, '`': 192, Plus: 187, MediaPlayPause: 179, MediaStop: 178, MediaNextTrack: 176, MediaPreviousTrack: 177, VolumeUp: 175, VolumeDown: 174, VolumeMute: 173 };
  return normalizeAccelerator(accelerator).split('+').map(key => {
    if (/^[A-Z0-9]$/.test(key)) return key.charCodeAt(0);
    if (/^F\d+$/.test(key)) return 111 + Number(key.slice(1));
    if (/^num\d$/.test(key)) return 96 + Number(key.slice(3));
    if (!keys[key]) throw new Error('Это сочетание не поддерживает удержание');
    return keys[key];
  });
}
function normalizeAutomation(input = {}) {
  return { foreground: typeof input.foreground === 'string' ? input.foreground.slice(0, 160) : '', listening: input.listening === true, session: Number.isSafeInteger(input.session) ? input.session : 0, command: typeof input.command === 'string' ? input.command : '', error: typeof input.error === 'string' ? input.error.slice(0, 500) : null, language: typeof input.language === 'string' ? input.language : '', phase: ['idle', 'listening', 'processing', 'recognized', 'tested', 'error'].includes(input.phase) ? input.phase : input.listening ? 'listening' : 'idle', test: input.test === true, heard: typeof input.heard === 'string' ? input.heard.slice(0, 200) : '', level: Number.isFinite(input.level) ? Math.max(0, Math.min(1, input.level)) : 0, peak: Number.isFinite(input.peak) ? Math.max(0, Math.min(1, input.peak)) : 0, speechAvailable: input.speechAvailable === true, microphones: Array.isArray(input.microphones) ? input.microphones.filter(m => m && typeof m.id === 'string' && /^(default|\d{1,3})$/.test(m.id) && typeof m.name === 'string').slice(0, 100).map(m => ({ id: m.id, name: m.name.slice(0, 200) })) : [] };
}
class WindowsAutomation extends WindowsMedia {
  constructor(script) {
    super(script, normalizeAutomation); this.configuration = null; this.started = false;
    this.on('bridge-started', () => { if (this.configuration) this.sendConfiguration(); });
  }
  configure(value) {
    if (JSON.stringify(this.configuration) === JSON.stringify(value)) return;
    this.configuration = value;
    if (!this.started) { this.started = true; this.start(); }
    else this.sendConfiguration();
  }
  sendConfiguration() { this.request('configure', this.configuration).catch(error => this.emit('state', normalizeAutomation({ error: error.message }))); }
  refreshMicrophones() { return this.request('probe'); }
  testMicrophone(enabled) { return this.request('test', enabled); }
}
// Recognized text is never evaluated. Native grammar returns only these actions.
// A hold is bound to one source and accepts at most one command.
class VoiceGate {
  constructor(getState, command, volume) { Object.assign(this, { getState, command, volume }); this.session = 0; this.cancel(); }
  cancel() { this.source = null; this.used = true; }
  async accept(value) {
    if (value.test || !value.listening && !['processing', 'recognized'].includes(value.phase)) { this.cancel(); this.session = value.session; return; }
    if (value.session !== this.session) {
      if (value.command || !value.listening) return; // A result cannot create its own listening session.
      this.session = value.session; this.source = this.getState().source?.id; this.used = false;
    }
    const state = this.getState();
    if (!value.command || this.used) return;
    this.used = true;
    if (!this.source || this.source !== state.source?.id || !state.connected) return;
    if (['next', 'previous'].includes(value.command)) return this.command(value.command);
    if (value.command === 'pause' && state.playing || value.command === 'resume' && !state.playing) return this.command('playPause');
    if (value.command === 'volumeUp') return this.volume.step(.05);
    if (value.command === 'volumeDown') return this.volume.step(-.05);
    if (value.command === 'mute') return this.command('mute', true);
    if (value.command === 'unmute') return this.command('mute', false);
  }
}
module.exports = { WindowsAutomation, heldKeys, VoiceGate, normalizeAutomation };
