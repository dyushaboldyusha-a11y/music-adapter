const path = require('node:path');

function controlBounds(saved, displays) {
  const valid = saved && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved[key]));
  const display = displays.find(d => valid && saved.x < d.workArea.x + d.workArea.width && saved.x + saved.width > d.workArea.x && saved.y < d.workArea.y + d.workArea.height && saved.y + saved.height > d.workArea.y) || displays[0];
  const area = display.workArea;
  const width = Math.min(area.width, Math.max(Math.min(760, area.width), valid ? saved.width : 1000));
  const height = Math.min(area.height, Math.max(Math.min(540, area.height), valid ? saved.height : 760));
  return { width: Math.round(width), height: Math.round(height), x: Math.round(Math.max(area.x, Math.min(valid ? saved.x : area.x + (area.width - width) / 2, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(valid ? saved.y : area.y + (area.height - height) / 2, area.y + area.height - height))) };
}

class ControlWindow {
  constructor({ BrowserWindow, ipcMain, screen, icon, getState, action, getBounds, saveBounds, onBlur }) {
    Object.assign(this, { BrowserWindow, ipcMain, screen, icon, getState, action, getBounds, saveBounds, onBlur });
    this.quitting = false;
    ipcMain.handle('control:get-state', event => this.authorized(event) ? getState() : null);
    ipcMain.handle('control:action', async (event, name, value) => {
      if (!this.authorized(event) || !this.window.isVisible()) return { ok: false, error: 'Откройте Liberty Wave' };
      try {
        if (name === 'window') {
          if (value === 'minimize') this.window.minimize();
          else if (value === 'maximize') this.window.isMaximized() ? this.window.unmaximize() : this.window.maximize();
          else if (value === 'close') this.window.hide();
          else throw new Error('Неизвестное действие окна');
          return { ok: true };
        }
        return await action(name, value);
      } catch (error) { return { ok: false, error: error.message }; }
    });
  }
  authorized(event) { return !!this.window && !this.window.isDestroyed() && event.sender === this.window.webContents && event.senderFrame === this.window.webContents.mainFrame; }
  async open(page = 'home') {
    if (!this.window || this.window.isDestroyed()) {
      const bounds = controlBounds(this.getBounds(), this.screen.getAllDisplays());
      this.window = new this.BrowserWindow({ ...bounds, minWidth: Math.min(760, bounds.width), minHeight: Math.min(540, bounds.height), title: 'Liberty Wave', icon: this.icon, frame: false, backgroundColor: '#1b1b1e', show: false, webPreferences: { preload: path.join(__dirname, 'control-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.window.removeMenu();
      this.window.webContents.on('will-navigate', event => event.preventDefault());
      this.window.webContents.on('render-process-gone', () => { this.onBlur(); this.window?.destroy(); });
      this.window.on('close', event => { if (!this.quitting) { event.preventDefault(); this.window.hide(); } });
      this.window.on('blur', this.onBlur);
      this.window.on('hide', this.onBlur);
      const save = () => { if (!this.window.isMaximized() && !this.window.isMinimized()) this.saveBounds(this.window.getBounds()); };
      this.window.on('move', save); this.window.on('resize', save);
      this.loading = this.window.loadFile(path.join(__dirname, 'control/index.html'));
    }
    await this.loading;
    if (this.window.isMinimized()) this.window.restore();
    const reachable = controlBounds(this.window.getBounds(), this.screen.getAllDisplays());
    if (!this.window.isMaximized()) this.window.setBounds(reachable);
    this.window.show(); this.window.focus();
    this.publish(); this.window.webContents.send('control:navigate', page);
  }
  publish() { if (this.window && !this.window.isDestroyed()) this.window.webContents.send('control:state', this.getState()); }
  dispose() { this.quitting = true; this.onBlur(); this.window?.destroy(); this.ipcMain.removeHandler('control:get-state'); this.ipcMain.removeHandler('control:action'); }
}
module.exports = { ControlWindow, controlBounds };
