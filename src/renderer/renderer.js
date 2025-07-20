// This file will be loaded in the renderer process
// The preload script exposes a safe API to the window

// DOM Elements
const elements = {
    searchInput: null,
    searchBtn: null,
    resultsContainer: null,
    videoPlayer: null,
    videoPlaceholder: null,
    progressContainer: null,
    progressBar: null,
    statusText: null,
    downloadSpeed: null,
    downloaded: null,
    totalSize: null,
    mediaPlayerModal: null,
    closeMediaPlayer: null,
    customVideoPlayer: null,
    customAudioPlayer: null,
    playPauseBtn: null,
    playPauseIcon: null,
    seekBar: null,
    currentTimeLabel: null,
    durationLabel: null,
    volumeSlider: null,
    muteBtn: null,
    fullscreenBtn: null,
    closeBtn: null
};

// Function to stop the current stream
async function stopStream() {
    try {
        // Call the stop-stream IPC method
        await window.api.invoke('stop-stream');
        
        // Hide the progress container
        const progressContainer = document.getElementById('progress-container');
        if (progressContainer) {
            progressContainer.style.display = 'none';
            progressContainer.classList.add('hidden');
        }
        
        // Reset progress elements
        const progressBar = document.getElementById('progressBar');
        if (progressBar) {
            progressBar.style.width = '0%';
        }
        
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = 'Download stopped';
        }
        
        const statusTextElement = document.getElementById('status-text');
        if (statusTextElement) {
            statusTextElement.textContent = '';
        }
        
        // Reset stats
        const downloadSpeedElement = document.getElementById('downloadSpeed');
        if (downloadSpeedElement) {
            downloadSpeedElement.textContent = '0 MB/s';
        }
        
        const downloadedElement = document.getElementById('downloaded');
        if (downloadedElement) {
            downloadedElement.textContent = '0 MB';
        }
        
        const totalSizeElement = document.getElementById('totalSize');
        if (totalSizeElement) {
            totalSizeElement.textContent = '0 MB';
        }
        
        const numPeersElement = document.getElementById('numPeers');
        if (numPeersElement) {
            numPeersElement.textContent = '0';
        }
        
        // Hide video placeholder
        const videoPlaceholder = document.getElementById('video-placeholder');
        if (videoPlaceholder) {
            videoPlaceholder.style.display = 'none';
        }
        
    } catch (error) {
        console.error('Error stopping stream:', error);
        
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = `Error stopping stream: ${error.message}`;
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initElements();
    setupEventListeners();
    setupIpcHandlers();
    setupMediaControls();
    setupVideoResizeHandler();
});

// IPC Event Listeners
window.api.receive('stream-started', (streamUrl) => {
    console.log('Stream started:', streamUrl);
    
    const videoPlayer = document.getElementById('video-player');
    if (!videoPlayer) {
        console.error('Video player element not found');
        return;
    }
    
    // Set the video source to the stream URL
    videoPlayer.src = streamUrl;
    
    // Show the video player and hide the placeholder
    videoPlayer.style.display = 'block';
    const videoPlaceholder = document.getElementById('video-placeholder');
    if (videoPlaceholder) {
        videoPlaceholder.style.display = 'none';
    }
    
    // Set up event listeners for the video player
    videoPlayer.addEventListener('loadedmetadata', () => {
        console.log('Video metadata loaded');
        videoPlayer.play().catch(error => {
            console.error('Error playing video:', error);
        });
    });
    
    videoPlayer.addEventListener('error', (error) => {
        console.error('Video player error:', error);
        const statusElement = document.getElementById('status-text');
        if (statusElement) {
            statusElement.textContent = 'Error loading video. Please try another stream.';
        }
    });
});

// Handle download progress updates
window.api.receive('download-progress', (progress) => {
    updateProgressDisplay(progress);
});

// Handle search results
window.api.receive('search-results', (results) => {
    displayResults(results);
});

// Handle stream errors
window.api.receive('stream-error', (error) => {
    console.error('Stream error:', error);
    const statusElement = document.getElementById('status-text');
    if (statusElement) {
        statusElement.textContent = `Error: ${error.message || 'Failed to start stream'}`;
    }
    
    // Re-enable UI elements if needed
    const streamBtn = document.getElementById('stream-btn');
    if (streamBtn) streamBtn.disabled = false;
});

