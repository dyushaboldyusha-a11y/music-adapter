const $ = id => document.getElementById(id), bridge = window.libertyControl;
let state, page = 'home', noticeTimer, currentArtwork, sourceKey = '', seeking = false;
const editingRanges = new Set(), clock = new LibertyPlaybackClock();
const theme = LibertyControlTheme.create(action, () => page === 'appearance');
const shortcuts = LibertyControlShortcuts.create(action);
const personalization = LibertyPersonalization.create(action);
const services = [['yandex', 'Яндекс Музыка', 'Я', '#ffcc33'], ['spotify', 'Spotify', 'S', '#3cd980'], ['soundcloud', 'SoundCloud', '☁', '#ff9445'], ['youtube', 'YouTube', '▶', '#ff626b'], ['vk', 'VK Музыка', 'VK', '#68a5ff']];
const time = value => { const s = Math.floor(Math.max(0, value || 0)); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function message(text, error = false) { clearTimeout(noticeTimer); $('notice').textContent = text; $('notice').hidden = !text; $('notice').classList.toggle('error', error); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, error ? 9000 : 3500); }
async function action(name, value) {
  try { const result = await bridge.action(name, value); if (!result?.ok) message(result?.error || 'Не удалось выполнить действие', true); return result || { ok: false }; }
  catch { message('Соединение с приложением прервано', true); return { ok: false }; }
}
function navigate(next) {
  if (!['home', 'sources', 'appearance', 'shortcuts', 'updates'].includes(next)) return;
  if (page !== next) { shortcuts.leave(); theme.leave(); }
  page = next;
  for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== `page-${page}`;
  for (const button of document.querySelectorAll('nav button')) button.setAttribute('aria-current', button.dataset.page === page ? 'page' : 'false');
  $('content').scrollTop = 0; if (page === 'appearance') theme.render();
}
for (const button of document.querySelectorAll('[data-page],[data-go]')) button.addEventListener('click', () => navigate(button.dataset.page || button.dataset.go));
for (const name of ['minimize', 'maximize', 'close']) $(`window-${name}`).addEventListener('click', () => action('window', name));
$('quit').addEventListener('click', () => action('quit'));
function sourceName(source) { return source ? `${source.name} · ${source.kind === 'app' ? 'приложение' : source.browser || 'браузер'}` : 'Источник не выбран'; }
for (const [id, label, icon, color] of services) {
  const row = document.createElement('div'); row.className = 'service-row';
  const mark = document.createElement('span'); mark.className = 'service-icon'; mark.style.setProperty('--service-color', color); mark.textContent = icon;
  const info = document.createElement('div'), name = document.createElement('strong'), status = document.createElement('p'); name.textContent = label; status.id = `service-${id}`; info.append(name, status);
  const buttons = document.createElement('div'); buttons.className = 'service-buttons';
  for (const nativeApp of id === 'yandex' || id === 'spotify' ? [true, false] : [false]) {
    const button = document.createElement('button'); button.textContent = nativeApp ? 'Приложение' : 'В браузере'; button.setAttribute('aria-label', `Открыть ${label} ${nativeApp ? 'в приложении' : 'в браузере'}`); button.addEventListener('click', () => action('openMusic', { provider: id, nativeApp })); buttons.append(button);
  }
  row.append(mark, info, buttons); $('services').append(row);
}
function progress(id) { const element = $(id); element.style.setProperty('--progress', `${(Number(element.value) - Number(element.min)) / (Number(element.max) - Number(element.min)) * 100}%`); }
function setRange(id, value) { if (!editingRanges.has(id)) { $(id).value = value; progress(id); } }
const preferences = [['opacity', 'opacity', value => value / 100], ['scale', 'scale', value => value / 100], ['wave-intensity', 'waveIntensity', value => value / 100]];
for (const [id, key, convert] of preferences) {
  $(id).addEventListener('input', () => { editingRanges.add(id); $(`${id}-value`).textContent = `${$(id).value}%`; progress(id); });
  $(id).addEventListener('change', async () => { const value = convert(Number($(id).value)); editingRanges.delete(id); await action('preferences', { [key]: value }); });
  $(id).addEventListener('pointercancel', () => { editingRanges.delete(id); bridge.getState().then(update); });
}
$('compact').addEventListener('change', () => action('preferences', { compact: $('compact').checked }));
$('interaction').addEventListener('change', () => action('interaction', $('interaction').checked));
$('restore').addEventListener('click', () => action('restore'));
$('wave-mode').addEventListener('change', () => action('preferences', { waveMode: $('wave-mode').value }));
$('wave-economy').addEventListener('change', () => action('preferences', { waveEconomy: $('wave-economy').checked }));
for (const id of ['source', 'home-source']) $(id).addEventListener('change', () => action('source', $(id).value));
for (const [id, command] of [['play-pause', 'playPause'], ['next', 'next'], ['previous', 'previous']]) $(id).addEventListener('click', () => action('command', { command }));
$('mute').addEventListener('click', () => action('command', { command: 'mute', value: !state.muted }));
$('volume').addEventListener('input', () => { editingRanges.add('volume'); $('volume-value').textContent = `${$('volume').value}%`; progress('volume'); });
$('volume').addEventListener('change', async () => { const value = Number($('volume').value) / 100; editingRanges.delete('volume'); await action('command', { command: 'volume', value }); });
$('seek').addEventListener('input', () => { seeking = true; progress('seek'); $('elapsed').textContent = time(Number($('seek').value)); });
$('seek').addEventListener('change', async () => { const value = Number($('seek').value); seeking = false; clock.seek(value); const result = await action('command', { command: 'seek', value }); if (!result.ok) clock.rejectSeek(); });
$('seek').addEventListener('pointercancel', () => { seeking = false; });
$('pair-browser').addEventListener('click', () => action('pair'));
$('copy-code').addEventListener('click', async () => { const result = await action('copyPair'); if (result.ok) message('Код подключения скопирован'); });
$('download-extension').addEventListener('click', () => action('extension'));
$('revoke').addEventListener('click', () => action('revoke'));
for (const name of ['check', 'download', 'install', 'cancel']) $(`update-${name}`).addEventListener('click', () => action('update', name));
function updateSources() {
  const key = JSON.stringify([state.selection, state.sources]);
  if (key !== sourceKey) {
    sourceKey = key;
    for (const id of ['source', 'home-source']) {
      const options = [new Option('Автоматически · активный плеер', 'auto'), ...(state.sources || []).map(source => new Option(sourceName(source) + (source.kind === 'browser' && source.title ? ` — ${source.title}` : ''), source.id))];
      if (state.selection !== 'auto' && state.selection && !state.sources?.some(source => source.id === state.selection)) { const missing = new Option('Выбранный источник недоступен', state.selection); missing.disabled = true; options.push(missing); }
      $(id).replaceChildren(...options); $(id).value = state.selection || 'auto';
    }
  }
  for (const [id] of services) { const sources = (state.sources || []).filter(source => source.provider === id); $(`service-${id}`).textContent = sources.length ? `Подключено: ${sources.length}${sources.some(source => source.playing) ? ' · воспроизводится' : ''}` : 'Ожидание плеера'; }
}
function updateUpdates() {
  const value = state.updates || {}, phase = value.phase || 'idle';
  const descriptions = { idle: 'Проверьте, доступна ли новая версия приложения.', checking: 'Проверяю последнюю версию…', current: 'Обновление не требуется.', available: `Доступна версия ${value.version}.`, downloading: `Скачивание: ${Math.round((value.downloaded || 0) / Math.max(1, value.total || 1) * 100)}%`, ready: 'Обновление скачано. Контрольная сумма проверена.', installing: 'Подготавливаю установку. После проверки приложение перезапустится…', error: value.error || 'Не удалось проверить обновления' };
  $('installed-version').textContent = `Версия ${state.version}`; $('update-status').textContent = descriptions[phase]; $('update-status').classList.toggle('error', phase === 'error');
  $('update-check').hidden = ['ready', 'downloading', 'installing'].includes(phase); $('update-check').disabled = phase === 'checking';
  $('update-download').hidden = !value.version || value.ready || ['checking', 'downloading', 'installing'].includes(phase);
  $('update-install').hidden = !value.ready || phase === 'installing'; $('update-install').disabled = !value.supported;
  $('update-cancel').hidden = phase !== 'downloading'; $('update-progress').hidden = phase !== 'downloading'; $('update-progress').max = value.total || 1; $('update-progress').value = value.downloaded || 0;
  $('update-detail').textContent = value.ready && !value.supported ? 'Установка доступна в переносимой Windows-сборке.' : value.version ? `В той же папке появится Liberty-Wave-${value.version}-Windows.exe. После успешной замены старый файл будет удалён. Настройки сохранятся.` : 'Обновления загружаются из официального GitHub-репозитория. Старые загрузки очищаются автоматически.';
  $('update-dot').hidden = !value.version;
}
function update(next) {
  if (!next) return;
  if (state?.source?.id !== next.source?.id) { seeking = false; editingRanges.delete('volume'); }
  state = next; clock.update(state); theme.update(state); shortcuts.update(state); personalization.update(state);
  $('version').textContent = state.version; $('mode-badge').textContent = state.interaction ? 'Управление включено' : 'Закреплён'; $('mode-badge').classList.toggle('editable', state.interaction);
  $('interaction').checked = state.interaction; $('compact').checked = state.preferences.compact;
  $('interaction-description').textContent = state.interaction ? 'Виджет можно перемещать и нажимать его кнопки' : 'Клики проходят сквозь виджет';
  $('interaction-key').textContent = LibertyShortcuts.format(state.shortcuts.bindings.toggleInteraction);
  $('connection-status').textContent = state.connected ? sourceName(state.source) : 'Ожидание плеера'; $('connection-dot').parentElement.classList.toggle('connected', state.connected);
  $('track-title').textContent = state.connected ? state.title || 'Без названия' : 'Включите музыку'; $('track-artist').textContent = state.connected ? state.artist || 'Неизвестный исполнитель' : 'Откройте свой плеер или музыкальную вкладку'; $('track-source').textContent = state.connected ? sourceName(state.source) : '';
  $('playing-label').textContent = state.demo ? 'ДЕМО · ПРЕДПРОСМОТР' : state.connected ? state.playing ? 'СЕЙЧАС ИГРАЕТ' : 'НА ПАУЗЕ' : 'ВАША МУЗЫКА';
  const artwork = state.artwork || (state.demo ? '../renderer/demo-cover.svg' : '');
  if (currentArtwork !== artwork) { currentArtwork = artwork; $('artwork').hidden = !artwork; $('cover-placeholder').hidden = !!artwork; if (artwork) $('artwork').src = artwork; else $('artwork').removeAttribute('src'); }
  for (const [id, key] of [['play-pause', 'playPause'], ['next', 'next'], ['previous', 'previous']]) $(id).hidden = !state.connected || !state.capabilities?.[key];
  $('play-use').setAttribute('href', state.playing ? '#pause-icon' : '#play-icon'); $('play-pause').setAttribute('aria-label', state.playing ? 'Пауза' : 'Продолжить');
  $('seek').disabled = !state.capabilities?.seek; $('duration').textContent = state.live ? 'LIVE' : state.duration ? time(state.duration) : '—:—';
  $('volume-row').hidden = !state.capabilities?.volume || !Number.isFinite(state.volume); $('mute').hidden = !state.capabilities?.mute;
  $('volume-use').setAttribute('href', state.muted || state.volume === 0 ? '#mute-icon' : '#volume-icon'); $('mute').setAttribute('aria-label', state.muted ? 'Включить звук' : 'Выключить звук'); $('mute').setAttribute('aria-pressed', String(state.muted));
  setRange('volume', Math.round((state.volume || 0) * 100)); if (!editingRanges.has('volume')) $('volume-value').textContent = `${$('volume').value}%`;
  for (const [id, key] of preferences) { setRange(id, Math.round(state.preferences[key] * 100)); if (!editingRanges.has(id)) $(`${id}-value`).textContent = `${$(id).value}%`; }
  $('wave-mode').value = state.preferences.waveMode; $('wave-economy').checked = state.preferences.waveEconomy;
  $('pair-browser').disabled = !state.browserAvailable; $('browser-status').textContent = state.pairedBrowsers ? `Подключено браузеров: ${state.pairedBrowsers}` : 'Браузер ещё не подключён'; $('revoke').hidden = !state.pairedBrowsers;
  $('pairing').hidden = !state.pairing; $('pair-code').textContent = state.pairing?.code || '';
  updateSources(); updateUpdates(); paint();
}
function paint() {
  if (!state) return;
  if (!seeking) { $('seek').max = state.duration || 1; $('seek').value = clock.position(); progress('seek'); $('elapsed').textContent = state.live ? 'В эфире' : time(clock.position()); }
  if (state.pairing) { const seconds = Math.max(0, Math.ceil((state.pairing.expiresAt - Date.now()) / 1000)); $('pair-expiry').textContent = seconds ? `Код действует ещё ${time(seconds)}` : 'Код истёк. Создайте новый.'; $('copy-code').disabled = !seconds; }
}
$('artwork').addEventListener('error', () => { $('artwork').hidden = true; $('cover-placeholder').hidden = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('notice').hidden = true; });
bridge.onState(update); bridge.onNavigate(navigate); bridge.getState().then(update); setInterval(paint, 200);
