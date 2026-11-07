(function (root) {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const identity = state => JSON.stringify([state.source?.id, state.title, state.artist, state.album]);
  class PlaybackFade {
    constructor(getState, send, { sleep = delay, now = () => performance.now() } = {}) {
      this.getState = getState; this.send = send; this.sleep = sleep; this.now = now; this.pending = Promise.resolve(); this.active = null; this.stopped = false;
    }
    command(action, value, { enabled = false, duration = 600 } = {}) {
      const source = this.getState().source?.id;
      const run = async () => {
        const state = { ...this.getState() };
        if (this.stopped || !state.connected || !source || state.source?.id !== source) throw new Error('Источник музыки изменился');
        if (action !== 'playPause' || !enabled || !state.capabilities?.volume || !Number.isFinite(state.volume) || state.volume <= 0 || state.muted) return this.send(action, value, state);
        const task = { state, key: identity(state), element: state.playbackIdentity, volume: state.volume, cancelled: false, restored: null };
        this.active = task;
        const current = () => !task.cancelled && !this.stopped && this.getState().connected && identity(this.getState()) === task.key && this.getState().playbackIdentity === task.element;
        const write = async volume => { if (!current()) throw new Error('Плавный переход прерван'); await this.send('volume', volume, state); };
        try {
          if (!state.playing) { await write(0); if (!current()) throw new Error('Плавный переход прерван'); if (!this.getState().playing) await this.send('playPause', undefined, state); }
          const start = this.now(), length = Math.max(150, Math.min(1500, duration));
          let progress = 0;
          while (progress < 1) {
            await this.sleep(Math.min(40, length));
            progress = Math.min(1, Math.max(0, this.now() - start) / length);
            const eased = progress * progress * (3 - 2 * progress);
            await write(state.volume * (state.playing ? 1 - eased : eased));
          }
          if (!current()) throw new Error('Плавный переход прерван');
          if (state.playing && this.getState().playing) await this.send('playPause', undefined, state);
        } finally {
          try { await this.restore(task); } finally { if (this.active === task) this.active = null; }
        }
      };
      const result = this.pending.catch(() => {}).then(run); this.pending = result; return result;
    }
    restore(task) {
      // Capture and address the original source, including during an automatic
      // source change. A pending fade write is already ahead of this restore.
      if (!task.restored) { try { task.restored = Promise.resolve(this.send('volume', task.volume, task.state)); } catch (error) { task.restored = Promise.reject(error); } }
      return task.restored;
    }
    cancel() { const task = this.active; if (!task) return Promise.resolve(); task.cancelled = true; return this.restore(task); }
    observe(state) {
      if (this.active && (!state.connected || identity(state) !== this.active.key || state.playbackIdentity !== this.active.element)) return this.cancel();
      return Promise.resolve();
    }
    async stop() { this.stopped = true; await this.cancel(); }
  }
  if (typeof module !== 'undefined') module.exports = { PlaybackFade };
  root.LibertyPlaybackFade = PlaybackFade;
})(globalThis);
