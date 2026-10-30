const { DEFAULT_BINDINGS, ACTIONS, normalizeBindings, readBindings, format } = require('./shared/shortcuts.js');

class ShortcutManager {
  constructor(registry, handlers, saved) {
    this.registry = registry; this.handlers = handlers; this.bindings = readBindings(saved);
    this.registered = new Set(); this.lastActive = new Set(); this.suspended = false;
  }
  mapping(bindings = this.bindings) {
    const mapping = new Map(Object.entries(bindings).filter(([, key]) => key).map(([action, key]) => [key, action]));
    // Keep Num8 for existing users until they customize the control shortcut.
    if (bindings.toggleInteraction === DEFAULT_BINDINGS.toggleInteraction && !mapping.has('num8')) mapping.set('num8', 'toggleInteraction');
    return mapping;
  }
  register(key) {
    try { return this.registry.register(key, () => { if (!this.suspended) this.handlers[this.mapping().get(key)]?.(); }); }
    catch { return false; }
  }
  resume() {
    this.suspended = false;
    for (const key of this.mapping().keys()) if (!this.registered.has(key) && this.register(key)) this.registered.add(key);
    return this.snapshot();
  }
  suspend() {
    if (this.suspended) return;
    this.lastActive = new Set(this.registered);
    for (const key of this.registered) this.registry.unregister(key);
    this.registered.clear(); this.suspended = true;
  }
  configure(input) {
    const bindings = normalizeBindings(input), desired = this.mapping(bindings), added = [], active = new Set();
    for (const [key, action] of desired) {
      if (this.registered.has(key)) { active.add(key); continue; }
      if (!this.register(key)) {
        if (!Object.values(bindings).includes(key)) continue;
        for (const value of added) this.registry.unregister(value);
        throw new Error(`${ACTIONS[action]}: ${format(key)} занято другой программой или недоступно. Выберите другое сочетание`);
      }
      added.push(key); active.add(key);
    }
    for (const key of this.registered) if (!desired.has(key)) this.registry.unregister(key);
    this.bindings = bindings; this.registered = active; this.suspended = false;
    return this.snapshot();
  }
  snapshot() {
    const mapping = this.mapping(), keys = this.suspended ? this.lastActive : this.registered;
    const active = Object.fromEntries(Object.keys(ACTIONS).map(action => [action, [...keys].filter(key => mapping.get(key) === action)]));
    return { bindings: { ...this.bindings }, available: Object.fromEntries(Object.keys(ACTIONS).map(action => [action, active[action].length > 0])), active, suspended: this.suspended };
  }
  stop() { for (const key of this.registered) this.registry.unregister(key); this.registered.clear(); this.lastActive.clear(); }
}
module.exports = { ShortcutManager };
