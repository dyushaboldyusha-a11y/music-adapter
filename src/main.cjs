const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, screen, shell, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { WindowsMedia, DemoMedia, EMPTY_STATE, validateCommand } = require('./media.cjs');
const { preferences, layoutForDisplays } = require('./window-state.cjs');
const { watchDisplays } = require('./display-placement.cjs');
const { BrowserBridge } = require('./browser-bridge.cjs');
const { MediaHub } = require('./media-hub.cjs');
const { PROVIDERS, label: sourceLabel } = require('./sources.cjs');
const { ShortcutManager } = require('./shortcuts.cjs');
const { format: formatShortcut } = require('./shared/shortcuts.js');
const { normalizeColor } = require('./shared/theme.js');
const APP_NAME = 'Liberty Wave';
const ICON_PATH = path.join(__dirname, 'assets/liberty-wave.png');
// The display name can change without moving preferences or paired browsers.
// Preserve explicit profiles used by tests and advanced launches as well.
const profileOverride = app.commandLine.getSwitchValue('user-data-dir');
const profilePath = profileOverride ? path.resolve(profileOverride) : path.join(app.getPath('appData'), 'music-adapter');
fs.mkdirSync(profilePath, { recursive: true });
app.setPath('userData', profilePath);
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('io.musicadapter.widget');
const demo = process.argv.includes('--demo');
let window, tray, media, saveTimer, placement, browserBridge, shortcuts;
let effectiveScale = 1;
let settings = {}, interaction = true, editor = null, shortcutCommandPending = false, state = { ...EMPTY_STATE };

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) setInteraction(true); });
  app.whenReady().then(start).catch(error => { console.error(error); app.quit(); });
}

