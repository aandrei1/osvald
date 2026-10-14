import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // Ionic Vue wraps Vue components; a duplicated Vue runtime would break
    // provide/inject, so keep a single copy in the workspace.
    dedupe: ['vue', 'vue-router', '@ionic/vue'],
  },

  server: {
    host: true,
    port: Number(process.env.VITE_PORT) || 5173,
  },

  preview: {
    port: 4173,
  },

  build: {
    target: 'es2022',
    sourcemap: true,
    // Capacitor serves the build from a local origin, so keep assets relative.
    assetsDir: 'assets',
  },

  optimizeDeps: {
    include: ['@ionic/vue', '@ionic/vue-router', 'pinia', 'vue-router'],
  },
});
