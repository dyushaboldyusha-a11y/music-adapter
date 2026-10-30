(function (root) {
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  class PlaybackClock {
    constructor({ now = () => performance.now(), wallNow = () => Date.now(), extrapolateMs = 3000 } = {}) {
      this.now = now; this.wallNow = wallNow; this.extrapolateMs = extrapolateMs; this.reset();
    }
    reset() {
      this.key = null; this.streamKey = null; this.token = null; this.sequence = null; this.sampledAt = null; this.epoch = null;
      this.anchor = 0; this.at = this.now(); this.rate = 0; this.duration = 0; this.correction = 0; this.correctionMs = 2000; this.expires = this.at; this.pending = null; this.latest = null;
    }
    position() {
      const elapsedMs = Math.max(0, Math.min(this.now(), this.expires) - this.at);
      const value = this.anchor + elapsedMs / 1000 * this.rate + this.correction * Math.min(1, elapsedMs / this.correctionMs);
      return Math.max(0, Math.min(this.duration, value));
    }
    update(state, { force = false } = {}) {
      if (!state?.connected) { this.reset(); return; }
      const now = this.now();
      const streamKey = JSON.stringify([state.source?.id || 'default', state.sampleOrigin || 'legacy']);
      const sequence = Number.isSafeInteger(state.sampleSequence) && state.sampleSequence >= 0 ? state.sampleSequence : null;
      const sampledAt = Number.isFinite(state.sampledAt) && state.sampledAt > 0 ? state.sampledAt : null;
      // Check ordering before a title change resets the track anchor. A late
      // packet from the previous song must not restore that song's timestamp.
      if (!force && streamKey === this.streamKey && (sequence !== null && this.sequence !== null && sequence < this.sequence || sequence === null && sampledAt !== null && this.sampledAt !== null && sampledAt < this.sampledAt)) return;
      const key = JSON.stringify([state.source?.id || 'default', state.sampleOrigin || 'legacy', state.title, state.artist, state.album]);
      const changed = key !== this.key;
      if (changed) { this.reset(); this.key = key; }
      this.streamKey = streamKey;
      if (this.pending && now >= this.pending.expires) { this.pending = null; force = true; }
      const token = sequence !== null ? `seq:${sequence}` : sampledAt !== null ? `time:${sampledAt}` : JSON.stringify([state.position, state.playing, state.playbackRate, state.duration]);
      if (!force && (token === this.token || sequence !== null && this.sequence !== null && sequence < this.sequence || sequence === null && sampledAt !== null && this.sampledAt !== null && sampledAt < this.sampledAt)) return;
      this.token = token; this.sequence = sequence; this.sampledAt = sampledAt; this.latest = state;
      const duration = Math.max(0, finite(state.duration, 0));
      const rate = state.playing ? Math.max(0, Math.min(16, finite(state.playbackRate, 1))) : 0;
      const ageMs = sampledAt === null ? 0 : Math.max(0, Math.min(this.extrapolateMs, this.wallNow() - sampledAt));
      const incoming = Math.max(0, Math.min(duration, finite(state.position, 0) + ageMs / 1000 * rate));
      const current = Math.min(duration, this.position());
      if (this.pending) {
        const expected = this.pending.target + (now - this.pending.at) / 1000 * this.rate;
        if (sampledAt !== null && sampledAt < this.pending.wallAt || Math.abs(incoming - expected) > .9) return;
        this.pending = null;
      }
      const epoch = finite(state.timelineEpoch, 0);
      const discontinuity = this.epoch !== null && epoch !== this.epoch;
      const error = incoming - current;
      this.duration = duration;
      this.anchor = changed || force || discontinuity || Math.abs(error) > 1.5 ? incoming : current;
      this.at = now; this.rate = rate;
      // Correct small measurement drift by adjusting speed briefly. The slope
      // stays positive, so ordinary playback never oscillates backwards.
      this.correction = this.anchor === current && rate > 0 ? error : 0;
      this.correctionMs = Math.max(2000, Math.abs(this.correction) / Math.max(.001, rate * .5) * 1000);
      this.expires = now + Math.max(0, this.extrapolateMs - ageMs);
      this.epoch = epoch;
    }
    seek(position) {
      const now = this.now();
      const target = Math.max(0, Math.min(this.duration, position));
      this.pending = { target, at: now, wallAt: this.wallNow(), expires: now + 6000 };
      this.anchor = target; this.at = now; this.correction = 0; this.expires = now + 6000;
    }
    rejectSeek() { const state = this.latest; this.pending = null; if (state) this.update(state, { force: true }); }
  }
  if (typeof module !== 'undefined') module.exports = { PlaybackClock };
  root.LibertyPlaybackClock = PlaybackClock;
})(globalThis);
