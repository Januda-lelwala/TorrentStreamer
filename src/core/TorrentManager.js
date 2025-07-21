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
    this.isPaused = false;
    this.selectedFiles = [];
    this.progressInterval = null;
    this.mediaPlayerCheckInterval = null;
    this.pausedTorrentInfo = null;
    this.baselineDownloaded = 0; // Track previously downloaded bytes for resume
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
      console.log('[TorrentManager] Torrent destroyed');
      this.currentTorrent.destroy();
      this.currentTorrent = null;
      this.isPaused = false; // Reset pause state
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
      
      // Reset baseline downloaded for new stream
      this.baselineDownloaded = 0;
      
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
              
              // Send initial progress immediately
              const sendProgress = () => {
                if (!this.currentTorrent || !this.mainWindow || this.mainWindow.isDestroyed()) {
                  return;
                }
                
                const progress = {
                  progress: Math.round(this.currentTorrent.progress * 10000) / 100,
                  downloadSpeed: this.currentTorrent.downloadSpeed || 0,
                  uploadSpeed: this.currentTorrent.uploadSpeed || 0,
                  downloaded: this.currentTorrent.downloaded || 0,
                  uploaded: this.currentTorrent.uploaded || 0,
                  totalSize: this.currentTorrent.length || 0,
                  ratio: this.currentTorrent.ratio || 0,
                  timeRemaining: this.currentTorrent.done ? 0 : (this.currentTorrent.timeRemaining || 0),
                  numPeers: this.currentTorrent.numPeers || 0,
                  path: this.currentTorrent.path || '',
                  name: this.currentTorrent.name || '',
                  done: this.currentTorrent.done || false
                };
                

                
                this.mainWindow.webContents.send('download-progress', progress);
              };
              
              // Send initial progress
              sendProgress();
              
              // Set up interval for regular updates
              this.progressInterval = setInterval(() => {
                sendProgress();
              }, 1000);
            };
            
            // Call updateProgress immediately to show initial state
            updateProgress();
            
            // Set minimum download size for media player readiness
            const minDownloadSize = 1024 * 1024; // 1MB minimum before enabling media player launch
            
            // Function to check if media player is ready
            let mediaPlayerReady = false;
            const checkMediaPlayerReady = () => {
              if (!mediaPlayerReady && this.currentTorrent) {
                const downloaded = this.currentTorrent.downloaded || 0;
                const fileExists = fs.existsSync(selectedFilePath);
                
                console.log(`[DEBUG] Checking media player readiness: ${downloaded} bytes downloaded, file exists: ${fileExists}`);
                
                // Enable media player if we have enough data OR file exists
                if (downloaded > minDownloadSize || fileExists) {
                  console.log('[DEBUG] Media player ready condition met, sending event');
                  mediaPlayerReady = true;
                  this.mainWindow.webContents.send('media-player-ready', {
                    filePath: selectedFilePath,
                    fileName: file.name,
                    downloaded: downloaded
                  });
                }
              }
            };
            
            // Check immediately after torrent is ready
            setTimeout(() => checkMediaPlayerReady(), 1000);
            
            // Set up periodic check every 2 seconds
            const mediaPlayerCheckInterval = setInterval(() => {
              if (mediaPlayerReady || !this.currentTorrent) {
                clearInterval(mediaPlayerCheckInterval);
                return;
              }
              checkMediaPlayerReady();
            }, 2000);
            
            // Handle download progress
            torrent.on('download', () => {
              try {
                updateProgress();
                checkMediaPlayerReady();
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


  async launchMediaPlayer() {
    try {
      if (!this.currentTorrent) {
        throw new Error('No active torrent to launch media player for');
      }
      
      // Find the selected video file
      const supportedExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov'];
      const videoFiles = this.currentTorrent.files.filter(f => 
        supportedExts.some(ext => f.name.toLowerCase().endsWith(ext))
      );
      
      if (videoFiles.length === 0) {
        throw new Error('No supported video file found in torrent');
      }
      
      const file = videoFiles.reduce((a, b) => a.length > b.length ? a : b);
      const selectedFilePath = path.join(this.tempDir, file.path);
      
      // Check if file exists and has some data
      if (!fs.existsSync(selectedFilePath)) {
        throw new Error('Media file not found. Please wait for download to start.');
      }
      
      // Build VLC arguments
      const vlcArgs = [
        '--fullscreen',
        '--no-video-title-show',
        '--no-osd',
        selectedFilePath
      ];
      
      // Determine VLC path based on OS
      let vlcPath;
      if (process.platform === 'darwin') {
        vlcPath = '/Applications/VLC.app/Contents/MacOS/VLC';
      } else if (process.platform === 'win32') {
        vlcPath = 'vlc';
      } else {
        vlcPath = 'vlc';
      }
      
      // Check if VLC exists on macOS
      if (process.platform === 'darwin' && !fs.existsSync(vlcPath)) {
        throw new Error('VLC not found at /Applications/VLC.app/Contents/MacOS/VLC. Please install VLC Media Player.');
      }
      
      // Kill existing VLC process if running
      if (this.vlcProcess) {
        this.vlcProcess.kill();
      }
      
      this.vlcProcess = spawn(vlcPath, vlcArgs);
      console.log('[TorrentManager] VLC started successfully with path:', vlcPath);
      
      // Handle VLC process errors
      this.vlcProcess.on('error', (error) => {
        console.error('[TorrentManager] VLC process error:', error);
        let errorMessage = 'Failed to start VLC player';
        if (error.code === 'ENOENT') {
          errorMessage = 'VLC Media Player not found. Please install VLC from https://www.videolan.org/vlc/';
        }
        this.mainWindow.webContents.send('stream-error', errorMessage);
      });
      
      // Handle VLC process exit
      this.vlcProcess.on('exit', (code, signal) => {
        console.log(`[TorrentManager] VLC process exited with code ${code} and signal ${signal}`);
        if (code !== 0 && code !== null) {
          const errorMessage = `VLC exited unexpectedly with code ${code}`;
          this.mainWindow.webContents.send('stream-error', errorMessage);
        }
      });
      
      // Notify that VLC has been launched
      this.mainWindow.webContents.send('media-player-launched', {
        filePath: selectedFilePath,
        fileName: file.name
      });
      
      return {
        success: true,
        filePath: selectedFilePath,
        fileName: file.name
      };
      
    } catch (error) {
      console.error('[TorrentManager] Error launching media player:', error);
      this.mainWindow.webContents.send('stream-error', error.message);
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
        this.isPaused = false; // Reset pause state
        this.pausedTorrentInfo = null; // Clear paused torrent info
        this.baselineDownloaded = 0; // Reset baseline downloaded
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

  startProgressMonitoring() {
    if (!this.currentTorrent) {
      console.log('[TorrentManager] No current torrent for progress monitoring');
      return;
    }

    // Clear any existing interval
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
    
    // Reset debug counter
    this.progressDebugCount = 0;

    const sendProgress = () => {
      if (!this.currentTorrent) return;
      
      // Calculate actual downloaded including baseline from previous sessions
      const currentDownloaded = (this.currentTorrent.downloaded || 0);
      const totalDownloaded = currentDownloaded + this.baselineDownloaded;
      
      const progress = {
        progress: Math.round((this.currentTorrent.progress || 0) * 100),
        downloadSpeed: this.currentTorrent.downloadSpeed || 0, // Keep in bytes/s
        uploadSpeed: this.currentTorrent.uploadSpeed || 0, // Keep in bytes/s
        downloaded: totalDownloaded, // Keep in bytes
        length: this.currentTorrent.length || 0, // Keep in bytes
        numPeers: this.currentTorrent.numPeers || 0,
        ratio: Math.round((this.currentTorrent.ratio || 0) * 100) / 100,
        timeRemaining: this.currentTorrent.timeRemaining || 0,
        name: this.currentTorrent.name || 'Unknown',
        baselineDownloaded: this.baselineDownloaded, // Keep in bytes
        currentSessionDownloaded: currentDownloaded // Keep in bytes
      };
      
      // Debug logging for first few progress updates
      if (this.progressDebugCount < 3) {
        console.log('[DEBUG] Progress data being sent (all in bytes):', {
          downloaded: progress.downloaded,
          downloadedMB: Math.round(progress.downloaded / 1024 / 1024 * 100) / 100,
          downloadSpeed: progress.downloadSpeed,
          downloadSpeedMBps: Math.round(progress.downloadSpeed / 1024 / 1024 * 100) / 100,
          baselineDownloaded: progress.baselineDownloaded,
          currentSessionDownloaded: progress.currentSessionDownloaded
        });
        this.progressDebugCount = (this.progressDebugCount || 0) + 1;
      }
      
      this.mainWindow.webContents.send('download-progress', progress);
    };

    // Send initial progress
    sendProgress();
    
    // Set up interval for regular updates
    this.progressInterval = setInterval(() => {
      sendProgress();
    }, 1000);

    console.log('[TorrentManager] Progress monitoring started');
  }

  startMediaPlayerReadinessCheck() {
    if (!this.currentTorrent) {
      console.log('[TorrentManager] No current torrent for media player readiness check');
      return;
    }

    // Clear any existing interval
    if (this.mediaPlayerCheckInterval) {
      clearInterval(this.mediaPlayerCheckInterval);
    }

    // Find video files (check both selected and all video files as fallback)
    const supportedExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov'];
    let videoFiles = this.currentTorrent.files.filter(f => 
      supportedExts.some(ext => f.name.toLowerCase().endsWith(ext)) && f.selected
    );
    
    // Fallback: if no selected video files, use all video files
    if (videoFiles.length === 0) {
      videoFiles = this.currentTorrent.files.filter(f => 
        supportedExts.some(ext => f.name.toLowerCase().endsWith(ext))
      );
      console.log(`[TorrentManager] No selected video files found, using all video files (${videoFiles.length})`);
    }
    
    if (videoFiles.length === 0) {
      console.log('[TorrentManager] No video files found for media player check');
      return;
    }

    const file = videoFiles.reduce((a, b) => a.length > b.length ? a : b);
    const selectedFilePath = path.join(this.tempDir, file.path);
    const minDownloadSize = 1024 * 1024; // 1MB minimum
    
    let mediaPlayerReady = false;
    const checkMediaPlayerReady = () => {
      if (!mediaPlayerReady && this.currentTorrent) {
        const downloaded = this.currentTorrent.downloaded || 0;
        const fileExists = fs.existsSync(selectedFilePath);
        
        console.log(`[DEBUG] Checking media player readiness: ${downloaded} bytes downloaded, file exists: ${fileExists}`);
        
        if (downloaded > minDownloadSize || fileExists) {
          console.log('[DEBUG] Media player ready condition met, sending event');
          mediaPlayerReady = true;
          this.mainWindow.webContents.send('media-player-ready', {
            filePath: selectedFilePath,
            fileName: file.name,
            downloaded: downloaded
          });
          
          // Clear the interval since we're ready
          if (this.mediaPlayerCheckInterval) {
            clearInterval(this.mediaPlayerCheckInterval);
            this.mediaPlayerCheckInterval = null;
          }
        }
      }
    };
    
    // Check immediately
    setTimeout(() => checkMediaPlayerReady(), 1000);
    
    // Set up periodic check every 2 seconds
    this.mediaPlayerCheckInterval = setInterval(() => {
      if (mediaPlayerReady || !this.currentTorrent) {
        clearInterval(this.mediaPlayerCheckInterval);
        this.mediaPlayerCheckInterval = null;
        return;
      }
      checkMediaPlayerReady();
    }, 2000);

    console.log('[TorrentManager] Media player readiness check started');
  }

  async pauseStream() {
    try {
      if (!this.currentTorrent) {
        throw new Error('No active torrent to pause');
      }

      if (this.isPaused) {
        console.log('[TorrentManager] Stream is already paused');
        return { success: true, message: 'Stream is already paused' };
      }

      // Store torrent information for resume
      this.pausedTorrentInfo = {
        magnetURI: this.currentTorrent.magnetURI,
        infoHash: this.currentTorrent.infoHash,
        name: this.currentTorrent.name,
        downloadedBytes: this.currentTorrent.downloaded || 0,
        selectedFiles: this.currentTorrent.files.filter(file => file.selected).map(file => ({
          path: file.path,
          name: file.name,
          length: file.length
        }))
      };

      console.log(`[TorrentManager] Storing torrent info for resume:`, {
        name: this.pausedTorrentInfo.name,
        selectedFiles: this.pausedTorrentInfo.selectedFiles.length,
        downloaded: this.pausedTorrentInfo.downloadedBytes
      });

      // Clear intervals first
      if (this.progressInterval) {
        clearInterval(this.progressInterval);
        this.progressInterval = null;
      }

      if (this.mediaPlayerCheckInterval) {
        clearInterval(this.mediaPlayerCheckInterval);
        this.mediaPlayerCheckInterval = null;
      }

      // Completely destroy the torrent to stop all downloading
      await new Promise((resolve) => {
        this.currentTorrent.destroy({ destroyStore: false }, () => {
          console.log('[TorrentManager] Torrent destroyed for pause');
          resolve();
        });
      });

      this.currentTorrent = null;
      this.isPaused = true;

      console.log('[TorrentManager] Stream paused - torrent destroyed');
      this.mainWindow.webContents.send('stream-paused', {
        message: 'Download paused',
        torrentName: this.pausedTorrentInfo.name
      });

      return { success: true, message: 'Stream paused successfully' };
    } catch (error) {
      console.error('[TorrentManager] Error pausing stream:', error);
      this.mainWindow.webContents.send('stream-error', `Failed to pause: ${error.message}`);
      throw error;
    }
  }

  async resumeStream() {
    try {
      if (!this.isPaused || !this.pausedTorrentInfo) {
        console.log('[TorrentManager] Stream is not paused or no paused torrent info');
        return { success: true, message: 'Stream is not paused' };
      }

      console.log('[TorrentManager] Resuming stream from stored info:', this.pausedTorrentInfo.name);

      // Recreate the torrent from the stored magnet URI
      return new Promise((resolve, reject) => {
        const torrent = this.client.add(this.pausedTorrentInfo.magnetURI, { path: this.tempDir });
        
        if (!torrent) {
          reject(new Error('Failed to recreate torrent'));
          return;
        }

        this.currentTorrent = torrent;

        const waitForReady = new Promise((resolveReady, rejectReady) => {
          if (torrent.ready) {
            resolveReady();
          } else {
            torrent.once('ready', resolveReady);
            torrent.once('error', rejectReady);
          }
        });

        waitForReady.then(() => {
          console.log('[TorrentManager] Torrent recreated and ready');

          // Deselect all files first
          torrent.files.forEach(f => f.deselect());

          // Reselect the previously selected files
          if (this.pausedTorrentInfo.selectedFiles && this.pausedTorrentInfo.selectedFiles.length > 0) {
            console.log(`[TorrentManager] Reselecting ${this.pausedTorrentInfo.selectedFiles.length} files`);
            
            this.pausedTorrentInfo.selectedFiles.forEach(selectedFileInfo => {
              const file = torrent.files.find(f => f.path === selectedFileInfo.path);
              if (file) {
                file.select();
                console.log(`[TorrentManager] Reselected file: ${file.name}`);
              }
            });
          } else {
            // Fallback: select the largest video file
            const supportedExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov'];
            const videoFiles = torrent.files.filter(f => 
              supportedExts.some(ext => f.name.toLowerCase().endsWith(ext))
            );
            if (videoFiles.length > 0) {
              const file = videoFiles.reduce((a, b) => a.length > b.length ? a : b);
              file.select();
              console.log('[TorrentManager] Reselected largest video file:', file.name);
            }
          }

          // Set baseline downloaded amount for accurate progress reporting
          this.baselineDownloaded = this.pausedTorrentInfo.downloadedBytes || 0;
          console.log(`[TorrentManager] Set baseline downloaded: ${this.baselineDownloaded} bytes`);

          // Restart monitoring
          this.startProgressMonitoring();
          this.startMediaPlayerReadinessCheck();

          // Clear paused state
          this.isPaused = false;
          this.pausedTorrentInfo = null;

          console.log('[TorrentManager] Stream resumed - torrent recreated');
          this.mainWindow.webContents.send('stream-resumed', {
            message: 'Download resumed',
            torrentName: torrent.name
          });

          resolve({ success: true, message: 'Stream resumed successfully' });
        }).catch((error) => {
          console.error('[TorrentManager] Error waiting for torrent ready on resume:', error);
          reject(error);
        });
      });
    } catch (error) {
      console.error('[TorrentManager] Error resuming stream:', error);
      this.mainWindow.webContents.send('stream-error', `Failed to resume: ${error.message}`);
      throw error;
    }
  }

  getPauseState() {
    return {
      isPaused: this.isPaused,
      hasActiveTorrent: !!this.currentTorrent
    };
  }
}

export default TorrentManager;
