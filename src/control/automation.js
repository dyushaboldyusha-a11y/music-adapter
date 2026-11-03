(function (root) {
  function create(action) {
    const $ = id => document.getElementById(id);
    const panel = document.createElement('div');
    panel.innerHTML = `<h3 class="section-title">Профили приложений и игр</h3>
      <div class="card personal-card"><label class="setting-row"><span><strong>Автоматические профили</strong><small>Настройки виджета переключаются по активному приложению Windows</small></span><input id="profiles-enabled" type="checkbox" class="switch"></label>
      <p id="profile-status" role="status" class="footnote"></p><div id="profile-list"></div>
      <form id="profile-form"><label for="profile-name">Название профиля</label><input id="profile-name" maxlength="60" required placeholder="Моя игра"><label for="profile-exe">Исполняемый файл</label><input id="profile-exe" maxlength="160" required placeholder="game.exe" spellcheck="false"><div class="button-row"><button class="primary">Сохранить текущий вид для приложения</button></div></form>
      <p class="footnote">Без подходящего профиля используются обычные настройки. Когда профиль активен, изменения оформления сохраняются в нём. Повторное сохранение заменяет профиль этого приложения.</p></div>
      <h3 class="section-title">Локальные голосовые команды</h3><div class="card personal-card"><label class="setting-row"><span><strong>Голос при удержании клавиши</strong><small>Назначьте «Голос» в разделе «Горячие клавиши»</small></span><input id="voice-enabled" type="checkbox" class="switch"></label>
      <p id="voice-status" role="status" aria-live="polite" class="footnote"></p>
      <p class="footnote">Микрофон работает только во время удержания, максимум 15 секунд. Одна команда на удержание. Звук не записывается и не отправляется в сеть. Нужен установленный локальный речевой пакет Windows: русский или английский.</p>
      <p class="footnote">Русский: «пауза», «продолжить», «следующий трек», «предыдущий трек», «громче», «тише», «выключить звук», «включить звук». Английский: pause, resume, next track, previous track, volume up, volume down, mute, unmute.</p></div>`;
    $('page-home').append(panel);
    let state, listKey = '';
    function save(items, enabled = state.appProfiles.enabled) { return action('profiles', { enabled, items }); }
    $('profiles-enabled').addEventListener('change', () => save(state.appProfiles.items, $('profiles-enabled').checked));
    $('voice-enabled').addEventListener('change', () => action('voice', $('voice-enabled').checked));
    $('profile-form').addEventListener('submit', async event => {
      event.preventDefault();
      const executable = $('profile-exe').value.trim().toLowerCase();
      const item = { name: $('profile-name').value, executable, preferences: state.preferences, positions: state.positions };
      const result = await save([...state.appProfiles.items.filter(p => p.executable !== executable), item]);
      if (result.ok) { $('profile-name').value = ''; $('profile-exe').value = ''; }
    });
    return { update(next) {
      state = next;
      const p = state.appProfiles, voice = state.automation;
      $('profiles-enabled').checked = p.enabled; $('profiles-enabled').disabled = !voice.supported;
      $('voice-enabled').checked = voice.enabled; $('voice-enabled').disabled = !voice.supported;
      $('profile-status').textContent = !voice.supported ? 'Переключение профилей доступно в Windows. Здесь можно подготовить профили.' : p.active ? `Активен: ${p.items.find(item => item.executable === p.active)?.name}` : `Обычные настройки${p.foreground ? ' · ' + p.foreground : ''}`;
      $('voice-status').textContent = !voice.supported ? 'Распознавание доступно в Windows.' : !voice.enabled ? 'Выключено' : voice.error || (voice.listening ? `Слушаю · ${voice.language}` : state.shortcuts.bindings.voiceHold ? 'Удерживайте назначенное сочетание и произнесите команду.' : 'Назначьте клавишу для голоса в разделе «Горячие клавиши».');
      const key = JSON.stringify(p.items.map(item => [item.executable, item.name]));
      if (key !== listKey) {
        listKey = key; $('profile-list').replaceChildren();
        for (const item of p.items) {
          const row = document.createElement('div'); row.className = 'setting-row';
          const text = document.createElement('span'); text.textContent = `${item.name} · ${item.executable}`;
          const remove = document.createElement('button'); remove.textContent = 'Удалить'; remove.setAttribute('aria-label', `Удалить профиль ${item.name}`);
          remove.addEventListener('click', () => save(state.appProfiles.items.filter(p => p.executable !== item.executable)));
          row.append(text, remove); $('profile-list').append(row);
        }
      }
    } };
  }
  root.LibertyAutomationControls = { create };
})(globalThis);
