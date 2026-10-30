const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('musicWidget', {
  getState: () => ipcRenderer.invoke('widget:get-state'),
  openControls: page => ipcRenderer.invoke('widget:controls-open', page),
  command: (command, value) => ipcRenderer.invoke('widget:command', command, value),
  onAudioLevel: callback => { const listener = (_event, level) => callback(level); ipcRenderer.on('widget:audio-level', listener); return () => ipcRenderer.removeListener('widget:audio-level', listener); },
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('widget:state', listener); return () => ipcRenderer.removeListener('widget:state', listener); }
});
