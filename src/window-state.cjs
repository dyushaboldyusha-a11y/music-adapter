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
module.exports = { SIZE, DEFAULT_PREFERENCES, preferences, clampBounds };
