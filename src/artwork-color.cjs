const { fromHsv, toHsv } = require('./shared/theme.js');
function artworkColor(bitmap, fallback) {
  const buckets = new Map();
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const [b, g, r, a] = bitmap.subarray(i, i + 4), max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (a < 160 || max < 35 || min > 235 || (max - min) / max < .1) continue;
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4), bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0, weight: 0 };
    bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b; bucket.weight += .5 + (max - min) / max; buckets.set(key, bucket);
  }
  const winner = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!winner) return fallback;
  const hex = '#' + ['r', 'g', 'b'].map(key => Math.round(winner[key] / winner.count).toString(16).padStart(2, '0')).join('');
  const hsv = toHsv(hex); return fromHsv({ ...hsv, v: Math.max(.65, hsv.v), s: Math.max(.35, hsv.s) });
}
module.exports = { artworkColor };
