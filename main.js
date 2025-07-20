import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import TorrentManager from './src/core/TorrentManager.js';
import torrentSearch from 'torrent-search-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let torrentManager;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false, // Disable Node.js integration in the renderer
      contextIsolation: true, // Enable context isolation
      enableRemoteModule: false, // Disable remote module
      preload: path.join(__dirname, 'src/preload.js') // Use a preload script
    }
  });

  mainWindow.loadFile('src/renderer/index.html');
  
  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Initialize torrent manager
  torrentManager = new TorrentManager(mainWindow);
}

app.whenReady().then(() => {
  try {
    createWindow();
  } catch (error) {
    console.error('Failed to create window:', error);
    dialog.showErrorBox('Application Error', `Failed to initialize the application: ${error.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  try {
    if (mainWindow === null) {
      createWindow();
    }
  } catch (error) {
    console.error('Error reactivating window:', error);
    dialog.showErrorBox('Window Error', `Failed to reactivate the application window: ${error.message}`);
  }
});

// IPC Handlers
console.log('[Main] Registering IPC handlers...');
ipcMain.on('search-torrents', async (event, query) => {
  console.log(`[Main] Received search request for: "${query}"`);
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    console.log('[Main] Invalid search query');
    event.reply('search-results', []);
    return;
  }
  try {
    console.log('[Main] Starting torrent-search-api search...');
    const results = await torrentSearch.search(query, 'All', 20);
    // Map and fetch magnet links for each result
    const resultsWithMagnets = await Promise.all(results.map(async (result) => {
      try {
        const magnet = await torrentSearch.getMagnet(result);
        return {
          ...result,
          name: result.title || result.name || '',
          magnet,
          seeders: result.seeds ?? result.seeders,
          leechers: result.peers ?? result.leechers,
        };
      } catch (e) {
        return null;
      }
    }));
    // Filter out any that failed to get a magnet
    const safeResults = resultsWithMagnets.filter(r => r && r.magnet && typeof r.magnet === 'string' && r.magnet.startsWith('magnet:'));
    console.log(`[Main] Search completed, found ${safeResults.length} valid results`);
    event.reply('search-results', safeResults);
  } catch (error) {
    console.error('[Main] Error in torrent-search-api:', {
      message: error.message,
      stack: error.stack,
      query: query
    });
    event.reply('search-results', []);
  }
});

console.log('[Main] Registering start-stream handler');
ipcMain.handle('start-stream', (event, magnetURI) => {
  console.log('[Main] start-stream IPC handler called with magnet:', magnetURI);
  return torrentManager.startStream(magnetURI).then(result => {
    console.log('[Main] startStream completed successfully');
    return result;
  }).catch(error => {
    console.error('[Main] Error in startStream:', error);
    throw error;
  });
});

console.log('[Main] Registering stop-stream handler');
ipcMain.handle('stop-stream', () => {
  console.log('[Main] stop-stream IPC handler called');
  return torrentManager.stopStream().then(() => {
    console.log('[Main] stopStream completed successfully');
  }).catch(error => {
    console.error('[Main] Error in stopStream:', error);
    throw error;
  });
});

// Handle window-all-closed event on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Recreate window when dock icon is clicked on macOS
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
