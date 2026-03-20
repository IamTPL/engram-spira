import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    devtools({
      autoname: true,
      locator: {
        targetIDE: 'vscode',
        componentLocation: true,
        jsxLocation: true,
      },
    }),
    solid(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3002,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    // Target modern browsers — smaller output, no legacy polyfills
    target: 'es2020',
    // Raise warning threshold slightly (Three.js chunk is intentionally large)
    chunkSizeWarningLimit: 600,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core Solid.js runtime — always needed, cache aggressively
          if (id.includes('node_modules/solid-js')) return 'solid';
          // Routing — changes rarely
          if (id.includes('@solidjs/router')) return 'solid';
          // tanstack-query — separate since it's large
          if (id.includes('@tanstack')) return 'query';
          // Three.js — already lazy-loaded, keep isolated
          if (id.includes('three')) return 'three';
          // lucide icons — large icon set, shared across all pages
          if (id.includes('lucide-solid')) return 'icons';
        },
      },
    },
  },
});
