(function (root) {
  function create(action) {
    const $ = id => document.getElementById(id);
    let dirty = false, current;
    $('smooth-playback').addEventListener('change', () => action('preferences', { smoothPlayback: $('smooth-playback').checked }));
    $('discord-id').addEventListener('input', () => { dirty = true; });
    async function save(enabled) {
      const result = await action('discord', { enabled, applicationId: $('discord-id').value.trim() });
      if (result.ok) dirty = false;
      else $('discord-enabled').checked = current?.enabled === true;
    }
    $('discord-enabled').addEventListener('change', () => save($('discord-enabled').checked));
    $('discord-form').addEventListener('submit', event => { event.preventDefault(); save(current?.enabled === true); });
    $('discord-portal').addEventListener('click', () => action('discordPortal'));
    function update(state) {
      $('smooth-playback').checked = state.preferences.smoothPlayback === true;
      current = state.discord || { enabled: false, applicationId: '', phase: 'off' };
      $('discord-enabled').checked = current.enabled;
      if (!dirty && document.activeElement !== $('discord-id')) $('discord-id').value = current.applicationId;
      const labels = { off: 'Выключено. Музыкальный статус не передаётся.', 'missing-id': 'Укажите Application ID, чтобы подключить Discord.', connecting: 'Подключение к Discord…', waiting: 'Ожидание настольного Discord. Подключение повторится автоматически.', connected: state.connected ? 'Подключено. Изменения статуса могут занять до 15 секунд.' : 'Подключено. Ожидание музыки.', error: current.error };
      $('discord-status').textContent = labels[current.phase] || 'Ожидание подключения';
      $('discord-status').classList.toggle('error', current.phase === 'error');
    }
    return { update };
  }
  root.LibertyPlaybackControls = { create };
})(globalThis);
