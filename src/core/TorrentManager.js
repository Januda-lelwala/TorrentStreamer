import { exec, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import torrentSearch from 'torrent-search-api';

// WebTorrent will be dynamically imported
let WebTorrent;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure torrent-search-api
torrentSearch.enablePublicProviders();

// Enable torrent search providers
torrentSearch.enableProvider('1337x');
torrentSearch.enableProvider('Yts');
torrentSearch.enableProvider('Rarbg');
torrentSearch.enableProvider('Torrentz2');

console.log('Torrent search providers enabled');

class TorrentManager {
  constructor(mainWindow) {
    this.SEARCH_LIMIT = 20;
    this.mainWindow = mainWindow;
    this.client = null;
    this.currentTorrent = null;
    this.vlcProcess = null;
    this.tempDir = path.join(os.tmpdir(), 'torrent-streamer');
    this.initialized = false;
    this.initPromise = this.initialize();
  }

  async initialize() {
    try {
      // Enable all providers
      torrentSearch.enableProvider('1337x');
      torrentSearch.enableProvider('ThePirateBay');
      torrentSearch.enableProvider('Torrentz2');
      torrentSearch.enableProvider('Rarbg');
      torrentSearch.enableProvider('Yts');
      
      // Dynamically import WebTorrent
      const webtorrentModule = await import('webtorrent');
      WebTorrent = webtorrentModule.default;
      
      // Initialize WebTorrent client
      this.client = new WebTorrent({
        maxConns: 100,
        dht: true,
        tracker: true,
        webSeeds: true
      });
      
      // Create temp directory if it doesn't exist
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }
      
      console.log('TorrentManager initialized');
      this.initialized = true;
      console.log('TorrentManager initialized successfully');
    } catch (error) {
      console.error('Error initializing TorrentManager:', error);
      console.error('Failed to initialize TorrentManager:', error);
      throw error;
    }
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.initPromise;
    }
  }

  async searchTorrents(query) {
    await this.ensureInitialized();
    if (!query || typeof query !== 'string' || query.trim() === '') {
      throw new Error('Invalid search query');
    }

    console.log(`[TorrentManager] Searching for: ${query}`);
    
    try {
      const results = await torrentSearch.search(query, 'All', this.SEARCH_LIMIT);
      console.log(`[TorrentManager] Found ${results.length} results`);
      
      // Format results for the renderer
      return results.map(torrent => ({
        name: torrent.name || 'Unknown',
        size: torrent.size ? this.formatBytes(torrent.size) : 'Unknown',
        seeds: torrent.seeds || 0,
        peers: torrent.peers || 0,
        magnet: torrent.magnet || torrent.magnetLink || '',
        provider: torrent.provider || 'Unknown',
        time: torrent.time ? new Date(torrent.time).toLocaleString() : 'N/A',
        category: torrent.category || 'Other'
      }));
    } catch (error) {
      console.error('[TorrentManager] Error searching torrents:', error);
      throw new Error(`Failed to search torrents: ${error.message}`);
    }
  }

  // Helper function to format bytes to human-readable format
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  async launchVLC(filePath) {
    console.log(`[TorrentManager] Launching VLC with file: ${filePath}`);
    return new Promise((resolve, reject) => {
      const vlcPath = '/Applications/VLC.app/Contents/MacOS/VLC';
      const vlcProcess = exec(`"${vlcPath}" "${filePath}"`);
      
      vlcProcess.on('error', (error) => {
        console.error('[TorrentManager] Failed to launch VLC:', error);
        reject(error);
      });
      
      vlcProcess.on('exit', (code) => {
        if (code === 0) {
          console.log('[TorrentManager] VLC closed successfully');
          resolve();
        } else {
          const error = new Error(`VLC process exited with code ${code}`);
          console.error('[TorrentManager]', error);
          reject(error);
        }
      });
      
      this.vlcProcess = vlcProcess;
    });
  }

  stopStream() {
    if (this.vlcProcess) {
      try {
        this.vlcProcess.kill('SIGTERM');
        this.vlcProcess = null;
      } catch (error) {
        console.error('[TorrentManager] Failed to stop VLC:', error);
      }
    }

    if (this.currentTorrent) {
      this.currentTorrent.destroy();
      this.currentTorrent = null;
    }

    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }

    return Promise.resolve();
  }

  async startStream(magnetURI) {
    try {
      await this.ensureInitialized();
      console.log('[DEBUG][TorrentManager] Starting stream for magnet:', magnetURI.substring(0, 50) + '...');
      
      await this.stopStream();
      
      return new Promise((resolve, reject) => {
        let resolved = false;
        const resolveOnce = (value) => {
          if (!resolved) {
            resolved = true;
            resolve(value);
          }
        };
        const rejectOnce = (error) => {
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        };
        
        try {
          console.log('[DEBUG][TorrentManager] Adding torrent to WebTorrent client');
          const torrent = this.client.add(magnetURI, { path: this.tempDir });
          
          if (!torrent) {
            throw new Error('Failed to add torrent: torrent object is null');
          }
          
          console.log('[DEBUG][TorrentManager] Torrent added:', torrent.infoHash);
          this.currentTorrent = torrent;
          
          // Wait for torrent to be ready
          const waitForReady = new Promise((resolveReady, rejectReady) => {
            if (torrent.ready) {
              resolveReady();
            } else {
              torrent.once('ready', resolveReady);
              torrent.once('error', rejectReady);
            }
          });
          
          waitForReady.then(() => {
            console.log('[DEBUG][TorrentManager] Torrent ready:', torrent.name);
            
            // Find the largest video file
            const supportedExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov'];
            const videoFiles = torrent.files.filter(f => 
              supportedExts.some(ext => f.name.toLowerCase().endsWith(ext))
            );
            
            if (videoFiles.length === 0) {
              const errorMsg = 'No supported video file found in torrent';
              console.error('[TorrentManager]', errorMsg);
              this.mainWindow.webContents.send('stream-error', errorMsg);
              return rejectOnce(new Error(errorMsg));
            }
            
            const file = videoFiles.reduce((a, b) => a.length > b.length ? a : b);
            const selectedFilePath = path.join(this.tempDir, file.path);
            
            // Deselect all files first, then select our target file
            torrent.files.forEach(f => f.deselect());
            file.select();
            
            console.log(`[TorrentManager] Selected file: ${file.path}`);
            
            // Send initial progress
            const updateProgress = () => {
              if (this.progressInterval) {
                clearInterval(this.progressInterval);
              }
              
              this.progressInterval = setInterval(() => {
                if (!this.currentTorrent || !this.mainWindow || this.mainWindow.isDestroyed()) {
                  clearInterval(this.progressInterval);
                  this.progressInterval = null;
                  return;
                }
                
                const progress = {
                  progress: Math.round(this.currentTorrent.progress * 10000) / 100,
                  downloadSpeed: this.currentTorrent.downloadSpeed,
                  uploadSpeed: this.currentTorrent.uploadSpeed,
                  downloaded: this.currentTorrent.downloaded,
                  uploaded: this.currentTorrent.uploaded,
                  ratio: this.currentTorrent.ratio,
                  timeRemaining: this.currentTorrent.done ? 0 : this.currentTorrent.timeRemaining,
                  numPeers: this.currentTorrent.numPeers,
                  path: this.currentTorrent.path
                };
                
                this.mainWindow.webContents.send('download-progress', progress);
              }, 1000);
            };
            
            updateProgress();
            
            // Start VLC after file is selected
            try {
              const vlcArgs = [
                '--fullscreen',
                '--no-video-title-show',
                '--no-osd',
                selectedFilePath
              ];
              
              this.vlcProcess = spawn('vlc', vlcArgs);
              console.log('[TorrentManager] VLC started successfully');
            } catch (error) {
              console.error('[TorrentManager] Failed to start VLC:', error);
              this.mainWindow.webContents.send('stream-error', 'Failed to start VLC player');
              return rejectOnce(error);
            }
            
            // Handle download progress
            torrent.on('download', () => {
              try {
                updateProgress();
              } catch (error) {
                console.error('[TorrentManager] Error in download handler:', error);
                this.mainWindow.webContents.send('stream-error', `Download error: ${error.message}`);
                rejectOnce(error);
              }
            });
            
            // Handle download completion
            torrent.on('done', () => {
              console.log('[TorrentManager] Download completed');
              updateProgress();
              resolveOnce('Download completed');
            });
            
            // Handle errors
            torrent.on('error', (error) => {
              console.error('[TorrentManager] Torrent error:', error);
              this.mainWindow.webContents.send('stream-error', `Torrent error: ${error.message}`);
              rejectOnce(error);
            });
            
          }).catch(error => {
            console.error('[TorrentManager] Error in torrent ready handler:', error);
            rejectOnce(error);
          });
          
        } catch (error) {
          console.error('[TorrentManager] Error adding torrent:', error);
          rejectOnce(error);
        }
      });
    } catch (error) {
      const errorMsg = `Failed to start stream: ${error.message}`;
      console.error('[TorrentManager]', errorMsg, error);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('stream-error', errorMsg);
      }
      throw error;
    }
  }


  async stopStream() {
    await this.ensureInitialized();
    console.log('[TorrentManager] Stopping current stream');
    
    // Clear progress interval if it exists
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
    
    // Kill VLC process if it's running
    if (this.vlcProcess) {
      try {
        this.vlcProcess.kill('SIGTERM');
        console.log('[TorrentManager] VLC process terminated');
      } catch (error) {
        console.error('[TorrentManager] Error stopping VLC process:', error);
      } finally {
        this.vlcProcess = null;
      }
    }

    // Remove current torrent if it exists
    if (this.currentTorrent) {
      try {
        await new Promise((resolve) => {
          this.currentTorrent.destroy({ destroyStore: true }, () => {
            console.log('[TorrentManager] Torrent destroyed');
            resolve();
          });
        });
      } catch (error) {
        console.error('[TorrentManager] Error destroying torrent:', error);
      } finally {
        this.currentTorrent = null;
      }
    }

    // Clean up temporary files
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
        console.log('[TorrentManager] Temporary files cleaned up');
      } catch (error) {
        console.error('[TorrentManager] Error cleaning up temporary files:', error);
      }
    }
    
    console.log('[TorrentManager] Stream stopped');
  }
}

export default TorrentManager;
