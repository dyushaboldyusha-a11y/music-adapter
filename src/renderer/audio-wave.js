(function (root) {
  const { MusicDynamics } = typeof module !== 'undefined' ? require('./music-dynamics.js') : root.LibertyMusicDynamics;
  function ring(w, h, time, level, intensity, geometry = {}) {
    const unit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
    w = Math.max(0, number(w, 0)); h = Math.max(0, number(h, 0));
    const inset = Math.min(12, Math.max(0, w / 2), Math.max(0, h / 2));
    const x = number(geometry.x, inset), y = number(geometry.y, inset);
    const width = Math.max(0, number(geometry.width, w - inset * 2));
    const height = Math.max(0, number(geometry.height, h - inset * 2));
    const radius = Math.max(0, Math.min(number(geometry.radius, 28), width / 2, height / 2));
    const gap = Math.max(0, number(geometry.gap, 2)), outerRadius = radius + gap;
    const amplitude = unit(level) * unit(intensity) * 3, phase = number(time, 0) * 2.1;
    const n = value => Number(value.toFixed(3)), point = p => `${n(p[0])} ${n(p[1])}`;
    const commands = [`M${point([x + radius, y - gap])}`];
    const cubic = (a, b, end) => commands.push(`C${point(a)} ${point(b)} ${point(end)}`);

    // Wave only the straight sides. A zero slope at each end joins the
    // concentric corner arcs without changing their radius or tangent.
    function side(start, end, normal, sidePhase) {
      const segments = 8, step = 1 / segments, delta = [end[0] - start[0], end[1] - start[1]];
      function sample(u) {
        const sine = Math.sin(Math.PI * u), angle = phase + sidePhase + Math.PI * 2 * u;
        const envelope = sine * sine, carrier = .55 + .45 * Math.sin(angle);
        const offset = u === 0 || u === 1 ? 0 : amplitude * envelope * carrier;
        const slope = amplitude * (Math.PI * 2 * sine * Math.cos(Math.PI * u) * carrier + envelope * .45 * Math.PI * 2 * Math.cos(angle));
        // Keep both Bezier handles in the outward strip, including near the
        // endpoints where unrestricted interpolation could cross the card.
        const limit = 3 * Math.max(0, Math.min(offset, amplitude - offset)) / step;
        const derivative = Math.max(-limit, Math.min(limit, slope));
        return {
          p: [start[0] + delta[0] * u + normal[0] * offset, start[1] + delta[1] * u + normal[1] * offset],
          d: [delta[0] + normal[0] * derivative, delta[1] + normal[1] * derivative]
        };
      }
      let a = sample(0);
      for (let i = 1; i <= segments; i++) {
        const b = sample(i / segments);
        cubic(a.p.map((value, axis) => value + a.d[axis] * step / 3), b.p.map((value, axis) => value - b.d[axis] * step / 3), b.p);
        a = b;
      }
    }
    const right = x + width, bottom = y + height, handle = outerRadius * 4 * (Math.SQRT2 - 1) / 3;
    side([x + radius, y - gap], [right - radius, y - gap], [0, -1], 0);
    cubic([right - radius + handle, y - gap], [right + gap, y + radius - handle], [right + gap, y + radius]);
    side([right + gap, y + radius], [right + gap, bottom - radius], [1, 0], 1.7);
    cubic([right + gap, bottom - radius + handle], [right - radius + handle, bottom + gap], [right - radius, bottom + gap]);
    side([right - radius, bottom + gap], [x + radius, bottom + gap], [0, 1], 3.2);
    cubic([x + radius - handle, bottom + gap], [x - gap, bottom - radius + handle], [x - gap, bottom - radius]);
    side([x - gap, bottom - radius], [x - gap, y + radius], [-1, 0], 4.9);
    cubic([x - gap, y + radius - handle], [x + radius - handle, y - gap], [x + radius, y - gap]);
    return `${commands.join('')}Z`;
  }
  function create() {
    const svg = document.querySelector('.edge-waves'), path = document.getElementById('edge-wave-ring');
    const mask = document.querySelector('#outside-frame'), rectangles = mask.querySelectorAll('rect');
    const glow = svg.querySelector('.wave-glow'), stroke = svg.querySelector('.edge-wave');
    const cover = document.getElementById('cover'), beatFrame = document.querySelector('.beat-frame'), rhythm = document.querySelector('.music-rhythm');
    const bars = Array.from({ length: 16 }, () => { const bar = document.createElement('i'); rhythm.append(bar); return bar; });
    const dynamics = new MusicDynamics(), barValues = Array(16).fill(0);
    let preferences = {}, source, energy = 0, music = 0, beat = 0, timer, visible = true, playing = true, phase = 0, width = 616, height = 234, geometry, previous, lastFrame = performance.now();
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
      const widget = document.getElementById('widget'), bounds = widget.getBoundingClientRect(), viewport = svg.getBoundingClientRect();
      // A disabled wave has display:none. Preserve valid geometry until it is
      // visible again, rather than replacing the viewBox with a zero size.
      if (!viewport.width || !viewport.height) return;
      const next = { x: bounds.left - viewport.left, y: bounds.top - viewport.top, width: bounds.width, height: bounds.height, radius: parseFloat(getComputedStyle(widget).borderTopLeftRadius) || 0 };
      if (width === viewport.width && height === viewport.height && geometry && Object.keys(next).every(key => geometry[key] === next[key])) return;
      width = viewport.width; height = viewport.height;
      geometry = next;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      mask.setAttribute('width', width); mask.setAttribute('height', height);
      rectangles[0].setAttribute('width', width); rectangles[0].setAttribute('height', height);
      for (const key of ['x', 'y', 'width', 'height']) rectangles[1].setAttribute(key, geometry[key]);
      rectangles[1].setAttribute('rx', geometry.radius); rectangles[1].setAttribute('ry', geometry.radius);
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
      const hidden = mode === 'off' || intensity === 0, wasHidden = svg.hasAttribute('hidden');
      svg.toggleAttribute('hidden', hidden);
      if (!hidden && (wasHidden || !geometry)) size();
      const d = ring(width, height, phase, energy, intensity, geometry);
      if (d !== previous) { path.setAttribute('d', d); previous = d; }
      property(stroke, 'opacity', String(.35 + energy * intensity * .65));
      property(glow, 'opacity', String(.15 + energy * intensity * .7));
      property(glow, 'stroke-width', `${3 + energy * intensity * 2.4}px`);
      property(cover, '--cover-scale', String(1 + (preferences.coverPulse ? music * intensity * .045 : 0)));
      beatFrame.hidden = !preferences.beatGlow || disabled;
      property(beatFrame, '--beat-strength', String(preferences.beatGlow ? beat * intensity : 0));
      rhythm.hidden = !preferences.rhythmBars || disabled;
      let barsMoving = false;
      for (let i = 0; i < bars.length; i++) {
        const next = preferences.rhythmBars && !disabled ? reaction.bars[i] * intensity : 0;
        // A media-query change can be observed before its change event reaches
        // a background window. Disabled motion must settle in this frame too.
        barValues[i] = disabled ? 0 : smooth(barValues[i], next, elapsed, .035, .09);
        barsMoving ||= Math.abs(barValues[i] - next) > .001;
        const transform = `scaleY(${Number(barValues[i].toFixed(3))})`;
        if (bars[i].style.transform !== transform) bars[i].style.transform = transform;
      }
      if (!disabled && (mode === 'ambient' || energy > 0 || music > 0 || beat > 0 || barsMoving)) timer = setTimeout(frame, preferences.waveEconomy ? 83 : 33);
    }
    size();
    new ResizeObserver(() => { size(); frame(); }).observe(document.getElementById('widget'));
    reduced.addEventListener('change', () => { reset(); frame(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = null; } else frame(); });
    return {
      update(value, options = {}) {
        if (source !== options.source || options.visible === false || options.playing === false) reset();
        source = options.source; preferences = value || {}; visible = options.visible !== false; playing = options.playing !== false; size(); frame();
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
