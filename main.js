import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

// Function to handle file loading
async function loadFile() {
  try {
    const selected = await open({
      title: 'Select a file',
      multiple: false,
      filters: [{
        name: 'Turtle Files',
        extensions: ['ttl']
      }, {
        name: 'All Files',
        extensions: ['*']
      }]
    });

    if (selected) {
      // Show the file path in the UI
      const fileInfo = document.getElementById('file-info');
      const filePath = document.getElementById('file-path');
      
      filePath.textContent = selected;
      fileInfo.style.display = 'block';
      
      // Show popup with file path
      alert(`Selected file: ${selected}`);
      
      console.log('Selected file:', selected);
    }
  } catch (error) {
    console.error('Error selecting file:', error);
  }
}

// Make the function globally available for the menu
window.loadFile = loadFile;

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  console.log('Tauri app initialized');
});