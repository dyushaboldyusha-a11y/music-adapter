const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('musicWidget', {
  getState: () => ipcRenderer.invoke('widget:get-state'),
  command: (command, value) => ipcRenderer.invoke('widget:command', command, value),
  showMenu: () => ipcRenderer.send('widget:menu'),
  toggleInteraction: () => ipcRenderer.send('widget:toggle-interaction'),
  openMusic: () => ipcRenderer.invoke('widget:open-music'),
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('widget:state', listener); return () => ipcRenderer.removeListener('widget:state', listener); }
});
