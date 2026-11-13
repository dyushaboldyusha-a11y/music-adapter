const $ = id => document.getElementById(id);
const THEME_COLORS = ['--app-bg', '--glass-bg', '--glass-panel', '--glass-border', '--glass-highlight', '--glass-inner-border', '--glass-card-border', '--text', '--muted', '--track-bg', '--shadow-color', '--red', '--accent-ink', '--on-accent', '--on-accent-hover', '--error-ink', '--surface-color'];
function applyTheme(theme) {
  if (!theme || !['light', 'dark'].includes(theme.appearance) || !theme.tokens || typeof theme.tokens !== 'object') return;
  const colors = THEME_COLORS.filter(key => typeof theme.tokens[key] === 'string' && theme.tokens[key].length <= 160 && CSS.supports('color', theme.tokens[key]));
  if (!['--app-bg', '--text', '--red'].every(key => colors.includes(key))) return;
  for (const key of THEME_COLORS) document.documentElement.style.removeProperty(key);
  for (const key of colors) document.documentElement.style.setProperty(key, theme.tokens[key]);
  document.documentElement.dataset.appearance = theme.appearance;
  document.documentElement.style.colorScheme = theme.appearance;
}
let refreshing, actionError = '', waveBusy = false;
function showStatus(s) {
  applyTheme(s.theme);
  const error = actionError || s.error;
  document.body.dataset.connection = error ? 'error' : s.paired ? 'paired' : 'unpaired';
  $('connection-label').textContent = error ? 'Требуется внимание' : s.paired ? 'Браузер подключён' : 'Подключите браузер';
  $('status').textContent = error || (s.paired ? `Подключено · вкладок с музыкой: ${s.players}` : 'Откройте Liberty Wave → «Источники» и получите код подключения.');
  $('pair').hidden = s.paired; $('disconnect').hidden = !s.paired; $('wave-controls').hidden = !s.paired;
  $('wave-start').hidden = !s.paired; $('wave-stop').hidden = !s.paired || s.waveTab == null; $('wave-help').hidden = !s.paired;
}
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try { showStatus(await chrome.runtime.sendMessage({ type: 'status' })); }
    catch { $('connection-label').textContent = 'Нет подключения'; $('status').textContent = 'Закройте и снова откройте окно расширения.'; document.body.dataset.connection = 'error'; }
  })();
  try { await refreshing; } finally { refreshing = null; }
}
function showError(error, fallback) {
  actionError = error?.message || fallback;
  $('status').textContent = actionError; $('connection-label').textContent = 'Требуется внимание'; document.body.dataset.connection = 'error';
}
$('wave-start').addEventListener('click', async () => {
  if (waveBusy) return; waveBusy = true; actionError = ''; $('wave-start').disabled = true;
  try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }); const result = await chrome.runtime.sendMessage({ type: 'wave-start', tabId: tab.id, streamId }); if (!result.ok) throw new Error(result.error); await refresh(); }
  catch (error) { showError(error, 'Разрешите звук музыкальной вкладки'); }
  finally { waveBusy = false; $('wave-start').disabled = false; }
});
$('wave-stop').addEventListener('click', async () => {
  actionError = '';
  try { await chrome.runtime.sendMessage({ type: 'wave-stop' }); await refresh(); }
  catch (error) { showError(error, 'Не удалось остановить волну вкладки'); }
});
$('pair').addEventListener('submit', async event => {
  event.preventDefault(); actionError = ''; const button = $('pair').querySelector('button'); button.disabled = true;
  try { const result = await chrome.runtime.sendMessage({ type: 'pair', code: $('code').value }); if (!result.ok) throw new Error(result.error); await refresh(); }
  catch (error) { showError(error, 'Не удалось подключить браузер'); }
  finally { button.disabled = false; }
});
$('disconnect').addEventListener('click', async () => {
  actionError = '';
  try { await chrome.runtime.sendMessage({ type: 'disconnect' }); await refresh(); }
  catch (error) { showError(error, 'Не удалось отключить браузер'); }
});
const refreshTimer = setInterval(() => { if (!document.hidden) refresh(); }, 1500);
window.addEventListener('pagehide', () => clearInterval(refreshTimer), { once: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
refresh();
