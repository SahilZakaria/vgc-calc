import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The calculator lives in the repo's src/, outside this app. '@vgc' points at
// it so the UI imports the real modules instead of a copy. Keep this alias in
// sync with "paths" in tsconfig.json.
const repoSrc = fileURLToPath(new URL('../src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@vgc': repoSrc },
  },
  server: {
    // The dev server only serves files under ui/ by default; allow ../src.
    fs: { allow: ['.', repoSrc] },
  },
});
