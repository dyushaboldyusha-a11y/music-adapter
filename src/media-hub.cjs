const { EventEmitter } = require('node:events');
const { EMPTY_STATE, validateCommand } = require('./media.cjs');

class MediaHub extends EventEmitter {
  constructor(native, browser) {
    super(); this.native = native; this.browser = browser; this.nativeState = { ...EMPTY_STATE }; this.selection = 'auto'; this.autoId = null; this.startedAt = new Map(); this.lastPlaying = new Map(); this.requestedNative = null;
    native?.on('state', state => { this.nativeState = state; this.refresh(); });
    native?.on('bridge-started', () => { this.requestedNative = null; this.reconnecting = this.selection.startsWith('native:') && !!this.lastSelected?.appId; });
    browser.on('change', () => this.refresh());
  }
  start() { this.native?.start(); this.refresh(); }
  available() {
    const web = this.browser.sources();
    const native = this.nativeState.sources || [];
    const connectedBrowsers = new Set(web.map(s => s.source.browser.toLowerCase()));
    return [...native.filter(s => !(s.provider === 'browser' && connectedBrowsers.has(s.browser.toLowerCase()))).map(source => ({ source, ...(this.nativeState.source?.id === source.id ? this.nativeState : { connected: false, playing: source.playing, title: source.title }) })), ...web];
  }
  refresh() {
    const available = this.available();
    if (this.reconnecting && this.lastSelected?.appId) {
      const candidates = available.filter(item => item.source.id.startsWith('native:') && item.source.appId.toLowerCase() === this.lastSelected.appId.toLowerCase());
      if (candidates.length === 1) { this.selection = candidates[0].source.id; this.lastSelected = candidates[0].source; this.reconnecting = false; }
    }
    const ids = new Set(available.map(s => s.source.id));
    for (const item of available) {
      const id = item.source.id;
      if (item.playing && !this.lastPlaying.get(id)) this.startedAt.set(id, Date.now());
      this.lastPlaying.set(id, item.playing);
    }
    for (const id of this.lastPlaying.keys()) if (!ids.has(id)) { this.lastPlaying.delete(id); this.startedAt.delete(id); }
    let active;
    if (this.selection !== 'auto') active = available.find(s => s.source.id === this.selection);
    else {
      const playing = available.filter(s => s.playing).sort((a, b) => (this.startedAt.get(b.source.id) || 0) - (this.startedAt.get(a.source.id) || 0) || Number(b.source.current) - Number(a.source.current));
      active = playing[0] || available.find(s => s.source.id === this.autoId) || available.find(s => s.source.current) || available[0];
      this.autoId = active?.source.id || null;
    }
    if (active && !active.source.id.startsWith('web:') && this.native && this.requestedNative !== active.source.id) {
      this.requestedNative = active.source.id;
      this.native.selectSource(active.source.id).catch(() => { if (this.requestedNative === active.source.id) this.requestedNative = null; });
    }
    this.state = { ...EMPTY_STATE, ...(active || {}), source: active?.source || this.lastSelected || null, selection: this.selection, sources: available.map(s => ({ ...s.source, playing: s.playing, title: s.title || s.source.title || '' })) };
    this.emit('state', this.state);
  }
  async selectSource(id) {
    if (id !== 'auto' && !this.available().some(s => s.source.id === id)) throw new Error('Источник уже закрыт');
    this.lastSelected = this.available().find(s => s.source.id === id)?.source || null;
    this.reconnecting = false;
    this.selection = id; this.refresh();
  }
  async command(command, value) {
    validateCommand(command, value);
    const state = this.state;
    if (!state?.connected || !state.capabilities?.[command] || !state.source) throw new Error('Команда недоступна у выбранного источника');
    if (state.source.id.startsWith('web:')) return this.browser.command(state.source.id, command, value);
    return this.native.command(command, value, state.source.id);
  }
  stop() { this.native?.stop(); this.browser.stop(); }
}
module.exports = { MediaHub };
