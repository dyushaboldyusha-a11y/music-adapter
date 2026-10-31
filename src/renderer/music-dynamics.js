(function (root) {
  const clamp = value => Math.max(0, Math.min(1, value));
  class MusicDynamics {
    constructor() { this.reset(); }
    reset() {
      this.previous = 0; this.lastSample = null;
      this.averageOnset = 0; this.lastBeat = -Infinity; this.beat = 0;
      this.change = 0; this.changedAt = -Infinity;
      this.history = Array(16).fill(0); this.historyAt = null;
      this.available = false;
    }
    push(sample, now) {
      if (!sample?.available || !Number.isFinite(sample.level) || !Number.isFinite(now)) { this.reset(); return; }
      if (this.lastSample !== null && (now < this.lastSample || now - this.lastSample > 600)) this.reset();
      const elapsed = this.lastSample === null ? .033 : Math.max(.001, (now - this.lastSample) / 1000);
      const level = sample.level > .00001 ? clamp(sample.level) : 0;
      const delta = (level - this.previous) / Math.max(level, this.previous, .00001);
      // Relative change survives a constant gain adjustment: quiet and loud
      // copies of the same musical passage produce the same reaction.
      const change = level ? clamp((Math.abs(delta) - .025) * 2) : 0;
      const onset = level ? Math.max(0, delta) : 0;
      const threshold = Math.max(.12, this.averageOnset * 1.6);
      if (onset > threshold && now - this.lastBeat >= 180) { this.beat = clamp(onset); this.lastBeat = now; }
      this.averageOnset += (onset - this.averageOnset) * (1 - Math.exp(-elapsed / 1.2));
      this.change = change; this.changedAt = now;
      if (this.historyAt === null) this.historyAt = now;
      const steps = Math.min(16, Math.floor((now - this.historyAt) / 100));
      if (steps > 0) { this.history.splice(0, steps); this.history.push(...Array(steps).fill(0)); this.historyAt += steps * 100; }
      this.history[15] = Math.max(this.history[15], change);
      this.previous = level; this.lastSample = now; this.available = true;
    }
    read(now) {
      if (!this.available || !Number.isFinite(now) || now < this.lastSample || now - this.lastSample > 600) return { motion: 0, beat: 0, bars: Array(16).fill(0) };
      const motion = this.change * Math.exp(-(now - this.changedAt) / 130), beat = this.beat * Math.exp(-(now - this.lastBeat) / 170);
      return { motion: motion >= .001 ? motion : 0, beat: beat >= .001 ? beat : 0, bars: this.history.slice() };
    }
  }
  const api = { MusicDynamics };
  if (typeof module !== 'undefined') module.exports = api;
  root.LibertyMusicDynamics = api;
})(globalThis);
