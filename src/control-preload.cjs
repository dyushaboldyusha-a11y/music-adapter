const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('libertyControl', {
  getState: () => ipcRenderer.invoke('control:get-state'),
  action: (name, value) => ipcRenderer.invoke('control:action', name, value),
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('control:state', listener); return () => ipcRenderer.removeListener('control:state', listener); },
  onNavigate: callback => { const listener = (_event, page) => callback(page); ipcRenderer.on('control:navigate', listener); return () => ipcRenderer.removeListener('control:navigate', listener); }
});
