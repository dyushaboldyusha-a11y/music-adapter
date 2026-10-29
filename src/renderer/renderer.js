const $ = id => document.getElementById(id);
let state = {}, receivedAt = performance.now(), seeking = false, currentArtwork, scaleTimer;
const bridge = window.musicWidget;
const formatTime = value => { const total = Math.floor(Math.max(0, value || 0)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };
async function command(name, value) { const result = await bridge.command(name, value); if (!result.ok) console.warn(result.error || 'Не удалось выполнить команду'); }
function update(next) {
  if (!next) return;
  state = next; receivedAt = performance.now();
  document.documentElement.style.setProperty('--decoration-opacity', String(state.preferences?.opacity ?? 1));
  document.body.classList.toggle('locked', !state.interaction);
  $('title').textContent = state.connected ? state.title || 'Без названия' : 'Яндекс Музыка';
  $('artist').textContent = state.connected ? state.artist || 'Неизвестный исполнитель' : 'Ваша музыка — всегда рядом';
  $('title').title = state.title || '';
  $('artist').title = state.artist || '';
  $('demo-label').hidden = !state.demo;
  const artwork = state.artwork || (state.demo ? 'demo-cover.svg' : null);
  if (artwork !== currentArtwork) {
    currentArtwork = artwork;
    $('artwork').hidden = !artwork; $('cover-placeholder').hidden = !!artwork;
    if (artwork) $('artwork').src = artwork; else $('artwork').removeAttribute('src');
  }
  $('duration').textContent = formatTime(state.duration);
  const capability = state.capabilities || {};
  for (const [id, key] of [['play-pause', 'playPause'], ['next', 'next'], ['previous', 'previous'], ['shuffle', 'shuffle'], ['repeat', 'repeat'], ['seek', 'seek']]) {
    $(id).disabled = !state.connected || !capability[key];
    if (id !== 'seek') $(id).hidden = $(id).disabled;
  }
  $('play-icon').setAttribute('href', state.playing ? '#i-pause' : '#i-play');
  $('play-pause').setAttribute('aria-label', state.playing ? 'Пауза' : 'Воспроизвести');
  $('shuffle').setAttribute('aria-pressed', String(!!state.shuffle));
  $('repeat').setAttribute('aria-pressed', String(state.repeat !== 'none'));
  $('repeat').setAttribute('aria-label', state.repeat === 'track' ? 'Повтор трека' : state.repeat === 'list' ? 'Повтор списка' : 'Включить повтор');
  $('repeat-one').hidden = state.repeat !== 'track';
  $('mode-text').textContent = state.interaction ? 'Перетащите за обложку или название' : 'Поверх окон · клики проходят сквозь';
  $('key-hint').textContent = state.interaction ? 'закрепить' : 'управлять';
  if (!state.shortcutAvailable) { $('mode-text').textContent = 'Num8 занят · Ctrl + Shift + 8 или значок в трее'; $('mode-text').title = 'Включите NumLock для Num8'; }
  paintProgress();
}
function paintProgress() {
  if (seeking) return;
  const position = Math.min(state.duration || 0, (state.position || 0) + (state.playing ? (performance.now() - receivedAt) / 1000 : 0));
  $('seek').max = state.duration || 1; $('seek').value = position;
  $('seek').style.setProperty('--progress', `${state.duration ? position / state.duration * 100 : 0}%`);
  $('elapsed').textContent = formatTime(position);
}
$('seek').addEventListener('input', () => { seeking = true; $('elapsed').textContent = formatTime(Number($('seek').value)); $('seek').style.setProperty('--progress', `${Number($('seek').value) / Number($('seek').max) * 100}%`); });
$('seek').addEventListener('change', async () => { const position = Number($('seek').value); await command('seek', position); seeking = false; });
$('seek').addEventListener('pointercancel', () => { seeking = false; paintProgress(); });
$('play-pause').addEventListener('click', () => command('playPause'));
$('previous').addEventListener('click', () => command('previous'));
$('next').addEventListener('click', () => command('next'));
$('shuffle').addEventListener('click', () => command('shuffle', !state.shuffle));
$('repeat').addEventListener('click', () => command('repeat', { none: 'list', list: 'track', track: 'none' }[state.repeat] || 'none'));
$('menu').addEventListener('click', () => bridge.showMenu());
$('artwork').addEventListener('error', () => { currentArtwork = null; $('artwork').hidden = true; $('cover-placeholder').hidden = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.interaction) bridge.toggleInteraction(); });
document.addEventListener('wheel', event => {
  if (!event.ctrlKey || !state.interaction) return;
  event.preventDefault();
  clearTimeout(scaleTimer);
  const scale = Math.max(.5, Math.min(1.75, (state.preferences?.scale || 1) + (event.deltaY < 0 ? .05 : -.05)));
  scaleTimer = setTimeout(() => bridge.setPreferences({ scale }), 30);
}, { passive: false });
bridge.onState(update);
bridge.getState().then(update);
setInterval(paintProgress, 200);
