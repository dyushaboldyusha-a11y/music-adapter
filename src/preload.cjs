const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('musicWidget', {
  getState: () => ipcRenderer.invoke('widget:get-state'),
  setPreferences: update => ipcRenderer.invoke('widget:preferences', update),
  openShortcuts: () => ipcRenderer.invoke('widget:shortcuts-open'),
  saveShortcuts: bindings => ipcRenderer.invoke('widget:shortcuts-save', bindings),
  cancelShortcuts: () => ipcRenderer.invoke('widget:shortcuts-cancel'),
  openTheme: () => ipcRenderer.invoke('widget:theme-open'),
  saveTheme: color => ipcRenderer.invoke('widget:theme-save', color),
  cancelTheme: () => ipcRenderer.invoke('widget:theme-cancel'),
  selectSource: id => ipcRenderer.invoke('widget:source', id),
  beginPairing: () => ipcRenderer.invoke('widget:pair'),
  copyPairingCode: () => ipcRenderer.invoke('widget:copy-pair'),
  onPairing: callback => { const listener = (_event, pair) => callback(pair); ipcRenderer.on('widget:pairing', listener); return () => ipcRenderer.removeListener('widget:pairing', listener); },
  command: (command, value) => ipcRenderer.invoke('widget:command', command, value),
  showMenu: () => ipcRenderer.send('widget:menu'),
  toggleInteraction: () => ipcRenderer.send('widget:toggle-interaction'),
  openMusic: () => ipcRenderer.invoke('widget:open-music'),
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('widget:state', listener); return () => ipcRenderer.removeListener('widget:state', listener); }
});
