import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { championsDataPlugin } from './championsDataPlugin';

// The calculator lives in the repo's src/, outside this app. '@vgc' points at
// it so the UI imports the real modules instead of a copy. Keep this alias in
// sync with "paths" in tsconfig.json.
const repoSrc = fileURLToPath(new URL('../src', import.meta.url));

export default defineConfig({
  plugins: [championsDataPlugin(), react()],
  resolve: {
    alias: { '@vgc': repoSrc },
  },
  optimizeDeps: {
    // Pre-bundling would skip championsDataPlugin and serve the full 10 MB
    // mod in dev. Excluded, the dev server loads the trimmed tables instead.
    exclude: ['@pkmn/mods'],
  },
  server: {
    // The dev server only serves files under ui/ by default; allow ../src.
    fs: { allow: ['.', repoSrc] },
  },
});
