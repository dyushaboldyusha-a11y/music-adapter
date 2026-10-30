(function (root) {
  function create(bridge) {
    const $ = id => document.getElementById(id), panel = $('wave');
    let current = {};
    for (const [id, key, convert] of [['wave-mode', 'waveMode', el => el.value], ['wave-intensity', 'waveIntensity', el => Number(el.value) / 100], ['wave-economy', 'waveEconomy', el => el.checked]]) {
      $(id).addEventListener('change', async event => {
        const result = await bridge.setPreferences({ [key]: convert(event.target) });
        if (!result.ok) console.warn(result.error);
      });
    }
    $('wave-intensity').addEventListener('input', () => { $('wave-intensity-value').textContent = `${$('wave-intensity').value}%`; });
    $('wave-close').addEventListener('click', () => bridge.closeWave());
    document.addEventListener('keydown', event => {
      if (panel.hidden) return;
      if (event.key === 'Escape') { event.stopImmediatePropagation(); event.preventDefault(); bridge.closeWave(); }
      if (event.key === 'Tab') {
        const elements = [...panel.querySelectorAll('input,select,button')], index = elements.indexOf(document.activeElement);
        event.preventDefault(); elements[(index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length]?.focus();
      }
    }, true);
    return { update(state) {
      const opening = panel.hidden && state.waveEditing;
      panel.hidden = !state.waveEditing;
      current = state.preferences || {};
      if (panel.hidden) return;
      $('wave-mode').value = current.waveMode || 'audio';
      $('wave-intensity').value = Math.round((current.waveIntensity ?? .7) * 100);
      $('wave-intensity-value').textContent = `${$('wave-intensity').value}%`;
      $('wave-intensity').style.setProperty('--progress', `${$('wave-intensity').value}%`);
      $('wave-economy').checked = current.waveEconomy === true;
      $('wave-source').textContent = state.platform === 'win32' && !state.demo ? 'Реакция на все звуки устройства вывода Windows. Микрофон не используется.' : 'Реакция на звук доступна в Windows. Здесь можно выбрать плавную волну.';
      if (opening) $('wave-mode').focus();
    }, isOpen: () => !panel.hidden };
  }
  root.LibertyWaveSettings = { create };
})(globalThis);
