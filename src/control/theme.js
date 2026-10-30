(function (root) {
  function create(action, active) {
    const api = LibertyTheme, $ = id => document.getElementById(id), wheel = $('color-wheel');
    let saved = api.DEFAULT_COLOR, draft = saved, hsv = api.toHsv(saved), dirty = false, busy = false;
    const presets = [['#ff3045', 'Красный'], ['#ff9f30', 'Оранжевый'], ['#22c55e', 'Зелёный'], ['#22d3ee', 'Голубой'], ['#438bff', 'Синий'], ['#a855f7', 'Фиолетовый'], ['#ec4899', 'Розовый'], ['#d4d4d8', 'Серый']];
    function render() {
      draft = api.fromHsv(hsv); dirty = draft !== saved;
      api.apply(active() ? draft : saved);
      $('color-hex').value = draft; $('brightness').value = Math.round(hsv.v * 100); $('brightness-value').textContent = `${$('brightness').value}%`;
      const angle = hsv.h * Math.PI / 180;
      $('wheel-marker').style.left = `${50 + Math.cos(angle) * hsv.s * 48}%`; $('wheel-marker').style.top = `${50 + Math.sin(angle) * hsv.s * 48}%`;
      $('wheel-marker').style.backgroundColor = draft;
      wheel.setAttribute('aria-valuenow', Math.min(359, Math.round(hsv.h))); wheel.setAttribute('aria-valuetext', draft);
      $('color-save').disabled = busy || !dirty; $('color-cancel').disabled = busy || !dirty;
      $('color-status').textContent = dirty ? 'Предпросмотр. Примените цвет, чтобы изменить виджет.' : 'Цвет применяется к виджету и окну Liberty Wave.';
      $('color-status').classList.remove('error');
    }
    function select(color) { hsv = api.toHsv(color); render(); }
    for (const [color, label] of presets) {
      const button = document.createElement('button'); button.style.setProperty('--swatch', color); button.dataset.color = color; button.setAttribute('aria-label', label); button.addEventListener('click', () => select(color)); $('color-presets').append(button);
    }
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
      catch (error) { $('color-status').textContent = error.message; $('color-status').classList.add('error'); $('color-save').disabled = true; $('color-cancel').disabled = false; }
    });
    $('color-cancel').addEventListener('click', () => select(saved));
    $('color-save').addEventListener('click', async () => {
      if (busy) return; busy = true; render();
      try { const result = await action('preferences', { color: draft }); if (result.ok) { saved = draft; render(); } }
      finally { busy = false; render(); }
    });
    return { update(state) {
      const color = state.preferences.color;
      if (color !== saved) { saved = color; if (!dirty || draft === color) select(saved); }
      api.apply(active() ? draft : saved);
    }, leave() { select(saved); }, render };
  }
  root.LibertyControlTheme = { create };
})(globalThis);
