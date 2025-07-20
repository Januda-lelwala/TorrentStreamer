# Torrent Streamer

A desktop application built with Electron that allows you to search for and stream torrents in real-time.

## Features

- Search for torrents
- Stream video content directly in the app
- Real-time download progress tracking
- Clean and intuitive user interface
- Cross-platform support (Windows, macOS, Linux)

## Installation

1. Make sure you have [Node.js](https://nodejs.org/) installed (v14 or higher)
2. Clone this repository
3. Install dependencies:
   ```bash
   npm install
   ```

## Development

To start the application in development mode:

```bash
npm run dev
```

## Building the Application

To create a production build for your current platform:

```bash
npm run build
```

The built application will be available in the `dist` directory.

## Usage

1. Enter a search term in the search bar
2. Click on a result to start streaming
3. Use the video player controls to manage playback

## Dependencies

- Electron - For building cross-platform desktop apps
- WebTorrent - For streaming torrents

## License

MIT
