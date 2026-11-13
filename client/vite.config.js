import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig(({ mode }) => {
  // Read only PORT in Vite's Node process; backend secrets never enter the client.
  const backendEnv = loadEnv(mode, backendRoot, 'PORT');
  const backendPort = process.env.PORT || backendEnv.PORT || '3000';
  const target = process.env.API_PROXY_TARGET || `http://127.0.0.1:${backendPort}`;

  return {
    server: {
      proxy: {
        '/api': { target, changeOrigin: true },
      },
    },
  };
});
