(function (root) {
  const { MusicDynamics } = typeof module !== 'undefined' ? require('./music-dynamics.js') : root.LibertyMusicDynamics;
  function ring(w, h, time, level, intensity) {
    const amplitude = Math.max(0, Math.min(1, level)) * Math.max(0, Math.min(1, intensity)) * 6;
    const a = Math.sin(time * 2.1) * amplitude, b = Math.cos(time * 1.7) * amplitude;
    const n = value => Number(value.toFixed(2));
    return `M36 ${n(9 + a)}C${n(w * .2)} ${n(9 - b)} ${n(w * .3)} ${n(9 + b)} ${n(w * .5)} 9S${n(w * .8)} ${n(9 - a)} ${w - 36} 9Q${w - 8} 7 ${w - 9} 36C${n(w - 9 + b)} ${n(h * .4)} ${n(w - 9 - a)} ${n(h * .6)} ${w - 9} ${h - 36}Q${w - 7} ${h - 7} ${w - 36} ${h - 9}C${n(w * .8)} ${n(h - 9 - b)} ${n(w * .7)} ${n(h - 9 + a)} ${n(w * .5)} ${h - 9}S${n(w * .2)} ${n(h - 9 + b)} 36 ${h - 9}Q7 ${h - 7} 9 ${h - 36}C${n(9 - a)} ${n(h * .6)} ${n(9 + b)} ${n(h * .4)} 9 36Q5 6 36 ${n(9 + a)}Z`;
  }
  function create() {
    const svg = document.querySelector('.edge-waves'), path = document.getElementById('edge-wave-ring');
    const mask = document.querySelector('#outside-frame'), rectangles = mask.querySelectorAll('rect');
    const glow = svg.querySelector('.wave-glow'), stroke = svg.querySelector('.edge-wave');
    const cover = document.getElementById('cover'), beatFrame = document.querySelector('.beat-frame'), rhythm = document.querySelector('.music-rhythm');
    const bars = Array.from({ length: 16 }, () => { const bar = document.createElement('i'); rhythm.append(bar); return bar; });
    const dynamics = new MusicDynamics(), barValues = Array(16).fill(0);
    let preferences = {}, source, energy = 0, music = 0, beat = 0, timer, visible = true, playing = true, phase = 0, width = 616, height = 234, previous, lastFrame = performance.now();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const smooth = (value, target, elapsed, attack, release) => {
      const next = value + (target - value) * (1 - Math.exp(-elapsed / (target > value ? attack : release)));
      return Math.abs(next - target) < .001 ? target : next;
    };
    const property = (element, key, value) => { if (element.style.getPropertyValue(key) !== value) element.style.setProperty(key, value); };
    function reset() {
      dynamics.reset(); energy = music = beat = 0; barValues.fill(0);
      property(cover, '--cover-scale', '1'); property(beatFrame, '--beat-strength', '0');
      bars.forEach(bar => { bar.style.transform = 'scaleY(0)'; });
    }
    function size() {
      const widget = document.getElementById('widget'); width = widget.clientWidth + 34; height = widget.clientHeight + 34;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      mask.setAttribute('width', width); mask.setAttribute('height', height);
      rectangles[0].setAttribute('width', width); rectangles[0].setAttribute('height', height);
      rectangles[1].setAttribute('width', width - 32); rectangles[1].setAttribute('height', height - 32);
      rectangles[1].setAttribute('rx', parseFloat(getComputedStyle(widget).borderTopLeftRadius) || 19);
      previous = null;
    }
    function frame() {
      clearTimeout(timer); timer = null;
      if (!visible || document.hidden) return;
      const mode = preferences.waveMode || 'audio', intensity = preferences.waveIntensity ?? .7;
      const now = performance.now(), elapsed = Math.max(.001, Math.min(.25, (now - lastFrame) / 1000)); lastFrame = now;
      const disabled = intensity === 0 || reduced.matches;
      const reaction = disabled ? { motion: 0, beat: 0, bars: Array(16).fill(0) } : dynamics.read(now);
      music = disabled ? 0 : smooth(music, reaction.motion, elapsed, .035, .12);
      beat = disabled ? 0 : smooth(beat, reaction.beat, elapsed, .02, .13);
      const target = disabled || mode === 'off' ? 0 : mode === 'ambient' ? .35 + .15 * Math.sin(now / 1000) : music;
      energy = disabled || mode === 'off' ? 0 : smooth(energy, target, elapsed, .035, .12);
      if (mode === 'ambient' || energy > 0) phase += elapsed * (1 + energy * 4);
      svg.toggleAttribute('hidden', mode === 'off' || intensity === 0);
      const d = ring(width, height, phase, energy, intensity);
      if (d !== previous) { path.setAttribute('d', d); previous = d; }
      property(stroke, 'opacity', String(.35 + energy * intensity * .65));
      property(glow, 'opacity', String(.15 + energy * intensity * .7));
      property(glow, 'stroke-width', `${3 + energy * intensity * 4}px`);
      property(cover, '--cover-scale', String(1 + (preferences.coverPulse ? music * intensity * .045 : 0)));
      beatFrame.hidden = !preferences.beatGlow || disabled;
      property(beatFrame, '--beat-strength', String(preferences.beatGlow ? beat * intensity : 0));
      rhythm.hidden = !preferences.rhythmBars || disabled;
      let barsMoving = false;
      for (let i = 0; i < bars.length; i++) {
        const next = preferences.rhythmBars && !disabled ? reaction.bars[i] * intensity : 0;
        barValues[i] = smooth(barValues[i], next, elapsed, .035, .09);
        barsMoving ||= Math.abs(barValues[i] - next) > .001;
        const transform = `scaleY(${Number(barValues[i].toFixed(3))})`;
        if (bars[i].style.transform !== transform) bars[i].style.transform = transform;
      }
      if (!disabled && (mode === 'ambient' || energy > 0 || music > 0 || beat > 0 || barsMoving)) timer = setTimeout(frame, preferences.waveEconomy ? 83 : 33);
    }
    new ResizeObserver(() => { size(); frame(); }).observe(document.getElementById('widget'));
    reduced.addEventListener('change', () => { reset(); frame(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = null; } else frame(); });
    return {
      update(value, options = {}) {
        if (source !== options.source || options.visible === false || options.playing === false) reset();
        source = options.source; preferences = value || {}; visible = options.visible !== false; playing = options.playing !== false; frame();
      },
      level(value) {
        const interested = (preferences.waveMode || 'audio') === 'audio' || preferences.coverPulse || preferences.rhythmBars || preferences.beatGlow;
        if (visible && playing && !reduced.matches && interested && (preferences.waveIntensity ?? .7) > 0) dynamics.push(value, performance.now());
        else dynamics.reset();
        if (!timer) frame();
      }
    };
  }
  const api = { ring, create };
  if (typeof module !== 'undefined') module.exports = api;
  root.LibertyAudioWave = api;
})(globalThis);
