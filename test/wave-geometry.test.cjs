const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ring } = require('../src/renderer/audio-wave.js');

function curves(path) {
  const tokens = path.match(/[MCZ]|-?\d+(?:\.\d+)?/g);
  assert.equal(tokens.shift(), 'M');
  let position = [Number(tokens.shift()), Number(tokens.shift())];
  const start = position, segments = [];
  while (tokens[0] === 'C') {
    tokens.shift();
    const points = Array.from({ length: 3 }, () => [Number(tokens.shift()), Number(tokens.shift())]);
    segments.push([position, ...points]); position = points[2];
  }
  assert.deepEqual(tokens, ['Z']);
  assert.deepEqual(position, start, 'the contour closes without a diagonal closing segment');
  return segments;
}

function point(curve, t) {
  const a = 1 - t, weights = [a ** 3, 3 * a * a * t, 3 * a * t * t, t ** 3];
  return [0, 1].map(axis => curve.reduce((sum, p, index) => sum + p[axis] * weights[index], 0));
}

// Signed Euclidean distance to the widget's rounded border, independent of
// the SVG's control points and sampling scheme.
function distance([px, py], { x, y, width, height, radius }) {
  const dx = Math.abs(px - x - width / 2) - width / 2 + radius;
  const dy = Math.abs(py - y - height / 2) - height / 2 + radius;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

const layouts = [
  ['full', { x: 12, y: 12, width: 584, height: 202, radius: 28 }],
  ['compact', { x: 12, y: 12, width: 464, height: 80, radius: 26 }],
  ['full with rhythm bars', { x: 12, y: 12, width: 584, height: 232, radius: 28 }],
  ['compact with rhythm bars', { x: 12, y: 12, width: 464, height: 100, radius: 26 }],
  ['fractional bounds', { x: 11.75, y: 12.125, width: 423.5, height: 137.25, radius: 19.5 }],
  ['smaller card', { x: 12, y: 12, width: 292, height: 101, radius: 14 }]
];

for (const [name, geometry] of layouts) {
  test(`wave follows the ${name} rounded border with a uniform resting gap`, () => {
    const width = geometry.x * 2 + geometry.width, height = geometry.y * 2 + geometry.height;
    const idle = ring(width, height, 0, 0, 1, geometry);
    assert.equal(ring(width, height, 100, 0, 1, geometry), idle);
    for (const curve of curves(idle)) for (let i = 0; i <= 30; i++) {
      const gap = distance(point(curve, i / 30), geometry);
      assert.ok(Math.abs(gap - 2) < .02, `resting gap ${gap} must stay at 2px, including the corners`);
    }
  });

  test(`active ${name} wave stays outside and close to the card, with smooth joins`, () => {
    const width = geometry.x * 2 + geometry.width, height = geometry.y * 2 + geometry.height;
    let furthest = 0;
    for (const time of [0, .7, 2.3, 8]) {
      const segments = curves(ring(width, height, time, 1, 1, geometry));
      for (const [index, curve] of segments.entries()) {
        for (let i = 0; i <= 30; i++) {
          const p = point(curve, i / 30), gap = distance(p, geometry);
          assert.ok(gap >= 1.98 && gap <= 5.02, `animated gap ${gap} must stay within 2–5px`);
          assert.ok(p[0] >= 0 && p[0] <= width && p[1] >= 0 && p[1] <= height, 'the SVG viewport must contain the entire contour');
          furthest = Math.max(furthest, gap);
        }
        const next = segments[(index + 1) % segments.length];
        const incoming = curve[3].map((value, axis) => value - curve[2][axis]);
        const outgoing = next[1].map((value, axis) => value - next[0][axis]);
        const magnitude = Math.hypot(...incoming) * Math.hypot(...outgoing);
        const cross = incoming[0] * outgoing[1] - incoming[1] * outgoing[0];
        assert.ok(magnitude > 0 && Math.abs(cross) / magnitude < .005, 'adjacent curves must have the same tangent');
        assert.ok(incoming[0] * outgoing[0] + incoming[1] * outgoing[1] > 0, 'tangents must continue in the same direction');
      }
    }
    assert.ok(furthest > 4, 'music must visibly move the contour');
  });
}

test('wave corners keep the card radius as the straight sides move', () => {
  const geometry = layouts[0][1], idle = curves(ring(608, 226, 0, 0, 1, geometry));
  const active = curves(ring(608, 226, 1.5, 1, 1, geometry));
  assert.notDeepEqual(active, idle);
  for (const index of [8, 17, 26, 35]) assert.deepEqual(active[index], idle[index], 'rounded corners must not tilt or stretch with the wave');
});

test('legacy callers retain silence and intensity clamping', () => {
  const idle = ring(616, 234, 0, 0, 1);
  assert.equal(ring(616, 234, 9, 1, 0), idle);
  assert.equal(ring(616, 234, 9, -1, 1), idle);
  assert.equal(ring(616, 234, 9, NaN, 1), idle);
  assert.equal(ring(616, 234, 9, 2, 2), ring(616, 234, 9, 1, 1));
});
