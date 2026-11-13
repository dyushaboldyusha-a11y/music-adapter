const { DEFAULT_COLOR, DEFAULT_SURFACE_COLOR, normalizeColor, palette, contrast } = require('./shared/theme.js');

const THEME_TOKENS = Object.freeze([
  '--surface-color', '--app-bg', '--glass-bg', '--glass-panel', '--glass-border',
  '--glass-highlight', '--text', '--muted', '--track-bg', '--shadow-color',
  '--red', '--accent-ink', '--on-accent', '--on-accent-hover', '--error-ink'
]);
function mix(color, toward, amount) {
  return '#' + [1, 3, 5].map(index => Math.round(parseInt(color.slice(index, index + 2), 16) * (1 - amount) + parseInt(toward.slice(index, index + 2), 16) * amount).toString(16).padStart(2, '0')).join('');
}
function foreground(color) { return contrast(color, '#000000') >= contrast(color, '#ffffff') ? '#000000' : '#ffffff'; }
function extensionTheme(color = DEFAULT_COLOR, surfaceColor = DEFAULT_SURFACE_COLOR) {
  color = normalizeColor(color);
  const glass = palette(surfaceColor), toward = glass.appearance === 'light' ? '#000000' : '#ffffff';
  let accent = toward;
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, toward, step / 20);
    if (glass.contrastBackgrounds.every(background => contrast(candidate, background) >= 4.5)) { accent = candidate; break; }
  }
  const tokens = { ...glass.tokens, '--red': color, '--accent-ink': accent, '--on-accent': foreground(color), '--on-accent-hover': foreground(mix(color, '#ffffff', .14)) };
  return { appearance: glass.appearance, tokens: Object.fromEntries(THEME_TOKENS.map(name => [name, tokens[name]])) };
}

// This is also the serialization boundary: a future provider must not expose a
// whole settings/state object or values that refer to external resources.
function publicTheme(value) {
  if (!value || !['light', 'dark'].includes(value.appearance) || !value.tokens || typeof value.tokens !== 'object') return null;
  const tokens = {};
  for (const name of THEME_TOKENS) {
    const color = value.tokens[name];
    if (typeof color !== 'string' || color.length > 80 || !/^(?:#[a-f0-9]{6}|rgba?\([\d.,\s]+\))$/i.test(color)) return null;
    tokens[name] = color;
  }
  return { appearance: value.appearance, tokens };
}
module.exports = { extensionTheme, publicTheme, THEME_TOKENS };