// Handle stream started
window.api.receive('stream-started', (streamInfo) => {
    console.log('Stream started:', streamInfo);
    const statusElement = document.getElementById('status-text');
    if (statusElement) {
        statusElement.textContent = `VLC launched! Playing: ${streamInfo.name}`;
        statusElement.className = 'text-green-400';
    }
});

// Handle download progress
window.api.receive('download-progress', (progress) => {
    updateProgressDisplay(progress);
});

// Function to update progress display
function updateProgressDisplay(progress) {
    // Show the progress container
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.style.display = 'block';
        progressContainer.classList.remove('hidden');
    }
    
    // Update progress bar
    const progressBar = document.getElementById('progressBar');
    if (progressBar && progress.progress !== undefined) {
        const progressPercent = Math.min(progress.progress || 0, 100);
        progressBar.style.width = `${progressPercent}%`;
    }
    
    // Update status text
    const statusElement = document.getElementById('status');
    if (statusElement) {
        if (progress.progress >= 100) {
            statusElement.textContent = 'Download Complete';
        } else {
            const progressText = `Downloading... ${(progress.progress || 0).toFixed(1)}%`;
            statusElement.textContent = progressText;
        }
    }
    
    // Update download speed
    const downloadSpeedElement = document.getElementById('downloadSpeed');
    if (downloadSpeedElement) {
        const speedBytes = progress.downloadSpeed || 0;
        const speedMBps = (speedBytes / (1024 * 1024)).toFixed(2);
        downloadSpeedElement.textContent = `${speedMBps} MB/s`;
    }
    
    // Update downloaded amount
    const downloadedElement = document.getElementById('downloaded');
    if (downloadedElement) {
        const downloadedBytes = progress.downloaded || 0;
        const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
        downloadedElement.textContent = `${downloadedMB} MB`;
    }
    
    // Update total size (if available)
    const totalSizeElement = document.getElementById('totalSize');
    if (totalSizeElement) {
        const totalBytes = progress.totalSize || 0;
        const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
        totalSizeElement.textContent = `${totalMB} MB`;
    }
    
    // Update peers info if available
    if (progress.numPeers !== undefined && statusElement && progress.progress < 100) {
        const peersInfo = `${progress.numPeers} peers`;
        const statusWithPeers = `Downloading... ${(progress.progress || 0).toFixed(1)}% (${peersInfo})`;
        statusElement.textContent = statusWithPeers;
    }
}

function initElements() {
    // Main app elements
    elements.searchInput = document.getElementById('searchInput');
    elements.searchBtn = document.getElementById('searchBtn');
    elements.resultsContainer = document.getElementById('resultsContainer');
    elements.videoPlayer = document.getElementById('videoPlayer');
    elements.videoPlaceholder = document.getElementById('videoPlaceholder');
    elements.progressContainer = document.getElementById('progressContainer');
    elements.progressBar = document.getElementById('progressBar');
    elements.statusText = document.getElementById('status');
    elements.downloadSpeed = document.getElementById('downloadSpeed');
    elements.downloaded = document.getElementById('downloaded');
    elements.totalSize = document.getElementById('totalSize');

    // Media player elements
    elements.mediaPlayerModal = document.getElementById('mediaPlayerModal');
    elements.closeMediaPlayer = document.getElementById('closeMediaPlayer');
    elements.customVideoPlayer = document.getElementById('customVideoPlayer');
    elements.customAudioPlayer = document.getElementById('customAudioPlayer');
    elements.playPauseBtn = document.getElementById('playPauseBtn');
    elements.playPauseIcon = document.getElementById('playPauseIcon');
    elements.seekBar = document.getElementById('seekBar');
    elements.stopBtn = document.getElementById('stopBtn');
}

function setupEventListeners() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    const stopBtn = document.getElementById('stopBtn');
    
    if (searchBtn) {
        searchBtn.addEventListener('click', handleSearch);
    }
    
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
    
    if (stopBtn) {
        stopBtn.addEventListener('click', stopStream);
    }
    
    // Media player controls
    if (elements.mediaPlayerModal && elements.closeMediaPlayer) {
        elements.closeMediaPlayer.addEventListener('click', () => {
            elements.mediaPlayerModal.style.display = 'none';
        });
    }
}

function setupIpcHandlers() {
    // IPC handlers are now set up globally above
    // This function can be used for other setup if needed
}

