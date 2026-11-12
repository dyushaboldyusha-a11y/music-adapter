(function (root) {
  const DEFAULT_COLOR = '#ff3045';
  const DEFAULT_SURFACE_COLOR = '#e8edf3';
  function normalizeColor(color) {
    if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) throw new Error('Введите цвет в формате #RRGGBB');
    return color.toLowerCase();
  }
  function toHsv(hex) {
    const color = normalizeColor(hex), [r, g, b] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    const hue = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return { h: hue * 60, s: max ? delta / max : 0, v: max };
  }
  function fromHsv({ h, s, v }) {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
    const c = v * s, x = c * (1 - Math.abs(h / 60 % 2 - 1)), m = v - c;
    const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + rgb.map(value => Math.round((value + m) * 255 + 1e-9).toString(16).padStart(2, '0')).join('');
  }
  function fromPoint(x, y, radius) { return { h: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360, s: Math.min(1, Math.hypot(x, y) / radius) }; }
  function channels(color) { return [1, 3, 5].map(index => parseInt(normalizeColor(color).slice(index, index + 2), 16)); }
  function mix(a, b, amount) {
    const one = channels(a), two = channels(b);
    return '#' + one.map((value, index) => Math.round(value * (1 - amount) + two[index] * amount).toString(16).padStart(2, '0')).join('');
  }
  function luminance(color) {
    const linear = channels(color).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  }
  function contrast(one, two) { const a = luminance(one), b = luminance(two); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }
  function foreground(color, whiteMix = 0) {
    const background = mix(color, '#ffffff', whiteMix);
    return contrast(background, '#000000') >= contrast(background, '#ffffff') ? '#000000' : '#ffffff';
  }
  function readable(color, backgrounds, toward) {
    for (let step = 0; step <= 20; step++) {
      const candidate = mix(color, toward, step / 20);
      if (backgrounds.every(background => contrast(candidate, background) >= 4.5)) return candidate;
    }
    return toward;
  }
  function rgba(color, alpha) { return `rgba(${channels(color).join(', ')}, ${alpha})`; }
  function palette(surfaceColor = DEFAULT_SURFACE_COLOR) {
    const surface = normalizeColor(surfaceColor), light = luminance(surface) >= .179;
    const app = mix(surface, light ? '#ffffff' : '#000000', light ? .12 : .08);
    const deep = !light && luminance(surface) < .06;
    const panel = mix(surface, light || deep ? '#ffffff' : '#000000', light ? .4 : deep ? .055 : .15);
    const strongest = light ? '#000000' : '#ffffff';
    const text = readable(light ? '#18212e' : '#f4f7fb', [app, panel], strongest);
    const muted = readable(mix(text, app, .35), [app, panel], strongest);
    return { appearance: light ? 'light' : 'dark', contrastBackgrounds: [app, panel], tokens: {
      '--surface-color': surface, '--app-bg': app,
      '--glass-bg': rgba(app, .94), '--glass-panel': rgba(panel, .9),
      '--glass-border': light ? 'rgba(255, 255, 255, .78)' : 'rgba(255, 255, 255, .16)',
      '--glass-highlight': light ? 'rgba(255, 255, 255, .88)' : 'rgba(255, 255, 255, .12)',
      '--text': text, '--ink': text, '--muted': muted,
      '--error-ink': readable(light ? '#a51c32' : '#ffb6c2', [app, panel], strongest),
      '--track-bg': rgba(text, light ? .13 : .18),
      '--shadow-color': light ? 'rgba(25, 35, 52, .13)' : 'rgba(0, 0, 0, .34)',
      '--bg': app, '--card': rgba(panel, .9),
      '--border': rgba(text, light ? .09 : .12)
    } };
  }
  function apply(color, surfaceColor = DEFAULT_SURFACE_COLOR) {
    const hsv = toHsv(color), min = hsv.v * (1 - hsv.s), lightness = (hsv.v + min) / 2;
    const saturation = lightness > 0 && lightness < 1 ? (hsv.v - min) / (1 - Math.abs(2 * lightness - 1)) : 0;
    const element = root.document.documentElement, style = element.style, glass = palette(surfaceColor);
    for (const [key, value] of Object.entries(glass.tokens)) style.setProperty(key, value);
    style.setProperty('--accent-ink', readable(color, glass.contrastBackgrounds, glass.appearance === 'light' ? '#000000' : '#ffffff'));
    style.setProperty('--red', normalizeColor(color)); style.setProperty('--theme-hue', hsv.h); style.setProperty('--theme-saturation', saturation);
    style.setProperty('--on-accent', foreground(color)); style.setProperty('--on-accent-hover', foreground(color, .14));
    style.colorScheme = glass.appearance; element.dataset.appearance = glass.appearance; element.dataset.surface = glass.appearance;
  }
  const api = { DEFAULT_COLOR, DEFAULT_SURFACE_COLOR, normalizeColor, toHsv, fromHsv, fromPoint, palette, contrast, apply };
  if (typeof module !== 'undefined') module.exports = api;
  root.LibertyTheme = api;
})(globalThis);