function publish() { if (window && !window.isDestroyed()) window.webContents.send('widget:state', snapshot()); }
function snapshot() { return { ...state, interaction, shortcuts: shortcuts?.snapshot(), shortcutEditing: editor === 'shortcuts', themeEditing: editor === 'theme', shortcutAvailable: shortcuts?.snapshot().available.toggleInteraction === true, demo, browserAvailable: browserBridge?.available === true, preferences: { ...preferences(settings), scale: effectiveScale }, platform: process.platform }; }
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.writeFileSync(path.join(app.getPath('userData'), 'widget.json'), JSON.stringify(settings)); } catch (error) { console.error('Cannot save preferences', error.message); } }, 250); }
function setInteraction(enabled) {
  if (!enabled && editor) endEditor();
  interaction = enabled;
  window.setIgnoreMouseEvents(!enabled);
  window.setFocusable(enabled);
  if (enabled) { placement?.restore(); window.show(); window.focus(); }
  else window.blur();
  publish(); updateTray();
}
function interactionShortcut() {
  const status = shortcuts?.snapshot();
  return status?.available.toggleInteraction ? formatShortcut(status.active.toggleInteraction[0]) : 'значок в трее';
}
function beginEditor(name) {
  endEditor(); setInteraction(true); editor = name; shortcuts.suspend(); publish();
  return { ok: true };
}
function endEditor() {
  if (!editor) return;
  editor = null; shortcuts.resume(); publish(); updateTray();
}
async function mediaCommand(command, value) {
  try {
    validateCommand(command, value);
    if (!media || !state.connected || !state.capabilities?.[command]) throw new Error('Источник не предоставляет эту команду');
    await media.command(command, value); return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
}
async function shortcutPlayPause() {
  if (shortcutCommandPending) return;
  shortcutCommandPending = true;
  try { const result = await mediaCommand('playPause'); if (!result.ok) console.warn(result.error); }
  finally { shortcutCommandPending = false; }
}
function setPreferences(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update) || Object.keys(update).some(key => !['opacity', 'scale', 'color'].includes(key)) || Object.entries(update).some(([key, value]) => key !== 'color' && !Number.isFinite(value))) throw new Error('Некорректные настройки');
  if (Object.hasOwn(update, 'color')) normalizeColor(update.color);
  const next = preferences({ ...preferences(settings), ...update });
  Object.assign(settings, next);
  if (Object.hasOwn(update, 'scale')) placement.restore();
  else { save(); publish(); }
  updateTray();
}
function menu() {
  return Menu.buildFromTemplate([
    { label: `${interaction ? 'Закрепить · пропускать клики' : 'Управлять и перемещать'} (${interactionShortcut()})`, click: () => setInteraction(!interaction) },
    { label: 'Горячие клавиши…', click: () => beginEditor('shortcuts') },
    { label: 'Цвет интерфейса…', click: () => beginEditor('theme') },
    { label: 'Источник', submenu: [{ label: 'Автоматически', type: 'radio', checked: !state.selection || state.selection === 'auto', click: () => selectSource('auto') }, { type: 'separator' }, ...(state.sources || []).map(s => ({ label: sourceLabel(s) + (s.kind === 'browser' && s.title ? ' — ' + s.title.slice(0, 40) : ''), type: 'radio', checked: state.selection === s.id, click: () => selectSource(s.id) }))] },
    { label: 'Подключить браузер', enabled: browserBridge?.available === true, click: showPairing },
    { label: 'Отключить все браузеры', enabled: (browserBridge?.clients.size || 0) > 0, click: () => { browserBridge.revoke(); updateTray(); } },
    { label: 'Открыть сервис', submenu: [{ label: 'Яндекс Музыка · приложение', click: () => openMusic('yandex', true) }, { label: 'Spotify · приложение', click: () => openMusic('spotify', true) }, { type: 'separator' }, ...[...PROVIDERS.values()].map(s => ({ label: `${s.name} · браузер`, click: () => openMusic(s.id) }))] },
    { type: 'separator' },
    { label: 'Непрозрачность оформления', submenu: [.25, .4, .5, .65, .85, 1].map(opacity => ({ label: `${Math.round(opacity * 100)}%`, type: 'radio', checked: preferences(settings).opacity === opacity, click: () => setPreferences({ opacity }) })) },
    { label: 'Масштаб · Ctrl + колесо', submenu: [.5, .65, .75, 1, 1.25, 1.5, 1.75].map(scale => ({ label: `${Math.round(scale * 100)}%`, type: 'radio', checked: Math.abs(preferences(settings).scale - scale) < .01, click: () => setPreferences({ scale }) })) },
    { label: state.connected ? sourceLabel(state.source) : 'Ожидание плеера', enabled: false },
    { label: 'Вернуть в угол экрана', click: () => placement.restore(true) },
    { label: 'Запускать с Windows', type: 'checkbox', visible: process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE, checked: process.platform === 'win32' && app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: 'Закрыть виджет', click: () => app.quit() }
  ]);
}
function updateTray() { if (tray) { tray.setToolTip(`${APP_NAME} · ${interaction ? 'управление включено' : 'закреплён'} · ${interactionShortcut()}`); tray.setContextMenu(menu()); } }
async function selectSource(id) { try { if (typeof id !== 'string' || id.length > 200) throw new Error('Некорректный источник'); await media.selectSource(id); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } }
function showPairing() { try { endEditor(); setInteraction(true); const pair = browserBridge.beginPairing(); window.webContents.send('widget:pairing', pair); return { ok: true, ...pair }; } catch (error) { return { ok: false, error: error.message }; } }
async function openMusic(provider = state.source?.provider || 'yandex', nativeApp = false) {
  const service = PROVIDERS.get(provider);
  if (!service) return { ok: false, error: 'Выберите музыкальный сервис' };
  const url = nativeApp && provider === 'yandex' ? 'yandexmusic://' : nativeApp && provider === 'spotify' ? 'spotify:' : service.url;
  try { await shell.openExternal(url); return { ok: true }; }
  catch { return { ok: false, error: 'Откройте плеер самостоятельно' }; }
}
function trayImage() {
  return nativeImage.createFromPath(ICON_PATH).resize({ width: 32, height: 32, quality: 'best' });
}
async function start() {
  try { const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'widget.json'), 'utf8')); if (saved && typeof saved === 'object') settings = saved; } catch {}
  Object.assign(settings, preferences(settings));
  shortcuts = new ShortcutManager(globalShortcut, { toggleInteraction: () => setInteraction(!interaction), playPause: shortcutPlayPause }, settings.shortcuts);
  settings.shortcuts = { ...shortcuts.bindings };
  const initial = layoutForDisplays(settings.bounds, screen.getAllDisplays(), settings.scale);
  effectiveScale = initial.scale;
  window = new BrowserWindow({ ...initial.bounds, title: APP_NAME, icon: nativeImage.createFromPath(ICON_PATH), transparent: true, frame: false, resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.setZoomFactor(effectiveScale);
  window.on('moved', () => { settings.bounds = window.getBounds(); save(); });
  placement = watchDisplays(window, screen, { getScale: () => preferences(settings).scale, onLayout: layout => {
    effectiveScale = layout.scale; settings.bounds = layout.bounds; save(); publish();
  } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('blur', endEditor);
  window.webContents.on('render-process-gone', endEditor);
  const authorized = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  ipcMain.handle('widget:get-state', event => authorized(event) ? snapshot() : null);
  ipcMain.handle('widget:shortcuts-open', event => authorized(event) && interaction ? beginEditor('shortcuts') : { ok: false });
  ipcMain.handle('widget:shortcuts-cancel', event => { if (authorized(event) && editor === 'shortcuts') endEditor(); return { ok: true }; });
  ipcMain.handle('widget:theme-open', event => authorized(event) && interaction ? beginEditor('theme') : { ok: false });
  ipcMain.handle('widget:theme-cancel', event => { if (authorized(event) && editor === 'theme') endEditor(); return { ok: true }; });
  ipcMain.handle('widget:theme-save', (event, color) => {
    try {
      if (!authorized(event) || !interaction || editor !== 'theme') throw new Error('Откройте палитру');
      setPreferences({ color }); endEditor(); return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('widget:shortcuts-save', (event, update) => {
    try {
      if (!authorized(event) || !interaction || editor !== 'shortcuts') throw new Error('Откройте настройки горячих клавиш');
      shortcuts.configure(update); settings.shortcuts = { ...shortcuts.bindings }; editor = null;
      save(); publish(); updateTray(); return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('widget:source', (event, id) => authorized(event) && interaction ? selectSource(id) : { ok: false });
  ipcMain.handle('widget:pair', event => authorized(event) && interaction ? showPairing() : { ok: false });
  ipcMain.handle('widget:copy-pair', event => { if (authorized(event) && interaction && browserBridge?.pairing?.expiresAt > Date.now()) clipboard.writeText(browserBridge.pairing.code); });
  ipcMain.handle('widget:preferences', (event, update) => {
    try { if (!authorized(event) || !interaction) throw new Error(`Включите управление: ${interactionShortcut()}`); setPreferences(update); return { ok: true, preferences: preferences(settings) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('widget:command', async (event, command, value) => {
    try {
      if (!authorized(event) || !interaction) throw new Error(`Включите управление: ${interactionShortcut()}`);
      return await mediaCommand(command, value);
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('widget:open-music', event => authorized(event) && interaction ? openMusic() : { ok: false });
  ipcMain.on('widget:menu', event => { if (authorized(event) && interaction) menu().popup({ window }); });
  ipcMain.on('widget:toggle-interaction', event => { if (authorized(event)) setInteraction(!interaction); });
  tray = new Tray(trayImage());
  tray.on('click', () => setInteraction(!interaction));
  shortcuts.resume();
  interaction = !shortcuts.snapshot().available.toggleInteraction || demo;
  updateTray();
  await window.loadFile(path.join(__dirname, 'renderer/index.html'));
  window.showInactive();
  setInteraction(interaction);
  browserBridge = new BrowserBridge({ port: demo ? 0 : 16837, dataFile: path.join(app.getPath('userData'), 'browser-connections.json') });
  try { await browserBridge.start(); } catch (error) { console.warn('Browser connector unavailable:', error.code); }
  if (demo) media = new DemoMedia();
  else media = new MediaHub(process.platform === 'win32' ? new WindowsMedia(app.isPackaged ? path.join(process.resourcesPath, 'native/windows-media.ps1') : path.join(__dirname, '../native/windows-media.ps1')) : null, browserBridge);
  media.on('state', value => { const changed = JSON.stringify([value.connected, value.selection, value.sources?.map(s => [s.id,s.title])]) !== JSON.stringify([state.connected, state.selection, state.sources?.map(s => [s.id,s.title])]); state = value; publish(); if (changed) updateTray(); });
  media.start();
  updateTray();
}
app.on('before-quit', () => { editor = null; placement?.dispose(); clearTimeout(saveTimer); if (window && !window.isDestroyed()) { settings.bounds = window.getBounds(); try { fs.writeFileSync(path.join(app.getPath('userData'), 'widget.json'), JSON.stringify(settings)); } catch {} } media?.stop(); browserBridge?.stop(); shortcuts?.stop(); globalShortcut.unregisterAll(); tray?.destroy(); });
app.on('window-all-closed', () => app.quit());
