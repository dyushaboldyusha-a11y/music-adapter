const { preferences, DEFAULT_PREFERENCES } = require('./window-state.cjs');
const { validatePreferences } = require('./customization.cjs');

function executable(value) {
  if (typeof value !== 'string' || value.length > 160 || !/^[^\\/:*?"<>|\p{C}]+\.exe$/iu.test(value.trim())) throw new Error('Укажите имя приложения, например game.exe');
  return value.trim().toLowerCase();
}
function profile(input) {
  if (!input || typeof input !== 'object') throw new Error('Некорректный профиль');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || Array.from(name).length > 60 || /[\p{C}<>]/u.test(name)) throw new Error('Название профиля: от 1 до 60 символов');
  validatePreferences(input.preferences, DEFAULT_PREFERENCES);
  const positions = {};
  if (input.positions !== undefined) {
    if (!input.positions || typeof input.positions !== 'object' || Array.isArray(input.positions)) throw new Error('Некорректные положения профиля');
    for (const [key, bounds] of Object.entries(input.positions)) {
      if (!['bounds', 'compactBounds'].includes(key) || !bounds || ['x', 'y', 'width', 'height'].some(k => !Number.isFinite(bounds[k]) || Math.abs(bounds[k]) > 1000000) || bounds.width <= 0 || bounds.height <= 0) throw new Error('Некорректное положение профиля');
      positions[key] = Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, Math.round(bounds[k])]));
    }
  }
  return { executable: executable(input.executable), name, preferences: preferences(input.preferences), positions };
}
class AppProfiles {
  constructor(saved = {}) {
    this.enabled = saved?.enabled === true; this.items = []; this.foreground = ''; this.active = null;
    for (const item of Array.isArray(saved?.items) ? saved.items.slice(0, 50) : []) {
      try { const next = profile(item); if (!this.items.some(p => p.executable === next.executable)) this.items.push(next); } catch {}
    }
  }
  observe(name, ownExecutable) {
    // Opening our settings should let the user edit the current game's profile.
    if (name && ownExecutable && name.toLowerCase() === ownExecutable.toLowerCase()) return false;
    this.foreground = typeof name === 'string' ? name.toLowerCase() : '';
    const next = this.enabled ? this.items.find(p => p.executable === this.foreground) || null : null;
    const changed = next !== this.active; this.active = next; return changed;
  }
  configure(input) {
    if (!input || typeof input.enabled !== 'boolean' || !Array.isArray(input.items) || input.items.length > 50) throw new Error('Некорректные профили');
    const items = input.items.map(profile);
    if (new Set(items.map(p => p.executable)).size !== items.length) throw new Error('Для приложения уже есть профиль');
    this.enabled = input.enabled; this.items = items; this.observe(this.foreground);
  }
  effective(base) { return this.active ? { ...base, ...this.active.preferences, ...this.active.positions } : base; }
  edit(update, base) { Object.assign(this.active ? this.active.preferences : base, preferences({ ...preferences(this.effective(base)), ...update })); }
  setBounds(key, bounds, base) { (this.active ? this.active.positions : base)[key] = { ...bounds }; }
  saved() { return { enabled: this.enabled, items: this.items.map(p => ({ ...p, preferences: { ...p.preferences }, positions: structuredClone(p.positions) })) }; }
  snapshot() { return { ...this.saved(), foreground: this.foreground, active: this.active?.executable || null }; }
}
module.exports = { AppProfiles, executable };
