const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MusicDynamics } = require('../src/renderer/music-dynamics.js');
const { preferences, DEFAULT_PREFERENCES, widgetSize } = require('../src/window-state.cjs');
const { validatePreferences, exportSettings, importSettings } = require('../src/customization.cjs');
const { DEFAULT_BINDINGS } = require('../src/shared/shortcuts.js');
const sample = (analyser, level, time) => { analyser.push({ available: true, level }, time); return analyser.read(time); };

test('a steady loud or quiet signal settles instead of sustaining fake musical motion', () => {
  for (const level of [.8, .008]) {
    const analyser = new MusicDynamics();
    assert.ok(sample(analyser, level, 0).motion > 0);
    let value;
    for (let time = 33; time <= 2500; time += 33) value = sample(analyser, level, time);
    assert.equal(value.motion, 0); assert.equal(value.beat, 0); assert.ok(value.bars.every(value => value === 0));
  }
});
test('the same changes at different playback levels produce the same motion and beats', () => {
  const loud = new MusicDynamics(), quiet = new MusicDynamics();
  const passage = [.02, .02, .3, .18, .04, .04, .4, .1, .05, .2];
  passage.forEach((level, index) => {
    const a = sample(loud, level, index * 100), b = sample(quiet, level / 100, index * 100);
    assert.ok(Math.abs(a.motion - b.motion) < 1e-10); assert.ok(Math.abs(a.beat - b.beat) < 1e-10);
    a.bars.forEach((value, i) => assert.ok(Math.abs(value - b.bars[i]) < 1e-10));
  });
});
test('frame beats follow attacks with a cooldown and do not trigger on a drop or silence', () => {
  const analyser = new MusicDynamics();
  sample(analyser, .1, 0); sample(analyser, .4, 80);
  assert.equal(analyser.lastBeat, 0, 'Do not count every sample of one attack as a new beat');
  sample(analyser, .05, 220); assert.equal(analyser.lastBeat, 0);
  assert.ok(sample(analyser, .5, 300).beat > .8); assert.equal(analyser.lastBeat, 300);
  sample(analyser, 0, 350); assert.equal(analyser.lastBeat, 300);
  assert.equal(analyser.read(1800).beat, 0);
});
test('rhythm bars contain recent real changes, stay bounded, and become empty on a steady passage', () => {
  const analyser = new MusicDynamics();
  sample(analyser, .01, 0); sample(analyser, .01, 100); sample(analyser, .05, 200);
  const hit = analyser.read(200); assert.equal(hit.bars.length, 16); assert.ok(hit.bars.some(value => value > .5));
  for (let time = 300; time <= 2400; time += 100) {
    const value = sample(analyser, .05, time);
    assert.ok(value.bars.length === 16 && value.bars.every(value => value >= 0 && value <= 1));
  }
  assert.ok(analyser.read(2400).bars.every(value => value === 0));
});
test('pause, a closed source, missing samples and resets cannot retain another song reaction', () => {
  const analyser = new MusicDynamics(); sample(analyser, .8, 0);
  analyser.push({ available: false, level: 1 }, 50);
  assert.deepEqual(analyser.read(50), { motion: 0, beat: 0, bars: Array(16).fill(0) });
  sample(analyser, .2, 100); assert.equal(analyser.read(800).motion, 0);
  analyser.reset(); assert.equal(analyser.read(900).beat, 0);
  assert.ok(analyser.read(900).bars.every(value => value === 0));
});
test('invalid samples and tiny noise never create NaN transforms or a false beat', () => {
  const analyser = new MusicDynamics();
  for (const level of [NaN, Infinity, '1', null, -2, 0, .000001]) {
    const value = sample(analyser, level, 100);
    assert.equal(value.motion, 0); assert.equal(value.beat, 0); assert.ok(value.bars.every(value => value === 0));
  }
  sample(analyser, .4, 200); assert.equal(analyser.read(NaN).motion, 0);
});
test('new effect preferences migrate, validate and export without changing old profiles', () => {
  const old = preferences({ color: '#ffffff' });
  for (const key of ['coverPulse', 'rhythmBars', 'beatGlow']) { assert.equal(old[key], false); assert.throws(() => validatePreferences({ [key]: 1 }, DEFAULT_PREFERENCES)); }
  const saved = { ...preferences({ coverPulse: true, rhythmBars: true, beatGlow: true }), shortcuts: DEFAULT_BINDINGS };
  const imported = importSettings(JSON.stringify(exportSettings(saved, preferences)), preferences, DEFAULT_PREFERENCES);
  for (const key of ['coverPulse', 'rhythmBars', 'beatGlow']) assert.equal(imported[key], true);
  assert.deepEqual(widgetSize({ rhythmBars: true }), { width: 620, height: 300 });
  assert.deepEqual(widgetSize({ compact: true, rhythmBars: true }), { width: 500, height: 164 });
  assert.deepEqual(widgetSize(old), { width: 620, height: 270 });
});
