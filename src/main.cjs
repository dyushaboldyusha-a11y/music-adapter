const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { WindowsMedia, DemoMedia, EMPTY_STATE, validateCommand } = require('./media.cjs');
const { preferences, layoutForDisplays } = require('./window-state.cjs');
const { watchDisplays } = require('./display-placement.cjs');
const demo = process.argv.includes('--demo');
let window, tray, media, saveTimer, placement;
let effectiveScale = 1;
let settings = {}, interaction = true, shortcutAvailable = false, state = { ...EMPTY_STATE };

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) setInteraction(true); });
  app.whenReady().then(start).catch(error => { console.error(error); app.quit(); });
}

function publish() { if (window && !window.isDestroyed()) window.webContents.send('widget:state', snapshot()); }
function snapshot() { return { ...state, interaction, shortcutAvailable, demo, preferences: { ...preferences(settings), scale: effectiveScale }, platform: process.platform }; }
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.writeFileSync(path.join(app.getPath('userData'), 'widget.json'), JSON.stringify(settings)); } catch (error) { console.error('Cannot save preferences', error.message); } }, 250); }
function setInteraction(enabled) {
  interaction = enabled;
  window.setIgnoreMouseEvents(!enabled, { forward: true });
  window.setFocusable(enabled);
  if (enabled) { placement?.restore(); window.show(); window.focus(); }
  else window.blur();
  publish(); updateTray();
}
function setPreferences(update) {
  if (!update || typeof update !== 'object' || Object.keys(update).some(key => !['opacity', 'scale'].includes(key)) || Object.values(update).some(value => !Number.isFinite(value))) throw new Error('Некорректные настройки');
  const next = preferences({ ...preferences(settings), ...update });
  Object.assign(settings, next);
  placement.restore();
  updateTray();
}
function menu() {
  return Menu.buildFromTemplate([
    { label: interaction ? 'Закрепить · пропускать клики (Num8)' : 'Управлять и перемещать (Num8)', click: () => setInteraction(!interaction) },
    { label: 'Открыть Яндекс Музыку', click: openMusic },
    { type: 'separator' },
    { label: 'Непрозрачность оформления', submenu: [.25, .4, .5, .65, .85, 1].map(opacity => ({ label: `${Math.round(opacity * 100)}%`, type: 'radio', checked: preferences(settings).opacity === opacity, click: () => setPreferences({ opacity }) })) },
    { label: 'Масштаб · Ctrl + колесо', submenu: [.5, .65, .75, 1, 1.25, 1.5, 1.75].map(scale => ({ label: `${Math.round(scale * 100)}%`, type: 'radio', checked: Math.abs(preferences(settings).scale - scale) < .01, click: () => setPreferences({ scale }) })) },
    { label: state.connected ? 'Яндекс Музыка подключена' : 'Ожидание Яндекс Музыки', enabled: false },
    { label: 'Вернуть в угол экрана', click: () => placement.restore(true) },
    { label: 'Запускать с Windows', type: 'checkbox', visible: process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE, checked: process.platform === 'win32' && app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: 'Закрыть виджет', click: () => app.quit() }
  ]);
}
function updateTray() { if (tray) { tray.setToolTip(`Music Adapter · ${interaction ? 'управление включено' : 'закреплён'} · Num8`); tray.setContextMenu(menu()); } }
async function openMusic() {
  if (process.platform !== 'win32') return { ok: false, error: 'Связь с приложением доступна в Windows 10/11.' };
  try { await shell.openExternal('yandexmusic://'); return { ok: true }; }
  catch { return { ok: false, error: 'Запустите установленное приложение Яндекс Музыки через меню «Пуск».' }; }
}
function trayImage() {
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const index = (y * 32 + x) * 4;
    if ((x - 15.5) ** 2 + (y - 15.5) ** 2 < 225) { pixels[index] = 56; pixels[index + 1] = 43; pixels[index + 2] = 247; pixels[index + 3] = 255; }
    if (((x >= 10 && x <= 13) || (x >= 18 && x <= 21)) && y >= 10 && y <= 21) { pixels[index] = 255; pixels[index + 1] = 255; pixels[index + 2] = 255; pixels[index + 3] = 255; }
  }
  return nativeImage.createFromBitmap(pixels, { width: 32, height: 32 });
}
async function start() {
  try { const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'widget.json'), 'utf8')); if (saved && typeof saved === 'object') settings = saved; } catch {}
  Object.assign(settings, preferences(settings));
  const initial = layoutForDisplays(settings.bounds, screen.getAllDisplays(), settings.scale);
  effectiveScale = initial.scale;
  window = new BrowserWindow({ ...initial.bounds, transparent: true, frame: false, resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.setZoomFactor(effectiveScale);
  window.on('moved', () => { settings.bounds = window.getBounds(); save(); });
  placement = watchDisplays(window, screen, { getScale: () => preferences(settings).scale, onLayout: layout => {
    effectiveScale = layout.scale; settings.bounds = layout.bounds; save(); publish();
  } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const authorized = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  ipcMain.handle('widget:get-state', event => authorized(event) ? snapshot() : null);
  ipcMain.handle('widget:preferences', (event, update) => {
    try { if (!authorized(event) || !interaction) throw new Error('Включите управление клавишей Num8'); setPreferences(update); return { ok: true, preferences: preferences(settings) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('widget:command', async (event, command, value) => {
    try {
      if (!authorized(event) || !interaction) throw new Error('Включите управление клавишей Num8');
      validateCommand(command, value);
      if (!state.connected || !state.capabilities?.[command]) throw new Error('Яндекс Музыка не предоставляет эту команду');
      await media.command(command, value); return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('widget:open-music', event => authorized(event) ? openMusic() : { ok: false });
  ipcMain.on('widget:menu', event => { if (authorized(event)) menu().popup({ window }); });
  ipcMain.on('widget:toggle-interaction', event => { if (authorized(event)) setInteraction(!interaction); });
  tray = new Tray(trayImage());
  tray.on('click', () => setInteraction(!interaction));
  shortcutAvailable = globalShortcut.register('num8', () => setInteraction(!interaction));
  // A tray escape route stays available if another program owns the global hotkey.
  globalShortcut.register('CommandOrControl+Shift+8', () => setInteraction(!interaction));
  interaction = !shortcutAvailable || demo;
  updateTray();
  await window.loadFile(path.join(__dirname, 'renderer/index.html'));
  window.showInactive();
  setInteraction(interaction);
  if (demo) media = new DemoMedia();
  else if (process.platform === 'win32') media = new WindowsMedia(app.isPackaged ? path.join(process.resourcesPath, 'native/windows-media.ps1') : path.join(__dirname, '../native/windows-media.ps1'));
  else { state = { ...EMPTY_STATE, error: 'Прямая связь с приложением Яндекс Музыки поддерживается в Windows 10/11. Для просмотра интерфейса: npm run demo.' }; publish(); return; }
  media.on('state', value => { const changed = value.connected !== state.connected; state = value; publish(); if (changed) updateTray(); });
  media.start();
}
app.on('before-quit', () => { placement?.dispose(); clearTimeout(saveTimer); if (window && !window.isDestroyed()) { settings.bounds = window.getBounds(); try { fs.writeFileSync(path.join(app.getPath('userData'), 'widget.json'), JSON.stringify(settings)); } catch {} } media?.stop(); globalShortcut.unregisterAll(); tray?.destroy(); });
app.on('window-all-closed', () => app.quit());
