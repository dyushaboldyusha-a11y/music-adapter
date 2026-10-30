const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PlaybackClock } = require('../src/renderer/playback-clock.js');
function setup() {
  let time = 0;
  const epoch = 1700000000000;
  const clock = new PlaybackClock({ now: () => time, wallNow: () => epoch + time });
  const state = (sequence, position, changes = {}) => ({ connected: true, source: { id: 'web:client:1' }, title: 'Track', artist: 'Artist', album: 'Album', duration: 300, playing: true, position, playbackRate: 1, sampledAt: epoch + time, sampleOrigin: 'page-1', sampleSequence: sequence, timelineEpoch: 0, ...changes });
  return { clock, state, advance: ms => { time += ms; }, epoch };
}
test('cached heartbeats and settings snapshots do not rewind the clock', () => {
  const { clock, state, advance } = setup(); const packet = state(1, 84); clock.update(packet);
  for (let i = 1; i <= 10; i++) { advance(200); clock.update({ ...packet, preferences: { opacity: .25 } }); assert.ok(Math.abs(clock.position() - (84 + i * .2)) < .001); }
});
test('delayed measurements compensate transport time and reject out-of-order packets', () => {
  const { clock, state, advance } = setup(); const old = state(1, 84); clock.update(old);
  advance(1000); const delayed = state(2, 85); advance(800); clock.update(delayed);
  assert.ok(Math.abs(clock.position() - 85.8) < .001);
  clock.update(old); assert.ok(Math.abs(clock.position() - 85.8) < .001);
});
test('small position noise is corrected without moving time backwards', () => {
  const { clock, state, advance } = setup(); clock.update(state(0, 100)); let previous = 100;
  for (let i = 1; i <= 100; i++) {
    advance(100);
    if (i % 5 === 0) clock.update(state(i, 100 + i / 10 + (i % 10 === 0 ? -.35 : .35)));
    const position = clock.position(); assert.ok(position >= previous - .000001, `Backward jump: ${previous} -> ${position}`); previous = position;
  }
  assert.ok(Math.abs(clock.position() - 110) < .7);
});
test('pause freezes time and resume uses the actual playback rate', () => {
  const { clock, state, advance } = setup(); clock.update(state(1, 20, { playbackRate: 2 })); advance(1000);
  assert.equal(clock.position(), 22);
  clock.update(state(2, 22, { playing: false, playbackRate: 2 })); advance(30000); assert.equal(clock.position(), 22);
  clock.update(state(3, 22, { playbackRate: 2 })); advance(500); assert.equal(clock.position(), 23);
});
test('real backward seeks and loop restarts are allowed', () => {
  const { clock, state, advance } = setup(); clock.update(state(1, 100)); advance(500);
  clock.update(state(2, 100, { timelineEpoch: 1 })); assert.equal(clock.position(), 100);
  clock.update(state(3, 20, { timelineEpoch: 2 })); assert.equal(clock.position(), 20);
  clock.update(state(4, 0, { timelineEpoch: 3 })); assert.equal(clock.position(), 0);
});
test('a pending widget seek ignores the previous position until confirmation', () => {
  const { clock, state, advance } = setup(); clock.update(state(1, 100)); clock.seek(30);
  advance(100); clock.update(state(2, 100.1)); assert.ok(Math.abs(clock.position() - 30.1) < .001);
  advance(200); clock.update(state(3, 30.3)); advance(500); assert.ok(Math.abs(clock.position() - 30.8) < .001);
});
test('a refused seek restores the authoritative paused position', () => {
  const { clock, state } = setup(); clock.update(state(1, 100, { playing: false })); clock.seek(30); assert.equal(clock.position(), 30);
  clock.rejectSeek(); assert.equal(clock.position(), 100);
});
test('new tracks reset the position and new sources can restart their sample sequence', () => {
  const { clock, state } = setup(); clock.update(state(100, 100));
  clock.update(state(101, 5, { title: 'Next track' })); assert.equal(clock.position(), 5);
  clock.update(state(0, 20, { source: { id: 'native:spotify' }, sampleOrigin: 'native-2' })); assert.equal(clock.position(), 20);
});
test('a late packet from the previous song cannot restore its timestamp', () => {
  const { clock, state } = setup(); const old = state(10, 200);
  clock.update(old); clock.update(state(11, 2, { title: 'New song' }));
  clock.update(old); assert.equal(clock.position(), 2);
});
test('lost measurements stop extrapolating instead of drifting indefinitely', () => {
  const { clock, state, advance } = setup(); const sample = state(1, 100); clock.update(sample); advance(20000); clock.update(sample);
  assert.equal(clock.position(), 103);
});
test('legacy extensions without sample IDs still deduplicate repeated positions', () => {
  const { clock, state, advance } = setup(); const packet = state(null, 50, { sampledAt: null, sampleOrigin: '' }); clock.update(packet);
  advance(700); clock.update(packet); advance(700); clock.update(packet); assert.ok(Math.abs(clock.position() - 51.4) < .001);
});
