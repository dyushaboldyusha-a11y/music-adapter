(function (root) {
  function create(bridge) {
    const api = root.LibertyTheme, $ = id => document.getElementById(id), panel = $('theme');
    const wheel = $('color-wheel');
    let hsv, draft, invalid = false, busy = false;
    function render() {
      draft = api.fromHsv(hsv); api.apply(draft);
      $('theme-hex').value = draft; $('theme-brightness').value = Math.round(hsv.v * 100);
      $('theme-brightness-value').textContent = `${Math.round(hsv.v * 100)}%`;
      const radians = hsv.h * Math.PI / 180;
      $('wheel-marker').style.left = `${50 + Math.cos(radians) * hsv.s * 48}%`;
      $('wheel-marker').style.top = `${50 + Math.sin(radians) * hsv.s * 48}%`;
      $('wheel-marker').style.backgroundColor = draft;
      wheel.setAttribute('aria-valuenow', Math.min(359, Math.round(hsv.h))); wheel.setAttribute('aria-valuetext', draft);
      $('theme-status').textContent = 'Предпросмотр. Сохраните понравившийся цвет';
      $('theme-save').disabled = busy; invalid = false;
    }
    function select(hex) { hsv = api.toHsv(hex); render(); }
    function update(state) {
      if (state.themeEditing && panel.hidden) {
        $('pairing').hidden = true; panel.hidden = false; busy = false;
        select(state.preferences.color); wheel.focus();
      } else if (!state.themeEditing && !panel.hidden) panel.hidden = true;
      api.apply(panel.hidden ? state.preferences?.color || api.DEFAULT_COLOR : draft);
    }
    function pick(event) {
      const rect = wheel.getBoundingClientRect();
      Object.assign(hsv, api.fromPoint(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2, rect.width / 2)); render();
    }
    wheel.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); wheel.focus(); wheel.setPointerCapture(event.pointerId); pick(event); });
    wheel.addEventListener('pointermove', event => { if (wheel.hasPointerCapture(event.pointerId)) pick(event); });
    wheel.addEventListener('pointerup', event => { if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId); });
    wheel.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'ArrowLeft') hsv.h = (hsv.h + 358) % 360;
      if (event.key === 'ArrowRight') hsv.h = (hsv.h + 2) % 360;
      if (event.key === 'ArrowUp') hsv.s = Math.min(1, hsv.s + .05);
      if (event.key === 'ArrowDown') hsv.s = Math.max(0, hsv.s - .05);
      render();
    });
    $('theme-brightness').addEventListener('input', () => { hsv.v = Number($('theme-brightness').value) / 100; render(); });
    $('theme-hex').addEventListener('input', () => {
      try { select(api.normalizeColor($('theme-hex').value)); }
      catch (error) { invalid = true; $('theme-status').textContent = error.message; $('theme-save').disabled = true; }
    });
    for (const button of panel.querySelectorAll('[data-color]')) button.addEventListener('click', () => select(button.dataset.color));
    $('theme-default').addEventListener('click', () => select(api.DEFAULT_COLOR));
    $('theme-cancel').addEventListener('click', () => bridge.cancelTheme());
    $('theme-save').addEventListener('click', async () => {
      if (invalid || busy) return;
      busy = true; $('theme-save').disabled = true;
      try { const result = await bridge.saveTheme(draft); if (!result.ok) $('theme-status').textContent = result.error; }
      finally { busy = false; if (!panel.hidden) $('theme-save').disabled = invalid; }
    });
    document.addEventListener('keydown', event => {
      if (panel.hidden) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); bridge.cancelTheme(); }
      if (event.key === 'Tab') {
        const controls = [...panel.querySelectorAll('button:not(:disabled),input,[tabindex="0"]')];
        const index = controls.indexOf(document.activeElement);
        if (event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus(); }
      }
    });
    return { update, isOpen: () => !panel.hidden };
  }
  root.LibertyThemeSettings = { create };
})(globalThis);
