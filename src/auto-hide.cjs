class AutoHide {
  constructor(change, { now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) { Object.assign(this, { change, now, schedule, cancel }); this.hidden = false; this.idleAt = null; }
  update({ autoHide, autoHideDelay, playing, interaction }) {
    this.cancel(this.timer);
    if (!autoHide || playing || interaction) { this.idleAt = null; this.set(false); return; }
    if (this.idleAt === null) this.idleAt = this.now();
    const wait = Math.max(0, this.idleAt + autoHideDelay * 1000 - this.now());
    if (!wait) this.set(true);
    else this.timer = this.schedule(() => this.set(true), wait);
  }
  set(hidden) { if (this.hidden !== hidden) { this.hidden = hidden; this.change(hidden); } }
  dispose() { this.cancel(this.timer); }
}
module.exports = { AutoHide };