// Helper function to format bytes to human readable string
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper function to format seconds to human readable time
function formatTimeDetailed(seconds) {
    if (seconds === Infinity) return '∞';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
        return `${h}h ${m}m ${s}s`;
    } else if (m > 0) {
        return `${m}m ${s}s`;
    } else {
        return `${s}s`;
    }
}

// Helper function to format time
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- Custom Modal Player Controls ---
function getCurrentMedia() {
    return elements.customVideoPlayer && !elements.customVideoPlayer.paused ? elements.customVideoPlayer :
           elements.customAudioPlayer && !elements.customAudioPlayer.paused ? elements.customAudioPlayer : null;
}

// Handle window resize to maintain aspect ratio
function handleResize() {
    const { customVideoPlayer } = elements;
    if (!customVideoPlayer) return;
    
    const container = customVideoPlayer.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    const videoRatio = customVideoPlayer.videoWidth / customVideoPlayer.videoHeight;
    const containerRatio = containerWidth / containerHeight;
    
    if (containerRatio > videoRatio) {
        // Container is wider than video aspect ratio
        customVideoPlayer.style.width = `${containerHeight * videoRatio}px`;
        customVideoPlayer.style.height = `${containerHeight}px`;
    } else {
        // Container is taller than video aspect ratio
        customVideoPlayer.style.width = `${containerWidth}px`;
        customVideoPlayer.style.height = `${containerWidth / videoRatio}px`;
    }
}

// Set up window resize handler
function setupVideoResizeHandler() {
    const { customVideoPlayer } = elements;
    if (customVideoPlayer) {
        customVideoPlayer.addEventListener('loadedmetadata', handleResize);
        window.addEventListener('resize', handleResize);
    }
}

// Set up media controls
function setupMediaControls() {
    if (elements.mediaPlayerModal) {
        // Play/Pause toggle
        elements.playPauseBtn.addEventListener('click', () => {
            const media = getCurrentMedia();
            if (!media) return;
            if (media.paused) {
                media.play();
                elements.playPauseIcon.textContent = '\u23F8'; // Pause
            } else {
                media.pause();
                elements.playPauseIcon.textContent = '\u25B6'; // Play
            }
        });

        // Update play/pause icon on play/pause
        [elements.customVideoPlayer, elements.customAudioPlayer].forEach(media => {
            media.addEventListener('play', () => {
                elements.playPauseIcon.textContent = '\u23F8';
            });
            media.addEventListener('pause', () => {
                elements.playPauseIcon.textContent = '\u25B6';
            });
        });

        // Seek bar
        [elements.customVideoPlayer, elements.customAudioPlayer].forEach(media => {
            media.addEventListener('timeupdate', () => {
                if (elements.seekBar) {
                    elements.seekBar.value = media.duration ? (media.currentTime / media.duration) * 100 : 0;
                    elements.currentTimeLabel.textContent = formatTime(media.currentTime);
                    elements.durationLabel.textContent = formatTime(media.duration);
                }
            });
            media.addEventListener('loadedmetadata', () => {
                if (elements.seekBar) {
                    elements.seekBar.max = 100;
                    elements.durationLabel.textContent = formatTime(media.duration);
                }
            });
        });
        if (elements.seekBar) {
            elements.seekBar.addEventListener('input', () => {
                const media = getCurrentMedia();
                if (media && media.duration) {
                    const seekTo = (elements.seekBar.value / 100) * media.duration;
                    elements.currentTimeLabel.textContent = formatTime(seekTo);
                }
            });
            elements.seekBar.addEventListener('change', () => {
                const media = getCurrentMedia();
                if (media && media.duration) {
                    media.currentTime = (elements.seekBar.value / 100) * media.duration;
                }
            });
        }

        // Volume
        if (elements.volumeBar) {
            elements.volumeBar.addEventListener('input', () => {
                const media = getCurrentMedia();
                if (media) {
                    media.volume = elements.volumeBar.value;
                    elements.volumeLabel.textContent = Math.round(elements.volumeBar.value * 100) + '%';
                }
            });
        }

        // Close modal
        elements.closeMediaPlayer.addEventListener('click', () => {
            elements.mediaPlayerModal.classList.add('hidden');
            // Pause and reset both players
            elements.customVideoPlayer.pause();
            elements.customAudioPlayer.pause();
            elements.customVideoPlayer.src = '';
            elements.customAudioPlayer.src = '';
        });

        // ESC key closes modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !elements.mediaPlayerModal.classList.contains('hidden')) {
                elements.closeMediaPlayer.click();
            }
        });
    }
}

