(function (root) {
  function create(action) {
    const api = LibertyShortcuts, $ = id => document.getElementById(id);
    let saved = { ...api.DEFAULT_BINDINGS }, draft = { ...saved }, dirty = false, recording = null, busy = false, capturing = false;
    function message(text, error = false) { $('shortcut-status').textContent = text; $('shortcut-status').classList.toggle('error', error); }
    function render() {
      for (const key of Object.keys(api.ACTIONS)) {
        const button = $(`bind-${key}`); button.textContent = recording === key ? 'Нажмите сочетание…' : api.format(draft[key]); button.classList.toggle('recording', recording === key); button.setAttribute('aria-pressed', String(recording === key)); button.disabled = busy;
      }
      $('shortcut-save').disabled = busy || !!recording || !dirty; $('shortcut-cancel').disabled = busy || !dirty && !capturing;
    }
    for (const [key, label] of Object.entries(api.ACTIONS)) {
      const row = document.createElement('div'); row.className = 'shortcut-row';
      const name = document.createElement('span'); name.textContent = label; name.id = `label-${key}`;
      const button = document.createElement('button'); button.id = `bind-${key}`; button.className = 'shortcut-key'; button.setAttribute('aria-labelledby', name.id);
      button.addEventListener('click', async () => {
        busy = true; render(); const result = await action('capture', true); busy = false;
        if (result.ok) { capturing = true; recording = key; message('Нажмите клавишу или сочетание. Esc отменяет запись.'); }
        render();
      });
      row.append(name, button);
      if (key !== 'toggleInteraction') {
        const clear = document.createElement('button'); clear.className = 'shortcut-clear'; clear.textContent = '×'; clear.setAttribute('aria-label', `Отключить: ${label}`);
        clear.addEventListener('click', () => { draft[key] = ''; dirty = true; recording = null; message('Бинд отключён. Сохраните изменения.'); render(); }); row.append(clear);
      }
      $('shortcut-list').append(row);
    }
    $('shortcut-defaults').addEventListener('click', () => { draft = { ...api.DEFAULT_BINDINGS }; dirty = true; recording = null; message('Сочетания по умолчанию. Сохраните изменения.'); render(); });
    $('shortcut-cancel').addEventListener('click', async () => { recording = null; await action('capture', false); draft = { ...saved }; dirty = false; message('Изменения отменены.'); render(); });
    $('shortcut-save').addEventListener('click', async () => {
      try {
        const normalized = api.normalizeBindings(draft); busy = true; render();
        const result = await action('shortcuts', normalized);
        if (result.ok) { saved = { ...normalized }; draft = { ...saved }; dirty = false; message('Горячие клавиши сохранены.'); }
        else message(result.error, true);
      } catch (error) { message(error.message, true); }
      finally { busy = false; render(); }
    });
    document.addEventListener('keydown', event => {
      if (!recording) return;
      event.preventDefault(); event.stopImmediatePropagation(); if (event.repeat) return;
      if (event.key === 'Escape') { recording = null; message('Запись отменена. Сохраните или отмените изменения.'); render(); return; }
      try { const value = api.fromEvent(event); if (!value) return; draft[recording] = value; recording = null; dirty = true; message('Сочетание записано. Сохраните изменения.'); render(); }
      catch (error) { message(error.message, true); }
    }, true);
    render();
    return { update(state) {
      saved = { ...state.shortcuts.bindings };
      if (!dirty && !recording) draft = { ...saved };
      if (capturing && !state.controlCapture && recording) { recording = null; message('Запись остановлена. Вернитесь к нужному действию.'); }
      capturing = state.controlCapture; render();
    }, leave() { recording = null; action('capture', false); render(); } };
  }
  root.LibertyControlShortcuts = { create };
})(globalThis);
