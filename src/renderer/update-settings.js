(function (root) {
  function create(bridge) {
    const $ = id => document.getElementById(id), panel = $('updates');
    function update(state) {
      const wasHidden = panel.hidden; panel.hidden = !state.updateEditing;
      if (panel.hidden) return;
      $('pairing').hidden = true;
      const value = state.updates || {}, phase = value.phase || 'idle';
      $('installed-version').textContent = `Установлено: ${value.currentVersion || '—'}`;
      const messages = { idle: 'Нажмите «Проверить», чтобы найти новую версию на GitHub.', checking: 'Проверяю последнюю версию…', current: 'У вас последняя версия Liberty Wave.', available: `Доступна версия ${value.version}. Скачайте её, чтобы обновить приложение.`, downloading: `Скачивание: ${Math.round(value.downloaded / Math.max(1, value.total) * 100)}%`, ready: 'Файл проверен. Можно установить обновление и перезапустить виджет.', installing: 'Устанавливаю обновление. Виджет сейчас перезапустится…', error: value.error || 'Не удалось обновить приложение' };
      $('update-status').textContent = messages[phase] || messages.idle;
      $('update-status').classList.toggle('error', phase === 'error');
      $('update-progress').hidden = phase !== 'downloading';
      $('update-progress').value = value.downloaded || 0; $('update-progress').max = value.total || 1;
      $('update-check').hidden = ['downloading', 'installing', 'ready'].includes(phase);
      $('update-check').disabled = phase === 'checking';
      $('update-download').hidden = !value.version || value.ready || ['checking', 'downloading', 'installing'].includes(phase);
      $('update-install').hidden = !value.ready || phase === 'installing';
      $('update-install').disabled = !value.supported;
      $('update-cancel-download').hidden = phase !== 'downloading';
      $('update-detail').textContent = value.ready && !value.supported ? 'Установка из приложения доступна в переносимой Windows-сборке.' : 'Бинды, тема и подключения сохранятся. Музыкальный плеер продолжит работать.';
      if (wasHidden) $('update-close').focus();
    }
    for (const [id, action] of [['update-check', 'check'], ['update-download', 'download'], ['update-install', 'install'], ['update-cancel-download', 'cancel']]) $(id).addEventListener('click', async () => {
      const result = await bridge.updateAction(action);
      if (!result.ok) { $('update-status').textContent = result.error; $('update-status').classList.add('error'); }
    });
    $('update-close').addEventListener('click', () => bridge.closeUpdates());
    document.addEventListener('keydown', event => {
      if (panel.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); bridge.closeUpdates(); }
      if (event.key === 'Tab') {
        const buttons = [...panel.querySelectorAll('button:not(:disabled):not([hidden])')];
        const index = buttons.indexOf(document.activeElement);
        if (event.shiftKey && index === 0 || !event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[event.shiftKey ? buttons.length - 1 : 0].focus(); }
      }
    });
    return { update, isOpen: () => !panel.hidden };
  }
  root.LibertyUpdateSettings = { create };
})(globalThis);
