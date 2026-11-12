(function (root) {
  function create(action, active) {
    const api = LibertyTheme, $ = id => document.getElementById(id), wheel = $('color-wheel'), target = $('palette-target');
    const saved = { accent: api.DEFAULT_COLOR, surface: api.DEFAULT_SURFACE_COLOR }, draft = { ...saved };
    let selected = target?.value === 'accent' ? 'accent' : 'surface', hsv = api.toHsv(draft[selected]), busy = false, invalid = false, effective = saved.accent;
    const presets = {
      surface: [['#e8edf3', 'Жемчужный'], ['#ffffff', 'Белый'], ['#dce8f7', 'Ледяной'], ['#e8def5', 'Лавандовый'], ['#f4dce8', 'Розовый'], ['#dfe9df', 'Шалфейный'], ['#f4ebdb', 'Шампань'], ['#202632', 'Графитовый']],
      accent: [['#ff3045', 'Красный'], ['#ff9f30', 'Оранжевый'], ['#22c55e', 'Зелёный'], ['#22d3ee', 'Голубой'], ['#438bff', 'Синий'], ['#a855f7', 'Фиолетовый'], ['#ec4899', 'Розовый'], ['#d4d4d8', 'Серый']]
    };
    const dirty = key => draft[key] !== saved[key];
    function preview() { api.apply(active() && dirty('accent') ? draft.accent : effective, active() && dirty('surface') ? draft.surface : saved.surface); }
    function render() {
      draft[selected] = api.fromHsv(hsv); invalid = false; preview();
      $('color-hex').value = draft[selected]; $('brightness').value = Math.round(hsv.v * 100); $('brightness-value').textContent = `${$('brightness').value}%`;
      $('brightness').style.setProperty('--progress', `${$('brightness').value}%`);
      const angle = hsv.h * Math.PI / 180;
      $('wheel-marker').style.left = `${50 + Math.cos(angle) * hsv.s * 48}%`; $('wheel-marker').style.top = `${50 + Math.sin(angle) * hsv.s * 48}%`;
      $('wheel-marker').style.backgroundColor = draft[selected];
      wheel.setAttribute('aria-valuenow', Math.min(359, Math.round(hsv.h))); wheel.setAttribute('aria-valuetext', draft[selected]);
      $('color-save').disabled = busy || !dirty(selected); $('color-cancel').disabled = busy || !dirty(selected);
      if (target) target.disabled = busy;
      $('color-status').textContent = dirty(selected) ? 'Предпросмотр. Примените цвет, чтобы обновить все окна и виджет.' : '';
      $('color-status').hidden = !dirty(selected); $('color-status').classList.remove('error');
    }
    function select(color) { hsv = api.toHsv(color); render(); }
    function renderPresets() {
      $('color-presets').replaceChildren();
      for (const [color, label] of presets[selected]) {
        const button = document.createElement('button'); button.type = 'button'; button.style.setProperty('--swatch', color); button.dataset.color = color; button.setAttribute('aria-label', label); button.addEventListener('click', () => select(color)); $('color-presets').append(button);
      }
    }
    target?.addEventListener('change', () => { selected = target.value === 'accent' ? 'accent' : 'surface'; renderPresets(); select(draft[selected]); });
    renderPresets();
    function pick(event) { const box = wheel.getBoundingClientRect(); Object.assign(hsv, api.fromPoint(event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2, box.width / 2)); render(); }
    wheel.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); wheel.focus(); wheel.setPointerCapture(event.pointerId); pick(event); });
    wheel.addEventListener('pointermove', event => { if (wheel.hasPointerCapture(event.pointerId)) pick(event); });
    wheel.addEventListener('pointerup', event => { if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId); });
    wheel.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft') hsv.h -= 2;
      if (event.key === 'ArrowRight') hsv.h += 2;
      if (event.key === 'ArrowUp') hsv.s = Math.min(1, hsv.s + .05);
      if (event.key === 'ArrowDown') hsv.s = Math.max(0, hsv.s - .05);
      render();
    });
    $('brightness').addEventListener('input', () => { hsv.v = Number($('brightness').value) / 100; render(); });
    $('color-hex').addEventListener('input', () => {
      try { select(api.normalizeColor($('color-hex').value)); }
      catch (error) { invalid = true; $('color-status').textContent = error.message; $('color-status').hidden = false; $('color-status').classList.add('error'); $('color-save').disabled = true; $('color-cancel').disabled = false; }
    });
    $('color-cancel').addEventListener('click', () => select(saved[selected]));
    $('color-save').addEventListener('click', async () => {
      if (busy || invalid || !dirty(selected)) return;
      const key = selected, color = draft[key]; busy = true; render();
      try {
        const result = await action('preferences', key === 'surface' ? { surfaceColor: color } : { color, colorMode: 'manual' });
        if (result.ok) saved[key] = color;
      } finally { busy = false; render(); }
    });
    return { update(state) {
      effective = state.effectiveColor || state.preferences.color;
      const incoming = { accent: state.preferences.color, surface: state.preferences.surfaceColor || api.DEFAULT_SURFACE_COLOR };
      let refresh = false;
      for (const key of ['accent', 'surface']) if (incoming[key] !== saved[key]) {
        const replace = !dirty(key) || draft[key] === incoming[key]; saved[key] = incoming[key];
        if (replace) { draft[key] = incoming[key]; if (key === selected) { hsv = api.toHsv(draft[key]); refresh = true; } }
      }
      if (refresh && !invalid) render(); else preview();
    }, leave() { Object.assign(draft, saved); select(saved[selected]); }, render };
  }
  root.LibertyControlTheme = { create };
})(globalThis);
