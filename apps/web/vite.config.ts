import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// M0 scaffold. PWA plugin, aliases, and proxy config land in later milestones.
export default defineConfig({
  plugins: [react()],
});
