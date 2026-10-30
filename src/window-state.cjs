const SIZE = { width: 620, height: 270 };
const COMPACT_SIZE = { width: 500, height: 144 };
const { DEFAULT_COLOR, normalizeColor } = require('./shared/theme.js');
const DEFAULT_PREFERENCES = { opacity: 1, scale: 1, color: DEFAULT_COLOR, compact: false, waveMode: 'audio', waveIntensity: .7, waveEconomy: false };
function preferences(input = {}) {
  let color = DEFAULT_COLOR;
  try { if (input.color !== undefined) color = normalizeColor(input.color); } catch {}
  return { opacity: Number.isFinite(input.opacity) ? Math.max(.25, Math.min(1, input.opacity)) : 1, scale: Number.isFinite(input.scale) ? Math.max(.5, Math.min(1.75, input.scale)) : 1, color, compact: input.compact === true, waveMode: ['audio', 'ambient', 'off'].includes(input.waveMode) ? input.waveMode : 'audio', waveIntensity: Number.isFinite(input.waveIntensity) ? Math.max(0, Math.min(1, input.waveIntensity)) : .7, waveEconomy: input.waveEconomy === true };
}
function clampBounds(saved, displays, scale = 1, baseSize = SIZE) {
  const size = { width: Math.round(baseSize.width * scale), height: Math.round(baseSize.height * scale) };
  const area = (displays.find(d => saved && saved.x < d.workArea.x + d.workArea.width && saved.x + size.width > d.workArea.x && saved.y < d.workArea.y + d.workArea.height && saved.y + size.height > d.workArea.y) || displays[0]).workArea;
  const position = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: area.x + area.width - size.width - 24, y: area.y + 24 };
  return { ...size, x: Math.round(Math.max(area.x, Math.min(position.x, area.x + Math.max(0, area.width - size.width)))), y: Math.round(Math.max(area.y, Math.min(position.y, area.y + Math.max(0, area.height - size.height)))) };
}
function layoutForDisplays(saved, displays, requestedScale = 1, baseSize = SIZE) {
  const valid = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
  const requested = preferences({ scale: requestedScale }).scale;
  let display = displays[0], largestOverlap = 0;
  if (valid) for (const candidate of displays) {
    const area = candidate.workArea;
    const width = Math.max(0, Math.min(valid.x + baseSize.width * requested, area.x + area.width) - Math.max(valid.x, area.x));
    const height = Math.max(0, Math.min(valid.y + baseSize.height * requested, area.y + area.height) - Math.max(valid.y, area.y));
    if (width * height > largestOverlap) { display = candidate; largestOverlap = width * height; }
  }
  const scale = Math.min(requested, display.workArea.width / baseSize.width, display.workArea.height / baseSize.height);
  return { scale, bounds: clampBounds(valid, [display], scale, baseSize) };
}
module.exports = { SIZE, COMPACT_SIZE, DEFAULT_PREFERENCES, preferences, clampBounds, layoutForDisplays };
