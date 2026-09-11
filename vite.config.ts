import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so dist/index.html also works from static mounts and file:// previews.
  base: './',
  build: {
    emptyOutDir: false
  }
});
