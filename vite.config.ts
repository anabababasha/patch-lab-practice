import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// If you rename the GitHub repo, update `base` to '/<repo-name>/'.
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toLocaleTimeString()),
  },
  base: '/patch-lab-practice/',
});
