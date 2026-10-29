const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { WindowsMedia, DemoMedia, EMPTY_STATE, validateCommand } = require('./media.cjs');
const { clampBounds } = require('./window-state.cjs');
const demo = process.argv.includes('--demo');
let window, tray, media, saveTimer;
let settings = {}, interaction = true, shortcutAvailable = false, state = { ...EMPTY_STATE };

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) setInteraction(true); });
  app.whenReady().then(start).catch(error => { console.error(error); app.quit(); });
}

function publish() { if (window && !window.isDestroyed()) window.webContents.send('widget:state', snapshot()); }
function snapshot() { return { ...state, interaction, shortcutAvailable, demo, platform: process.platform }; }
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.writeFileSync(path.join(app.getPath('userData'), 'widget.json'), JSON.stringify(settings)); } catch (error) { console.error('Cannot save preferences', error.message); } }, 250); }
function setInteraction(enabled) {
  interaction = enabled;
  window.setIgnoreMouseEvents(!enabled, { forward: true });
  window.setFocusable(enabled);
  if (enabled) { window.show(); window.focus(); }
  else window.blur();
  publish(); updateTray();
}
function menu() {
  return Menu.buildFromTemplate([
    { label: interaction ? 'Закрепить · пропускать клики (Num8)' : 'Управлять и перемещать (Num8)', click: () => setInteraction(!interaction) },
    { label: 'Открыть Яндекс Музыку', click: openMusic },
    { type: 'separator' },
    { label: 'Непрозрачность', submenu: [0.65, 0.85, 1].map(opacity => ({ label: `${Math.round(opacity * 100)}%`, type: 'radio', checked: (settings.opacity || 1) === opacity, click: () => { settings.opacity = opacity; window.setOpacity(opacity); save(); } })) },
    { label: 'Вернуть в угол экрана', click: () => { window.setBounds(clampBounds(null, [screen.getPrimaryDisplay()])); } },
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
  try { settings = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'widget.json'), 'utf8')); } catch {}
  window = new BrowserWindow({ ...clampBounds(settings.bounds, screen.getAllDisplays()), transparent: true, frame: false, resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setOpacity([0.65, 0.85, 1].includes(settings.opacity) ? settings.opacity : 1);
  window.on('moved', () => { settings.bounds = window.getBounds(); save(); });
  screen.on('display-removed', () => window.setBounds(clampBounds(window.getBounds(), screen.getAllDisplays())));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const authorized = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  ipcMain.handle('widget:get-state', event => authorized(event) ? snapshot() : null);
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
  else if (process.platform === 'win32') media = new WindowsMedia(app.isPackaged ? path.join(process.resourcesPath, 'windows-media.ps1') : path.join(__dirname, '../native/windows-media.ps1'));
  else { state = { ...EMPTY_STATE, error: 'Прямая связь с приложением Яндекс Музыки поддерживается в Windows 10/11. Для просмотра интерфейса: npm run demo.' }; publish(); return; }
  media.on('state', value => { state = value; publish(); });
  media.start();
}
app.on('before-quit', () => { clearTimeout(saveTimer); if (window && !window.isDestroyed()) { settings.bounds = window.getBounds(); try { fs.writeFileSync(path.join(app.getPath('userData'), 'widget.json'), JSON.stringify(settings)); } catch {} } media?.stop(); globalShortcut.unregisterAll(); tray?.destroy(); });
app.on('window-all-closed', () => app.quit());
