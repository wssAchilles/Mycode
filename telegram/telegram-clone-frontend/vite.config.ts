/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  // Required for dynamic imports inside module workers (Rust/WASM loader, etc).
  // IIFE worker bundles cannot be code-split.
  worker: {
    format: 'es',
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      workbox: {
        cleanupOutdatedCaches: true,
        // Industrial defaults: cache hashed assets aggressively, keep HTML fresh.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        runtimeCaching: [
          // Never cache chat/sync APIs: correctness beats cache hit rate for mutable state.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/messages/') || url.pathname.startsWith('/api/sync/'),
            handler: 'NetworkOnly',
          },
          // App shell / SPA navigations: prefer fresh HTML, fallback to cache on flaky network.
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 24 * 60 * 60,
              },
            },
          },
          // Avatars / thumbnails: stale-while-revalidate for instant UI with background refresh.
          {
            urlPattern: ({ request, url }) =>
              request.destination === 'image' &&
              (url.pathname.startsWith('/api/uploads/') || url.pathname.startsWith('/uploads/')),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'avatars-thumbs',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 14 * 24 * 60 * 60,
              },
            },
          },
          // Generic images.
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
            },
          },
          // Large media should not be silently cached (storage pressure).
          {
            urlPattern: ({ request }) => request.destination === 'video' || request.destination === 'audio',
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'Telegram Clone',
        short_name: 'Telegram',
        description: 'High-performance chat application',
        theme_color: '#1f1f1f',
        background_color: '#1f1f1f',
        display: 'standalone',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
    css: true,
  },
});
