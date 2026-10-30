(function (root) {
  const DEFAULT_COLOR = '#ff3045';
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
  function apply(color) {
    const hsv = toHsv(color), min = hsv.v * (1 - hsv.s), lightness = (hsv.v + min) / 2;
    const saturation = lightness > 0 && lightness < 1 ? (hsv.v - min) / (1 - Math.abs(2 * lightness - 1)) : 0;
    const style = root.document.documentElement.style;
    style.setProperty('--red', normalizeColor(color)); style.setProperty('--theme-hue', hsv.h); style.setProperty('--theme-saturation', saturation);
  }
  const api = { DEFAULT_COLOR, normalizeColor, toHsv, fromHsv, fromPoint, apply };
  if (typeof module !== 'undefined') module.exports = api;
  root.LibertyTheme = api;
})(globalThis);
