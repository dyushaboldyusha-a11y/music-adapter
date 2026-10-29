const SIZE = { width: 620, height: 270 };
const DEFAULT_PREFERENCES = { opacity: 1, scale: 1 };
function preferences(input = {}) {
  return { opacity: Number.isFinite(input.opacity) ? Math.max(.25, Math.min(1, input.opacity)) : 1, scale: Number.isFinite(input.scale) ? Math.max(.5, Math.min(1.75, input.scale)) : 1 };
}
function clampBounds(saved, displays, scale = 1) {
  const size = { width: Math.round(SIZE.width * scale), height: Math.round(SIZE.height * scale) };
  const area = (displays.find(d => saved && saved.x < d.workArea.x + d.workArea.width && saved.x + size.width > d.workArea.x && saved.y < d.workArea.y + d.workArea.height && saved.y + size.height > d.workArea.y) || displays[0]).workArea;
  const position = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: area.x + area.width - size.width - 24, y: area.y + 24 };
  return { ...size, x: Math.round(Math.max(area.x, Math.min(position.x, area.x + Math.max(0, area.width - size.width)))), y: Math.round(Math.max(area.y, Math.min(position.y, area.y + Math.max(0, area.height - size.height)))) };
}
function layoutForDisplays(saved, displays, requestedScale = 1) {
  const valid = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
  const requested = preferences({ scale: requestedScale }).scale;
  let display = displays[0], largestOverlap = 0;
  if (valid) for (const candidate of displays) {
    const area = candidate.workArea;
    const width = Math.max(0, Math.min(valid.x + SIZE.width * requested, area.x + area.width) - Math.max(valid.x, area.x));
    const height = Math.max(0, Math.min(valid.y + SIZE.height * requested, area.y + area.height) - Math.max(valid.y, area.y));
    if (width * height > largestOverlap) { display = candidate; largestOverlap = width * height; }
  }
  const scale = Math.min(requested, display.workArea.width / SIZE.width, display.workArea.height / SIZE.height);
  return { scale, bounds: clampBounds(valid, [display], scale) };
}
module.exports = { SIZE, DEFAULT_PREFERENCES, preferences, clampBounds, layoutForDisplays };
