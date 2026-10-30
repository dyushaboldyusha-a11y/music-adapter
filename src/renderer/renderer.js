const $ = id => document.getElementById(id);
let state = {}, volumeEditing = false, volumeTimer, volumeSource, seeking = false, currentArtwork;
const playbackClock = new LibertyPlaybackClock();
const bridge = window.musicWidget;
const audioWave = LibertyAudioWave.create();
bridge.onAudioLevel(level => audioWave.level(level));
const formatTime = value => { const total = Math.floor(Math.max(0, value || 0)); return total >= 3600 ? `${Math.floor(total / 3600)}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}` : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };
async function command(name, value) { if (!state.interaction) return { ok: false }; const result = await bridge.command(name, value); if (!result.ok) console.warn(result.error || 'Не удалось выполнить команду'); return result; }
function sourceLabel(source) { return `${source.name} · ${source.kind === 'app' ? 'приложение' : source.provider === 'browser' ? 'браузер' : source.browser || 'браузер'}`; }
function update(next) {
  if (!next) return;
  if (state.source?.id !== next.source?.id || !next.interaction) { clearTimeout(volumeTimer); volumeEditing = false; }
  state = next; playbackClock.update(next);
  document.body.classList.toggle('compact', state.compact === true);
  audioWave.update(state.preferences);
  LibertyTheme.apply(state.preferences?.color || LibertyTheme.DEFAULT_COLOR);
  document.documentElement.style.setProperty('--decoration-opacity', String(state.preferences?.opacity ?? 1));
  document.body.classList.toggle('locked', !state.interaction);
  document.body.classList.toggle('connected', !!state.connected);
  $('widget').inert = !state.interaction;
  document.querySelector('.widget-footer').inert = !state.interaction;
  if (!state.interaction) { document.activeElement?.blur(); }
  document.title = `Liberty Wave${state.source ? ' · ' + sourceLabel(state.source) : ''}`;
  $('widget').setAttribute('aria-label', state.source ? `Liberty Wave · ${sourceLabel(state.source)}` : 'Музыкальный виджет Liberty Wave');
  $('title').textContent = state.connected ? state.title || 'Без названия' : state.source?.name || 'Liberty Wave';
  $('artist').textContent = state.connected ? state.artist || 'Неизвестный исполнитель' : 'Ваша музыка — всегда рядом';
  $('title').title = state.interaction ? state.title || '' : '';
  $('artist').title = state.interaction ? state.artist || '' : '';
  $('menu').title = state.interaction ? 'Открыть Liberty Wave' : '';
  $('demo-label').hidden = !state.demo;
  $('source-name').textContent = state.source ? sourceLabel(state.source) : 'Ожидание плеера';
  const artwork = state.artwork || (state.demo ? 'demo-cover.svg' : null);
  if (artwork !== currentArtwork) {
    currentArtwork = artwork;
    $('artwork').hidden = !artwork; $('cover-placeholder').hidden = !!artwork;
    if (artwork) $('artwork').src = artwork; else $('artwork').removeAttribute('src');
  }
  $('duration').textContent = state.live ? 'LIVE' : state.duration ? formatTime(state.duration) : '—:—';
  const capability = state.capabilities || {};
  for (const [id, key] of [['play-pause', 'playPause'], ['next', 'next'], ['previous', 'previous'], ['shuffle', 'shuffle'], ['repeat', 'repeat'], ['seek', 'seek']]) {
    $(id).disabled = !state.connected || !capability[key];
    if (id !== 'seek') $(id).hidden = $(id).disabled;
  }
  $('volume-controls').hidden = !state.connected || !capability.volume || !Number.isFinite(state.volume);
  $('volume').disabled = !capability.volume;
  $('mute').hidden = !capability.mute;
  $('mute').disabled = !capability.mute;
  $('mute').setAttribute('aria-pressed', String(!!state.muted));
  $('mute').setAttribute('aria-label', state.muted ? 'Включить звук' : 'Выключить звук');
  $('volume-icon').setAttribute('href', state.muted || state.volume === 0 ? '#i-muted' : '#i-volume');
  if (!volumeEditing) { $('volume').value = Math.round((state.volume ?? 0) * 100); paintVolume(); }
  $('play-icon').setAttribute('href', state.playing ? '#i-pause' : '#i-play');
  $('play-pause').setAttribute('aria-label', state.playing ? 'Пауза' : 'Воспроизвести');
  $('shuffle').setAttribute('aria-pressed', String(!!state.shuffle));
  $('repeat').setAttribute('aria-pressed', String(state.repeat !== 'none'));
  $('repeat').setAttribute('aria-label', state.repeat === 'track' ? 'Повтор трека' : state.repeat === 'list' ? 'Повтор списка' : 'Включить повтор');
  $('repeat-one').hidden = state.repeat !== 'track';
  $('mode-text').textContent = state.interaction ? 'Перетащите за обложку или название' : 'Поверх окон · клики проходят сквозь';
  $('key-hint').textContent = state.interaction ? 'закрепить' : 'управлять';
  const controlKey = state.shortcuts?.active.toggleInteraction[0];
  $('interaction-key').textContent = controlKey ? LibertyShortcuts.format(controlKey) : 'Трей';
  $('interaction-key').title = state.interaction ? (controlKey ? LibertyShortcuts.format(controlKey) : 'Настройте горячие клавиши через значок в трее') : '';
  paintProgress();
}
function paintProgress() {
  if (seeking) return;
  const position = playbackClock.position();
  $('seek').max = state.duration || 1; $('seek').value = position;
  $('seek').style.setProperty('--progress', `${state.duration ? position / state.duration * 100 : 0}%`);
  $('elapsed').textContent = state.live ? 'В эфире' : formatTime(position);
}
$('seek').addEventListener('input', () => { seeking = true; $('elapsed').textContent = formatTime(Number($('seek').value)); $('seek').style.setProperty('--progress', `${Number($('seek').value) / Number($('seek').max) * 100}%`); });
$('seek').addEventListener('change', async () => { const position = Number($('seek').value); playbackClock.seek(position); seeking = false; paintProgress(); const result = await command('seek', position); if (!result.ok) { playbackClock.rejectSeek(); paintProgress(); } });
$('seek').addEventListener('pointercancel', () => { seeking = false; paintProgress(); });
function paintVolume() { $('volume-value').textContent = `${$('volume').value}%`; $('volume').style.setProperty('--progress', `${$('volume').value}%`); }
async function sendVolume() {
  clearTimeout(volumeTimer);
  if (volumeSource !== state.source?.id || !state.interaction) { volumeEditing = false; return; }
  const result = await command('volume', Number($('volume').value) / 100);
  volumeEditing = false; if (!result.ok) update(await bridge.getState());
}
$('volume').addEventListener('input', () => { volumeEditing = true; volumeSource = state.source?.id; paintVolume(); clearTimeout(volumeTimer); volumeTimer = setTimeout(sendVolume, 120); });
$('volume').addEventListener('change', sendVolume);
$('volume').addEventListener('pointercancel', () => { clearTimeout(volumeTimer); volumeEditing = false; bridge.getState().then(update); });
$('mute').addEventListener('click', () => command('mute', !state.muted));
$('play-pause').addEventListener('click', () => command('playPause'));
$('previous').addEventListener('click', () => command('previous'));
$('next').addEventListener('click', () => command('next'));
$('shuffle').addEventListener('click', () => command('shuffle', !state.shuffle));
$('repeat').addEventListener('click', () => command('repeat', { none: 'list', list: 'track', track: 'none' }[state.repeat] || 'none'));
$('menu').addEventListener('click', () => bridge.openControls('home'));
$('artwork').addEventListener('error', () => { currentArtwork = null; $('artwork').hidden = true; $('cover-placeholder').hidden = false; });
bridge.onState(update);
bridge.getState().then(update);
document.addEventListener('wheel', event => { if (event.ctrlKey) event.preventDefault(); }, { passive: false });
setInterval(paintProgress, 200);
