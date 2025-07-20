const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  send: (channel, data) => {
    const validChannels = [
      'search-torrents',
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
  invoke: (channel, data) => {
    const validChannels = [
      'start-stream',
      'stop-stream',
      'launch-media-player'
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
  },
  receive: (channel, func) => {
    const validChannels = [
      'search-results',
      'stream-started',
      'stream-stopped',
      'stream-error',
      'download-progress',
      'media-player-ready',
      'media-player-launched',
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
