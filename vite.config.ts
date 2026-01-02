
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 4000, // Default local dev port
      strictPort: false, // Allow fallback if taken
      host: true, // Listen on all addresses (0.0.0.0) for Docker/Network access
      open: true
    },
    preview: {
      port: 7860, // Default HF Spaces port
      strictPort: true,
      host: true, // Listen on all addresses (0.0.0.0)
      allowedHosts: ['hf.space', 'localhost']
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      'process.env.OPENL_API_KEY': JSON.stringify(env.OPENL_API_KEY),
      'process.env.HF_TOKEN': JSON.stringify(env.HF_TOKEN)
    }
  };
});
