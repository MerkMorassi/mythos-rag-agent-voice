import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 4000,
      strictPort: true, // Fail if port is taken, don't try next available
      open: true        // Auto-open browser
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    }
  };
});