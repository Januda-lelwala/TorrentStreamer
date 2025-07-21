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
ipcMain.on('search-torrents', async (event, searchData) => {
  const { query, page = 1 } = typeof searchData === 'string' ? { query: searchData, page: 1 } : searchData;
  console.log(`[Main] Received search request for: "${query}", page: ${page}`);
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    console.log('[Main] Invalid search query');
    event.reply('search-results', { results: [], page: 1, totalPages: 0, query });
    return;
  }
  try {
    console.log('[Main] Starting torrent-search-api search...');
    // Fetch more results to support pagination (20 results per page, fetch up to 100 total)
    const resultsPerPage = 20;
    const maxResults = Math.min(100, page * resultsPerPage + 40); // Fetch extra for future pages
    const results = await torrentSearch.search(query, 'All', maxResults);
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
    
    // Paginate results
    const startIndex = (page - 1) * resultsPerPage;
    const endIndex = startIndex + resultsPerPage;
    const paginatedResults = safeResults.slice(startIndex, endIndex);
    const totalPages = Math.ceil(safeResults.length / resultsPerPage);
    
    console.log(`[Main] Search completed, found ${safeResults.length} total results, returning page ${page}/${totalPages} with ${paginatedResults.length} results`);
    event.reply('search-results', {
      results: paginatedResults,
      page,
      totalPages,
      totalResults: safeResults.length,
      query
    });
  } catch (error) {
    console.error('[Main] Error in torrent-search-api:', {
      message: error.message,
      stack: error.stack,
      query: query
    });
    event.reply('search-results', { results: [], page: 1, totalPages: 0, totalResults: 0, query });
  }
});

console.log('[Main] Registering start-stream handler');
ipcMain.handle('start-stream', async (event, magnetURI) => {
  console.log('[Main] start-stream IPC handler called with magnet:', magnetURI?.substring(0, 50) + '...');
  
  if (!magnetURI || typeof magnetURI !== 'string') {
    const error = new Error('Invalid magnet URI provided');
    console.error('[Main] Error:', error.message);
    throw error;
  }
  
  if (!magnetURI.startsWith('magnet:')) {
    const error = new Error('Invalid magnet URI format');
    console.error('[Main] Error:', error.message);
    throw error;
  }
  
  try {
    console.log('[Main] Starting torrent stream...');
    const result = await torrentManager.startStream(magnetURI);
    console.log('[Main] startStream completed successfully');
    return result;
  } catch (error) {
    console.error('[Main] Error in startStream:', error);
    throw error;
  }
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

console.log('[Main] Registering launch-media-player handler');
ipcMain.handle('launch-media-player', async (event) => {
  console.log('[Main] launch-media-player IPC handler called');
  return await torrentManager.launchMediaPlayer();
});

console.log('[Main] Registering pause-stream handler');
ipcMain.handle('pause-stream', async (event) => {
  console.log('[Main] pause-stream IPC handler called');
  return await torrentManager.pauseStream();
});

console.log('[Main] Registering resume-stream handler');
ipcMain.handle('resume-stream', async (event) => {
  console.log('[Main] resume-stream IPC handler called');
  return await torrentManager.resumeStream();
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
