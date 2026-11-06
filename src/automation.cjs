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
function readVoiceMode(input = {}) { return ['wake', 'hold'].includes(input.voiceMode) ? input.voiceMode : input.voiceEnabled === true ? 'hold' : 'wake'; }
function normalizeAutomation(input = {}) {
  return { configuration: Number.isSafeInteger(input.configuration) ? input.configuration : 0, mode: input.mode === 'wake' ? 'wake' : 'hold', activated: input.activated === true, foreground: typeof input.foreground === 'string' ? input.foreground.slice(0, 160) : '', listening: input.listening === true, session: Number.isSafeInteger(input.session) ? input.session : 0, command: typeof input.command === 'string' ? input.command : '', error: typeof input.error === 'string' ? input.error.slice(0, 500) : null, language: typeof input.language === 'string' ? input.language : '', phase: ['idle', 'waiting', 'listening', 'processing', 'recognized', 'tested', 'error'].includes(input.phase) ? input.phase : input.listening ? 'listening' : 'idle', test: input.test === true, heard: typeof input.heard === 'string' ? input.heard.slice(0, 200) : '', level: Number.isFinite(input.level) ? Math.max(0, Math.min(1, input.level)) : 0, peak: Number.isFinite(input.peak) ? Math.max(0, Math.min(1, input.peak)) : 0, speechAvailable: input.speechAvailable === true, microphones: Array.isArray(input.microphones) ? input.microphones.filter(m => m && typeof m.id === 'string' && /^(default|\d{1,3})$/.test(m.id) && typeof m.name === 'string').slice(0, 100).map(m => ({ id: m.id, name: m.name.slice(0, 200) })) : [] };
}
class WindowsAutomation extends WindowsMedia {
  constructor(script) {
    super(script, normalizeAutomation); this.configuration = null; this.revision = 0; this.started = false;
    this.on('bridge-started', () => { if (this.configuration) this.sendConfiguration(); });
  }
  configure(value) {
    if (JSON.stringify(this.configuration) === JSON.stringify(value)) return false;
    this.configuration = value; this.revision++;
    if (!this.started) { this.started = true; this.start(); }
    else this.sendConfiguration();
    return true;
  }
  sendConfiguration() {
    const revision = this.revision;
    this.request('configure', { ...this.configuration, revision }).catch(error => {
      if (revision === this.revision) this.emit('state', normalizeAutomation({ error: error.message, configuration: revision, mode: this.configuration?.mode }));
    });
  }
  refreshMicrophones() { return this.request('probe'); }
  testMicrophone(enabled) { return this.request('test', { enabled, revision: ++this.revision }); }

}
// Native action tokens are parsed as data and bounded independently of ASR.
function voiceAction(command) {
  const labels = { next: 'Следующий трек', previous: 'Предыдущий трек', pause: 'Пауза', resume: 'Воспроизведение', volumeUp: 'Громче', volumeDown: 'Тише', mute: 'Звук выключен', unmute: 'Звук включён' };
  if (Object.hasOwn(labels, command)) return { action: command, label: labels[command] };
  const match = /^(volumeSet|volumeStep):(-?\d{1,3})$/.exec(command);
  if (match) {
    const value = Number(match[2]);
    if (Math.abs(value) > 100 || match[1] === 'volumeSet' && value < 0) return null;
    return { action: match[1], value, label: match[1] === 'volumeSet' ? `Громкость ${value}%` : 'Громкость изменена' };
  }
  if (command === 'volumeScale:0.5' || command === 'volumeScale:2') return { action: 'volumeScale', value: Number(command.split(':')[1]), label: 'Громкость изменена' };
  return null;
}
class VoiceGate {
  constructor(getState, command, volume, feedback = () => {}) { Object.assign(this, { getState, command, volume, feedback }); this.session = 0; this.cancel(); }
  cancel() { this.source = null; this.used = true; this.generation = (this.generation || 0) + 1; }
  async accept(value) {
    if (value.test || !value.listening && !['processing', 'recognized'].includes(value.phase)) { this.cancel(); this.session = value.session; return; }
    if (value.session !== this.session) {
      if (value.command || !value.listening) return;
      this.session = value.session; this.source = this.getState().source?.id; this.used = false; this.generation++;
    }
    const state = this.getState();
    if (!value.command || this.used) return;
    this.used = true;
    if (this.source !== state.source?.id || value.mode === 'wake' && !value.activated) return;
    const parsed = voiceAction(value.command); if (!parsed) return;
    if (!this.source || !state.connected) { const result = { ok: false, error: 'Выберите активный плеер' }; this.feedback(result, '', value.heard || ''); return result; }
    const generation = this.generation; let result = { ok: true };
    if (['next', 'previous'].includes(parsed.action)) result = await this.command(parsed.action);
    else if (parsed.action === 'pause' && state.playing || parsed.action === 'resume' && !state.playing) result = await this.command('playPause');
    else if (parsed.action === 'volumeUp') result = await this.volume.step(.05);
    else if (parsed.action === 'volumeDown') result = await this.volume.step(-.05);
    else if (parsed.action === 'volumeSet') result = await this.volume.set(parsed.value / 100);
    else if (parsed.action === 'volumeStep') result = await this.volume.step(parsed.value / 100);
    else if (parsed.action === 'volumeScale') result = await this.volume.scale(parsed.value);
    else if (parsed.action === 'mute' || parsed.action === 'unmute') result = await this.command('mute', parsed.action === 'mute');
    if (generation === this.generation && this.source === this.getState().source?.id) {
      const label = Number.isFinite(result?.volume) ? `Громкость ${Math.round(result.volume * 100)}%` : parsed.label;
      this.feedback(result || { ok: true }, label, value.heard || '');
    }
    return result;
  }
}
module.exports = { WindowsAutomation, heldKeys, VoiceGate, normalizeAutomation, voiceAction, readVoiceMode };
