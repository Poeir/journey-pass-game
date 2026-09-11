/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
  plugins: [
    react(),
    ViteImageOptimizer({
      png: {
        quality: 80,
        compressionLevel: 9,
        palette: true,
      },
      jpeg: { quality: 80 },
      jpg: { quality: 80 },
      webp: { quality: 80, lossless: false },
      svg: {
        multipass: true,
        plugins: [
          { name: 'preset-default' },
          'removeDimensions',
        ],
      },
      cache: true,
      cacheLocation: '.image-optimizer-cache',
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.woff2', 'fonts/*.woff'],
      manifest: {
        name: '5.5 Journey Pass',
        short_name: 'Journey Pass',
        theme_color: '#F05B2F',
        background_color: '#FFF3EC',
        display: 'standalone',
        start_url: '/',
        icons: [],
      },
      workbox: {
        // Precache only the small/critical hashed assets (JS, CSS, SVG, fonts).
        // HTML is intentionally excluded so the SW never shadows index.html
        // with a stale precached copy — navigation goes through the
        // NetworkFirst handler below instead.
        // Images are heavy and lazy-loaded per page — let them runtime-cache.
        // Game-state APIs are excluded so the SW never serves stale data.
        globPatterns: ['**/*.{js,css,svg,woff,woff2}'],
        navigateFallback: null,
        navigateFallbackDenylist: [/^\/api\//, /^\/docs/],
        // Apply new builds on next page load instead of waiting for every
        // tab/PWA window to close. Without these two flags, users see stale
        // bundles for days after a deploy.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Navigation requests (the HTML shell) — always try the network
            // first so users see the latest deploy. Falls back to cache only
            // if the network is unreachable within 3s.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-html',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-images',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/res\.cloudinary\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cloudinary-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('html5-qrcode')) return 'qr-scanner';
          if (id.includes('qrcode.react')) return 'qr-render';
          if (id.includes('react-router')) return 'router';
          if (id.includes('zustand')) return 'state';
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          ) {
            return 'react';
          }
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io', '.ngrok-free.dev'],
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
