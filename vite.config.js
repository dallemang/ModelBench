import { defineConfig } from "vite";

export default defineConfig(async () => ({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      // Forward all API calls to FastAPI during Vite dev mode
      '/api': { target: 'http://localhost:8000', rewrite: path => path.replace(/^\/api/, '') },
      '/load_rdf': 'http://localhost:8000',
      '/upload_rdf': 'http://localhost:8000',
      '/upload_directory': 'http://localhost:8000',
      '/class_instances': 'http://localhost:8000',
      '/resource': 'http://localhost:8000',
      '/resource_links': 'http://localhost:8000',
      '/dump': 'http://localhost:8000',
      '/resolve_import_path': 'http://localhost:8000',
      '/graph_info': 'http://localhost:8000',
      '/clear_dataset': 'http://localhost:8000',
      '/hierarchy': 'http://localhost:8000',
      '/import_hierarchy': 'http://localhost:8000',
      '/query': 'http://localhost:8000',
      '/add_triple': 'http://localhost:8000',
      '/ai': { target: 'http://localhost:8000' },
      '/health': 'http://localhost:8000',
    },
  },
}));