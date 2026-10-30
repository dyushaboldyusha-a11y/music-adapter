(function (root) {
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
    let preferences = {}, meter = {}, received = 0, energy = 0, timer, width = 616, height = 234, previous, lastFrame = performance.now() / 1000;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
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
      clearTimeout(timer);
      const mode = preferences.waveMode || 'audio', intensity = preferences.waveIntensity ?? .7;
      const disabled = mode === 'off' || intensity === 0;
      svg.toggleAttribute('hidden', disabled);
      const now = performance.now() / 1000;
      const elapsed = Math.max(.001, Math.min(.25, now - lastFrame)); lastFrame = now;
      const fresh = meter.available && Date.now() - received < 600;
      const target = reduced.matches || disabled ? 0 : mode === 'ambient' ? .35 + .15 * Math.sin(now) : fresh ? Math.sqrt(meter.level || 0) : 0;
      if (disabled || reduced.matches) energy = 0;
      else energy += (target - energy) * (1 - Math.exp(-elapsed / (target > energy ? .045 : .16)));
      if (energy < .001) energy = 0;
      const d = ring(width, height, now, energy, intensity);
      if (d !== previous) { path.setAttribute('d', d); previous = d; }
      stroke.style.opacity = String(.35 + energy * intensity * .65);
      glow.style.opacity = String(.15 + energy * intensity * .7);
      glow.style.strokeWidth = `${3 + energy * intensity * 4}px`;
      // No animation work when disabled or reduced motion is requested.
      if (!disabled && !reduced.matches) timer = setTimeout(frame, preferences.waveEconomy ? 83 : 33);
    }
    new ResizeObserver(() => { size(); frame(); }).observe(document.getElementById('widget'));
    reduced.addEventListener('change', frame);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else frame(); });
    return { update(value) { preferences = value || {}; frame(); }, level(value) { meter = value || {}; received = Date.now(); } };
  }
  const api = { ring, create };
  if (typeof module !== 'undefined') module.exports = api;
  root.LibertyAudioWave = api;
})(globalThis);