// Functions
function handleSearch() {
    const query = elements.searchInput.value.trim();
    if (!query) return;
    
    // Show loading state
    elements.searchBtn.disabled = true;
    elements.searchBtn.textContent = 'Searching...';
    
    // Clear previous results
    elements.resultsContainer.innerHTML = '';
    
    // Send search request to main process
    window.api.send('search-torrents', query);
    
    // Set up a listener for search results
    window.api.receive('search-results', (results) => {
        displayResults(results);
        
        // Reset button state
        elements.searchBtn.disabled = false;
        elements.searchBtn.textContent = 'Search';
    });
}

function displayResults(results) {
    const { resultsContainer } = elements;
    // Clear previous results
    resultsContainer.innerHTML = '';
    
    if (!results || !Array.isArray(results) || results.length === 0) {
        resultsContainer.innerHTML = `
            <div class="text-center py-8 text-gray-400">
                <p>No results found. Try a different search term.</p>
            </div>
        `;
        return;
    }

    // Results are already checked at the start of the function

    try {
        // Filter out any invalid results
        const validResults = results.filter(result => 
            result && 
            result.magnet && 
            result.name && 
            typeof result.magnet === 'string' && 
            result.magnet.startsWith('magnet:')
        );

        if (validResults.length === 0) {
            resultsContainer.innerHTML = `
                <div class="text-center py-8 text-gray-400">
                    <p>No valid torrents found. Try a different search term.</p>
                </div>
            `;
            return;
        }

        // Display the valid results
        resultsContainer.innerHTML = validResults.map(result => `
            <div class="bg-gray-700 p-4 rounded-lg hover:bg-gray-600 transition-colors cursor-pointer mb-2" 
                 data-magnet="${result.magnet}">
                <h3 class="font-medium text-lg mb-1 truncate" title="${result.name}">${result.name}</h3>
                <div class="flex justify-between text-sm text-gray-400">
                    <span>${result.size || 'Unknown size'}</span>
                    <span>👥 ${result.seeds || 0} seeders</span>
                </div>
                ${result.provider ? `<div class="text-xs text-gray-500 mt-1">Source: ${result.provider}</div>` : ''}
            </div>
        `).join('');

        // Add click handlers to result items
        document.querySelectorAll('#resultsContainer > div').forEach((item, index) => {
            const result = validResults[index];
            item.addEventListener('click', () => startStream(result.magnet, result.name));
        });

    } catch (error) {
        console.error('Error displaying results:', error);
        resultsContainer.innerHTML = `
            <div class="text-center py-8 text-red-400">
                <p>Error displaying results. Please try again.</p>
                <p class="text-xs mt-2">${error.message}</p>
            </div>
        `;
    }
}

async function startStream(magnet, name) {
    // Show loading state
    const statusElement = document.getElementById('status-text');
    if (statusElement) {
        statusElement.textContent = 'Starting stream...';
    }
    
    // Show the progress container immediately
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.style.display = 'block';
        progressContainer.classList.remove('hidden');
    }
    
    // Initialize progress display
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = 'Connecting to peers...';
    }
    
    // Hide any existing video
    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) {
        videoPlayer.style.display = 'none';
        videoPlayer.src = '';
    }
    
    // Show the video placeholder
    const videoPlaceholder = document.getElementById('video-placeholder');
    if (videoPlaceholder) {
        videoPlaceholder.style.display = 'flex';
        videoPlaceholder.textContent = 'Loading stream...';
    }
    
    try {
        // Send request to start the stream using invoke for proper response handling
        const result = await window.api.invoke('start-stream', magnet);
        
        // Update status
        if (statusElement) {
            statusElement.textContent = 'Stream started - VLC should be opening...';
        }
    } catch (error) {
        console.error('Error starting stream:', error);
        
        // Show error state
        if (statusElement) {
            statusElement.textContent = `Error: ${error.message}`;
        }
        
        // Hide progress container on error
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        
        // Show error in video placeholder
        if (videoPlaceholder) {
            videoPlaceholder.textContent = `Failed to start stream: ${error.message}`;
        }
    }
}

