const { app, BrowserWindow, globalShortcut, ipcMain, Tray, nativeImage, screen, shell, clipboard, net, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ControlWindow } = require('./control-window.cjs');
const { AppUpdater } = require('./updater.cjs');
const { createUpdateFetch } = require('./update-fetch.cjs');
const { WindowsMedia, DemoMedia, EMPTY_STATE, validateCommand } = require('./media.cjs');
const { WindowsAudio, VolumeQueue } = require('./audio.cjs');
const { SIZE, COMPACT_SIZE, DEFAULT_PREFERENCES, preferences, layoutForDisplays, snapBounds } = require('./window-state.cjs');
const { validatePreferences, exportSettings, importSettings } = require('./customization.cjs');
const { artworkColor } = require('./artwork-color.cjs');
const { AutoHide } = require('./auto-hide.cjs');
const { watchDisplays } = require('./display-placement.cjs');
const { BrowserBridge } = require('./browser-bridge.cjs');
const { MediaHub } = require('./media-hub.cjs');
const { PROVIDERS } = require('./sources.cjs');
const { ShortcutManager } = require('./shortcuts.cjs');
const { format: formatShortcut } = require('./shared/shortcuts.js');
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
let controls, controlCapture = false, visibility, fadeTimer, snapTimer, cachedArtwork, artworkAccent;
let window, tray, media, saveTimer, placement, browserBridge, shortcuts, updater, audio;
let mediaState = { ...EMPTY_STATE }, audioLevel = { available: false, level: 0 };
const volumeQueue = new VolumeQueue(() => state, mediaCommand);
let effectiveScale = 1;
let settings = {}, interaction = true, shortcutCommandPending = false, state = { ...EMPTY_STATE };

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (controls) openControls(); });
  app.whenReady().then(start).catch(error => { console.error(error); app.quit(); });
}

