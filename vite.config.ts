import { defineConfig } from 'vite';

export default defineConfig({
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
  // Tauri expects a fixed port; fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
});
