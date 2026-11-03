(function (root) {
  function create(action) {
    const $ = id => document.getElementById(id);
    const panel = document.createElement('div');
    panel.innerHTML = `<h3 class="section-title">Профили приложений и игр</h3>
      <div class="card personal-card"><label class="setting-row"><span><strong>Автоматические профили</strong><small>Настройки виджета переключаются по активному приложению Windows</small></span><input id="profiles-enabled" type="checkbox" class="switch"></label>
      <p id="profile-status" role="status" class="footnote"></p><div id="profile-list"></div>
      <form id="profile-form"><label for="profile-name">Название профиля</label><input id="profile-name" type="text" maxlength="60" required placeholder="Моя игра"><label for="profile-exe">Исполняемый файл</label><input id="profile-exe" type="text" maxlength="160" required placeholder="game.exe" spellcheck="false"><div class="button-row"><button class="primary">Сохранить текущий вид для приложения</button></div></form>
      <p class="footnote">Без подходящего профиля используются обычные настройки. Когда профиль активен, изменения оформления сохраняются в нём. Повторное сохранение заменяет профиль этого приложения.</p></div>
      <h3 class="section-title">Локальные голосовые команды</h3><div class="card personal-card"><label class="setting-row"><span><strong>Голос при удержании клавиши</strong><small>Назначьте «Голос» в разделе «Горячие клавиши»</small></span><input id="voice-enabled" type="checkbox" class="switch"></label>
      <label for="voice-microphone">Микрофон</label><div class="microphone-controls"><select id="voice-microphone" aria-label="Микрофон для голосовых команд"></select><button id="microphone-refresh" type="button">Обновить</button><button id="microphone-test" type="button">Проверить микрофон</button></div>
      <progress id="microphone-level" class="microphone-level" max="1" value="0" aria-label="Уровень сигнала микрофона"></progress><p id="microphone-status" class="footnote" role="status">Проверка длится 3 секунды. Произнесите команду; музыка останется без изменений.</p>
      <p id="voice-status" role="status" aria-live="polite" class="footnote"></p>
      <p class="footnote">Удерживайте клавишу, произнесите команду и отпустите. Микрофон закрывается при отпускании; распознавание завершает обработку фразы. Одна команда на удержание, максимум 15 секунд. Звук не сохраняется и не отправляется в сеть.</p>
      <p class="footnote">Русский и английский распознаватели уже встроены. Язык команды определяется автоматически; интернет и SAPI не нужны.</p>
      <details id="voice-commands" class="voice-command-list"><summary>Команды и синонимы · русский / English</summary><p class="footnote">Можно добавить «пожалуйста» или please в начале или конце команды. Стоп / stop ставит музыку на паузу.</p><div id="voice-command-groups"></div></details></div>`;
    $('page-home').append(panel);
    let state, listKey = '', microphoneKey = '', commandKey = '';
    function save(items, enabled = state.appProfiles.enabled) { return action('profiles', { enabled, items }); }
    $('profiles-enabled').addEventListener('change', () => save(state.appProfiles.items, $('profiles-enabled').checked));
    $('voice-enabled').addEventListener('change', () => action('voice', $('voice-enabled').checked));
    $('voice-microphone').addEventListener('change', () => action('microphone', $('voice-microphone').value));
    $('microphone-refresh').addEventListener('click', () => action('microphoneRefresh'));
    $('microphone-test').addEventListener('click', () => action('microphoneTest', !(state.automation.test && state.automation.listening)));
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
      const busy = voice.listening || voice.phase === 'processing';
      const micKey = JSON.stringify([voice.microphones, voice.microphone]);
      if (micKey !== microphoneKey) {
        microphoneKey = micKey;
        const devices = voice.microphones?.length ? voice.microphones : [{ id: 'default', name: 'Системный микрофон (по умолчанию)' }];
        const options = devices.map(microphone => new Option(microphone.name, microphone.id));
        if (!devices.some(microphone => microphone.id === voice.microphone)) options.push(new Option('Выбранный микрофон отключён', voice.microphone));
        $('voice-microphone').replaceChildren(...options); $('voice-microphone').value = voice.microphone || 'default';
      }
      $('voice-microphone').disabled = !voice.supported || busy;
      $('microphone-refresh').disabled = !voice.supported || busy;
      $('microphone-test').disabled = !voice.supported || voice.phase === 'processing' || voice.listening && !voice.test;
      $('microphone-test').textContent = voice.test && voice.listening ? 'Остановить проверку' : 'Проверить микрофон';
      $('microphone-level').value = voice.level || 0;
      $('microphone-status').textContent = voice.test && voice.listening ? 'Проверка: говорите в выбранный микрофон…' : voice.test && voice.phase === 'processing' ? 'Микрофон закрыт. Распознаю тестовую фразу…' : voice.test && ['tested', 'recognized'].includes(voice.phase) ? (voice.peak > .01 ? 'Сигнал получен.' : 'Сигнал не обнаружен. Проверьте устройство и разрешения Windows.') + (voice.heard ? ` Распознано: «${voice.heard}».` : '') + ' Команды плееру не отправлялись.' : 'Проверка длится 3 секунды. Произнесите команду; музыка останется без изменений.';
      $('voice-status').textContent = !voice.supported ? 'Распознавание доступно в Windows.' : voice.error || (!voice.enabled ? 'Голосовое управление выключено. Микрофон можно проверить отдельно.' : !state.shortcuts.bindings.voiceHold ? 'Назначьте клавишу для голоса в разделе «Горячие клавиши».' : !state.shortcuts.available.voiceHold ? 'Голосовое сочетание занято или недоступно. Назначьте другое.' : voice.listening ? `Слушаю · ${voice.language}` : voice.phase === 'processing' ? 'Микрофон закрыт. Распознаю команду…' : voice.heard ? `Распознано: «${voice.heard}».` : `Удерживайте назначенное сочетание и произнесите команду. Язык: ${voice.language || 'проверяется'}.`);
      const commands = state.voiceCommands || [], commandsKey = JSON.stringify(commands);
      if (commandsKey !== commandKey) {
        commandKey = commandsKey; $('voice-command-groups').replaceChildren();
        for (const command of commands) {
          const row = document.createElement('div'); row.className = 'voice-command-group';
          const label = document.createElement('strong'); label.textContent = command.label;
          const russian = document.createElement('p'); russian.lang = 'ru'; russian.textContent = command.ru.join(' · ');
          const english = document.createElement('p'); english.lang = 'en'; english.textContent = command.en.join(' · ');
          row.append(label, russian, english); $('voice-command-groups').append(row);
        }
      }
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
