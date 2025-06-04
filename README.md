# Tauri Desktop App

A desktop application built with Tauri, featuring a custom File menu and Python backend integration.

## Features

- Custom File menu with Load option
- File dialog for selecting files from the local filesystem
- Python backend integration for file processing
- Cross-platform support (Windows, macOS, Linux)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Rust (if not already installed):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. Set up Python environment:
   ```bash
   cd python-backend
   pip install -r requirements.txt
   ```

## Development

Run the development server:
```bash
npm run tauri dev
```

## Building

Build for production:
```bash
npm run tauri build
```

## Usage

1. Launch the application
2. Use the File menu and select "Load"
3. Choose a file from your local filesystem
4. The selected file path will be displayed in the application

## Project Structure

- `index.html` - Main HTML file
- `main.js` - Frontend JavaScript with Tauri API integration
- `src-tauri/` - Rust backend code
- `python-backend/` - Python scripts for backend processing
- `package.json` - Node.js dependencies and scripts