function publish() { if (window && !window.isDestroyed()) window.webContents.send('widget:state', snapshot()); controls?.publish(); }
function snapshot() { return { ...state, interaction, compact: compactLayout(), audio: audioLevel, autoHidden: visibility?.hidden === true, effectiveColor: settings.colorMode === 'artwork' ? artworkAccent || settings.color : settings.color, shortcuts: shortcuts?.snapshot(), updates: updater?.snapshot(), shortcutAvailable: shortcuts?.snapshot().available.toggleInteraction === true, demo, browserAvailable: browserBridge?.available === true, preferences: { ...preferences(settings), scale: effectiveScale }, platform: process.platform }; }
function compactLayout() { return settings.compact === true; }
function boundsKey() { return compactLayout() ? 'compactBounds' : 'bounds'; }
function restoreLayout(reset = false) { return placement?.restore(reset, settings[boundsKey()] || window.getBounds()); }
function refreshState() {
  const native = mediaState.source?.id?.startsWith('native:') && mediaState.source?.kind === 'app';
  const matched = native && audio?.state.available && audio.state.target === mediaState.source?.appId;
  state = { ...mediaState, ...(native ? { volume: matched ? audio.state.volume : null, muted: matched && audio.state.muted, capabilities: { ...mediaState.capabilities, volume: !!matched, mute: !!matched } } : {}) };
  if (cachedArtwork !== state.artwork) {
    cachedArtwork = state.artwork; artworkAccent = null;
    try { if (cachedArtwork) { const image = nativeImage.createFromDataURL(cachedArtwork).resize({ width: 40, height: 40 }); if (!image.isEmpty()) artworkAccent = artworkColor(image.toBitmap(), null); } } catch {}
  }
  audio?.configure({ target: native && state.connected ? state.source.appId : '', enabled: settings.waveMode === 'audio' && settings.waveIntensity > 0, economy: settings.waveEconomy === true });
  visibility?.update({ ...preferences(settings), playing: state.connected && state.playing, interaction });
  publish();
}
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.writeFileSync(path.join(app.getPath('userData'), 'widget.json'), JSON.stringify(settings)); } catch (error) { console.error('Cannot save preferences', error.message); } }, 250); }
function setInteraction(enabled, restore = true) {
  interaction = enabled;
  visibility?.update({ ...preferences(settings), playing: state.connected && state.playing, interaction });
  window.setIgnoreMouseEvents(!enabled);
  window.setFocusable(enabled);
  if (enabled) { if (restore) placement?.restore(); window.show(); window.focus(); }
  else window.blur();
  publish(); updateTray();
}
function interactionShortcut() {
  const status = shortcuts?.snapshot();
  return status?.available.toggleInteraction ? formatShortcut(status.active.toggleInteraction[0]) : 'значок в трее';
}
async function mediaCommand(command, value) {
  try {
    validateCommand(command, value);
    if (!media || !state.connected || !state.capabilities?.[command]) throw new Error('Источник не предоставляет эту команду');
    const sourceId = state.source?.id;
    if (['volume', 'mute'].includes(command) && sourceId?.startsWith('native:')) await audio.command(command, value, state.source.appId);
    else await media.command(command, value);
    // Browser transport acknowledges before its next sync. Keep subsequent held
    // volume shortcuts relative to the value that was actually accepted.
    if (state.source?.id === sourceId && ['volume', 'mute'].includes(command)) {
      if (command === 'volume') { mediaState.volume = value; if (value > 0) mediaState.muted = false; }
      else mediaState.muted = value;
      refreshState();
    }
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
}
async function shortcutMediaCommand(command) {
  if (shortcutCommandPending) return;
  shortcutCommandPending = true;
  try { const result = await mediaCommand(command); if (!result.ok) console.warn(result.error); }
  finally { shortcutCommandPending = false; }
}
function setPreferences(update) {
  validatePreferences(update, DEFAULT_PREFERENCES);
  const next = preferences({ ...preferences(settings), ...update });
  Object.assign(settings, next);
  if (['compact', 'scale', 'monitor', 'edgeMargin'].some(key => Object.hasOwn(update, key))) restoreLayout();
  save(); refreshState();
  updateTray();
}
function updateTray() { if (tray) tray.setToolTip(`${APP_NAME} · нажмите, чтобы открыть приложение`); }
async function selectSource(id) { try { if (typeof id !== 'string' || id.length > 200) throw new Error('Некорректный источник'); await media.selectSource(id); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } }
async function openMusic(provider = state.source?.provider || 'yandex', nativeApp = false) {
  const service = PROVIDERS.get(provider);
  if (!service) return { ok: false, error: 'Выберите музыкальный сервис' };
  const url = nativeApp && provider === 'yandex' ? 'yandexmusic://' : nativeApp && provider === 'spotify' ? 'spotify:' : service.url;
  try { await shell.openExternal(url); return { ok: true }; }
  catch { return { ok: false, error: 'Откройте плеер самостоятельно' }; }
}
function controlSnapshot() {
  return { ...snapshot(), preferences: preferences(settings), displays: screen.getAllDisplays().map((d, index) => ({ id: String(d.id), name: d.label || `Монитор ${index + 1}`, width: d.workArea.width, height: d.workArea.height })), effectiveScale, version: app.getVersion(), pairedBrowsers: browserBridge?.clients.size || 0, pairing: browserBridge?.pairing || null, controlCapture };
}
async function openControls(page = 'home') {
  if (!['home', 'sources', 'appearance', 'shortcuts', 'updates'].includes(page)) return { ok: false, error: 'Неизвестный раздел' };
  try { await controls.open(page); return { ok: true }; }
  catch (error) { return { ok: false, error: error.message }; }
}
function endControlCapture() {
  if (!controlCapture) return;
  controlCapture = false; shortcuts.resume(); publish(); updateTray();
}
async function controlAction(action, value) {
  switch (action) {
    case 'export': {
      const result = await dialog.showSaveDialog(controls.window, { title: 'Экспорт настроек Liberty Wave', defaultPath: 'Liberty-Wave-settings.json', filters: [{ name: 'Настройки JSON', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
      await fs.promises.writeFile(result.filePath, JSON.stringify(exportSettings(settings, preferences), null, 2), { mode: 0o600 }); return { ok: true };
    }
    case 'import': {
      const result = await dialog.showOpenDialog(controls.window, { title: 'Импорт настроек Liberty Wave', properties: ['openFile'], filters: [{ name: 'Настройки JSON', extensions: ['json'] }] });
      if (result.canceled || !result.filePaths[0]) return { ok: true, cancelled: true };
      const file = result.filePaths[0]; if ((await fs.promises.stat(file)).size > 65536) throw new Error('Файл настроек слишком большой');
      const next = importSettings(await fs.promises.readFile(file, 'utf8'), preferences, DEFAULT_PREFERENCES);
      shortcuts.configure(next.shortcuts); Object.assign(settings, next); controlCapture = false;
      save(); restoreLayout(); refreshState(); updateTray(); return { ok: true };
    }
    case 'preferences': setPreferences(value); return { ok: true };
    case 'command': return mediaCommand(value?.command, value?.value);
    case 'source': return selectSource(value);
    case 'interaction': if (typeof value !== 'boolean') throw new Error('Некорректный режим виджета'); setInteraction(value); return { ok: true };
    case 'restore': restoreLayout(true); return { ok: true };
    case 'pair': { const pair = browserBridge.beginPairing(); publish(); return { ok: true, ...pair }; }
    case 'copyPair': if (browserBridge?.pairing?.expiresAt > Date.now()) { clipboard.writeText(browserBridge.pairing.code); return { ok: true }; } throw new Error('Код уже истёк');
    case 'revoke': browserBridge.revoke(); publish(); updateTray(); return { ok: true };
    case 'openMusic': if (!value || typeof value.nativeApp !== 'boolean') throw new Error('Некорректный сервис'); return openMusic(value.provider, value.nativeApp);
    case 'extension': await shell.openExternal('https://github.com/dyushaboldyusha-a11y/music-adapter/releases/latest'); return { ok: true };
    case 'capture':
      if (typeof value !== 'boolean') throw new Error('Некорректный режим записи');
      if (!value) { endControlCapture(); return { ok: true }; }
      if (!controls.window.isFocused()) throw new Error('Вернитесь в Liberty Wave');
      controlCapture = true; shortcuts.suspend(); publish(); return { ok: true };
    case 'shortcuts':
      shortcuts.configure(value); settings.shortcuts = { ...shortcuts.bindings }; controlCapture = false; save(); publish(); updateTray(); return { ok: true };
    case 'update':
      if (!['check', 'download', 'install', 'cancel'].includes(value)) throw new Error('Неизвестное действие обновления');
      if (value === 'cancel') { updater.cancel(); return { ok: true }; } return updater[value]();
    case 'quit': app.quit(); return { ok: true };
    default: throw new Error('Неизвестное действие');
  }
}
function trayImage() {
  return nativeImage.createFromPath(ICON_PATH).resize({ width: 32, height: 32, quality: 'best' });
}
async function start() {
  try { const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'widget.json'), 'utf8')); if (saved && typeof saved === 'object') settings = saved; } catch {}
  Object.assign(settings, preferences(settings));
  shortcuts = new ShortcutManager(globalShortcut, { toggleInteraction: () => setInteraction(!interaction), ...Object.fromEntries(['playPause', 'next', 'previous'].map(command => [command, () => shortcutMediaCommand(command)])), volumeUp: () => volumeQueue.step(.05), volumeDown: () => volumeQueue.step(-.05), mute: () => volumeQueue.mute(), toggleCompact: () => setPreferences({ compact: !settings.compact }) }, settings.shortcuts);
  settings.shortcuts = { ...shortcuts.bindings };
  const portableFile = process.env.PORTABLE_EXECUTABLE_FILE;
  const canInstall = process.platform === 'win32' && app.isPackaged && typeof portableFile === 'string' && path.isAbsolute(portableFile) && portableFile.toLowerCase().endsWith('.exe');
  const updateDirectory = path.join(app.getPath('userData'), 'updates');
  updater = new AppUpdater({ currentVersion: app.getVersion(), directory: updateDirectory, supported: canInstall, fetch: createUpdateFetch(net), launchInstaller: async update => {
    if (!canInstall || !fs.statSync(portableFile).isFile()) throw new Error('Не найден исходный переносимый .exe');
    const helper = path.join(updateDirectory, 'install-update.ps1');
    const source = app.isPackaged ? path.join(process.resourcesPath, 'native/install-update.ps1') : path.join(__dirname, '../native/install-update.ps1');
    fs.copyFileSync(source, helper);
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-TargetPath', portableFile, '-UpdatePath', update.filename, '-ExpectedSha256', update.sha256, '-WaitPid', String(process.pid), '-StatusPath', path.join(updateDirectory, 'last-install.json')], { detached: true, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref(); setTimeout(() => app.quit(), 250);
  } });
  updater.on('state', publish);
  controls = new ControlWindow({ BrowserWindow, ipcMain, screen, icon: nativeImage.createFromPath(ICON_PATH), getState: controlSnapshot, action: controlAction, getBounds: () => settings.controlBounds, saveBounds: value => { settings.controlBounds = value; save(); }, onBlur: endControlCapture });
  const initial = layoutForDisplays(settings[boundsKey()], screen.getAllDisplays(), settings.scale, compactLayout() ? COMPACT_SIZE : SIZE, preferences(settings));
  effectiveScale = initial.scale;
  window = new BrowserWindow({ ...initial.bounds, title: APP_NAME, icon: nativeImage.createFromPath(ICON_PATH), transparent: true, frame: false, resizable: false, maximizable: false, fullscreenable: false, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.removeMenu();
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.setZoomFactor(effectiveScale);
  window.on('move', () => { settings[boundsKey()] = window.getBounds(); save(); clearTimeout(snapTimer); snapTimer = setTimeout(() => { if (window.isDestroyed()) return; const before = window.getBounds(), after = snapBounds(before, screen.getAllDisplays(), preferences(settings)); if (before.x !== after.x || before.y !== after.y) window.setBounds(after); }, 180); });
  visibility = new AutoHide(hidden => { clearTimeout(fadeTimer); if (hidden) { publish(); fadeTimer = setTimeout(() => { if (visibility.hidden && !window.isDestroyed()) window.hide(); }, 250); } else { window.showInactive(); publish(); } });
  placement = watchDisplays(window, screen, { getScale: () => preferences(settings).scale, getPreferences: () => preferences(settings), shouldShow: () => !visibility.hidden, getSize: () => compactLayout() ? COMPACT_SIZE : SIZE, onLayout: layout => {
    effectiveScale = layout.scale; settings[boundsKey()] = layout.bounds; save(); publish();
  } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const authorized = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  ipcMain.handle('widget:controls-open', (event, page) => authorized(event) && interaction ? openControls(page) : { ok: false });
  ipcMain.handle('widget:get-state', event => authorized(event) ? snapshot() : null);
  ipcMain.handle('widget:command', async (event, command, value) => {
    try {
      if (!authorized(event) || !interaction) throw new Error(`Включите управление: ${interactionShortcut()}`);
      return await mediaCommand(command, value);
    } catch (error) { return { ok: false, error: error.message }; }
  });
  tray = new Tray(trayImage());
  tray.on('click', () => openControls());
  tray.on('right-click', () => openControls());
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
  if (process.platform === 'win32' && !demo) {
    audio = new WindowsAudio(app.isPackaged ? path.join(process.resourcesPath, 'native/windows-audio.ps1') : path.join(__dirname, '../native/windows-audio.ps1'));
    let previousAudioState = '';
    audio.on('state', value => { const key = JSON.stringify(value); if (key !== previousAudioState) { previousAudioState = key; refreshState(); } });
    audio.on('level', value => { if (state.source?.kind === 'app' && state.source?.appId === value.target) sendAudioLevel(value); });
    audio.start();
  }
  media.on('state', value => { const changed = JSON.stringify([value.connected, value.selection, value.sources?.map(s => [s.id,s.title])]) !== JSON.stringify([state.connected, state.selection, state.sources?.map(s => [s.id,s.title])]); if (value.source?.id !== state.source?.id || !value.playing) sendAudioLevel({ available: false, level: 0 }); mediaState = value; refreshState(); if (changed) updateTray(); });
  browserBridge.on('level', value => { if (value.sourceId === state.source?.id) sendAudioLevel(value); });
  browserBridge.on('change', () => controls.publish());
  media.start();
  updateTray();
  if (!demo && !process.argv.includes('--widget-only')) await openControls();
}
function sendAudioLevel(value) { audioLevel = state.playing ? value : { available: false, level: 0 }; if (window && !window.isDestroyed()) window.webContents.send('widget:audio-level', audioLevel); }
app.on('before-quit', () => { controls?.dispose(); updater?.stop(); placement?.dispose(); visibility?.dispose(); clearTimeout(fadeTimer); clearTimeout(snapTimer); clearTimeout(saveTimer); if (window && !window.isDestroyed()) { settings[boundsKey()] = window.getBounds(); try { fs.writeFileSync(path.join(app.getPath('userData'), 'widget.json'), JSON.stringify(settings)); } catch {} } audio?.stop(); media?.stop(); browserBridge?.stop(); shortcuts?.stop(); globalShortcut.unregisterAll(); tray?.destroy(); });
app.on('window-all-closed', () => app.quit());
