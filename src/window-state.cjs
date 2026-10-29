const SIZE = { width: 620, height: 270 };
function clampBounds(saved, displays) {
  const area = (displays.find(d => saved && saved.x < d.workArea.x + d.workArea.width && saved.x + SIZE.width > d.workArea.x && saved.y < d.workArea.y + d.workArea.height && saved.y + SIZE.height > d.workArea.y) || displays[0]).workArea;
  const position = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: area.x + area.width - SIZE.width - 24, y: area.y + 24 };
  return { ...SIZE, x: Math.round(Math.max(area.x, Math.min(position.x, area.x + Math.max(0, area.width - SIZE.width)))), y: Math.round(Math.max(area.y, Math.min(position.y, area.y + Math.max(0, area.height - SIZE.height)))) };
}
module.exports = { SIZE, clampBounds };
