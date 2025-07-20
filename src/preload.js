const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  send: (channel, data) => {
    const validChannels = [
      'search-torrents',
      'start-stream',
      'stop-stream',
      'get-settings',
      'save-settings',
      'open-directory-dialog',
      'minimize-window',
      'maximize-window',
      'close-window'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    const validChannels = [
      'search-results',
      'stream-started',
      'stream-stopped',
      'stream-error',
      'download-progress',
      'settings-data',
      'directory-selected'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
