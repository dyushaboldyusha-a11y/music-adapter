(function (root) {
  function create(bridge) {
    const api = root.LibertyShortcuts, panel = document.getElementById('shortcuts');
    const $ = id => document.getElementById(id);
    let draft, recording = null, busy = false;
    function message(text, error = false) { $('shortcut-status').textContent = text; $('shortcut-status').classList.toggle('error', error); }
    function render() {
      for (const action of Object.keys(api.ACTIONS)) {
        const button = $(`bind-${action}`);
        button.textContent = recording === action ? 'Нажмите сочетание…' : api.format(draft[action]);
        button.classList.toggle('recording', recording === action);
        button.setAttribute('aria-pressed', String(recording === action));
        button.disabled = busy;
      }
      $('shortcut-save').disabled = busy || !!recording;
      $('shortcut-defaults').disabled = busy;
      for (const action of Object.keys(api.ACTIONS).filter(action => action !== 'toggleInteraction')) $(`shortcut-clear-${action}`).disabled = busy;
    }
    function update(state) {
      if (state.shortcutEditing && panel.hidden) {
        draft = { ...state.shortcuts.bindings }; recording = null; busy = false;
        $('pairing').hidden = true; panel.hidden = false;
        const unavailable = Object.keys(api.ACTIONS).filter(action => draft[action] && !state.shortcuts.available[action]);
        message(unavailable.length ? `${unavailable.map(action => api.ACTIONS[action]).join(', ')}: сочетание недоступно. Назначьте другое` : 'Нажмите на сочетание и задайте своё', unavailable.length > 0);
        render(); $('bind-toggleInteraction').focus();
      } else if (!state.shortcutEditing && !panel.hidden) {
        panel.hidden = true; recording = null; busy = false;
      }
    }
    for (const action of Object.keys(api.ACTIONS)) $(`bind-${action}`).addEventListener('click', () => {
      recording = action; message('Нажмите клавишу или сочетание. Esc — отменить запись'); render();
    });
    for (const action of Object.keys(api.ACTIONS).filter(action => action !== 'toggleInteraction')) $(`shortcut-clear-${action}`).addEventListener('click', () => { recording = null; draft[action] = ''; message('Бинд отключён. Сохраните изменения'); render(); });
    $('shortcut-defaults').addEventListener('click', () => { recording = null; draft = { ...api.DEFAULT_BINDINGS }; message('Сочетания по умолчанию. Сохраните изменения'); render(); });
    $('shortcut-cancel').addEventListener('click', () => bridge.cancelShortcuts());
    $('shortcut-save').addEventListener('click', async () => {
      try {
        const bindings = api.normalizeBindings(draft);
        busy = true; render();
        const result = await bridge.saveShortcuts(bindings);
        if (!result.ok) message(result.error || 'Не удалось сохранить сочетания', true);
      } catch (error) { message(error.message, true); }
      finally { busy = false; if (!panel.hidden) render(); }
    });
    document.addEventListener('keydown', event => {
      if (panel.hidden) return;
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (recording) { recording = null; message('Запись отменена'); render(); }
        else bridge.cancelShortcuts();
        return;
      }
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        recording = null; render();
        const buttons = [...panel.querySelectorAll('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement);
        event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus(); return;
      }
      if (!recording || busy) return;
      event.preventDefault();
      if (event.repeat) return;
      try {
        const value = api.fromEvent(event);
        if (!value) return;
        draft[recording] = value; recording = null;
        message('Сочетание записано. Сохраните изменения'); render();
      } catch (error) { message(error.message, true); }
    }, true);
    return { update, isOpen: () => !panel.hidden };
  }
  root.LibertyShortcutSettings = { create };
})(globalThis);
