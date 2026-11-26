/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  // Required for dynamic imports inside module workers (Rust/WASM loader, etc).
  // IIFE worker bundles cannot be code-split.
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  plugins: [
    tailwindcss(),
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        // Workbox precache manifest will be injected at this token.
        injectionPoint: 'self.__WB_MANIFEST',
      },
      workbox: {
        cleanupOutdatedCaches: true,
        // Industrial defaults: cache hashed assets aggressively, keep HTML fresh.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,ico,png,svg,webp,woff2,wasm}'],
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
              networkTimeoutSeconds: 2,
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 5 * 60,
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
        theme_color: '#FFFFFF',
        background_color: '#FFFFFF',
        display: 'standalone',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('/react/')
            || id.includes('/react-dom/')
            || id.includes('/react-router')
            || id.includes('/scheduler/')
          ) {
            return 'react-vendor';
          }
          if (
            id.includes('/react-markdown/')
            || id.includes('/remark-')
            || id.includes('/rehype-')
            || id.includes('/unified/')
            || id.includes('/micromark')
            || id.includes('/mdast-')
            || id.includes('/hast-')
            || id.includes('/unist-')
            || id.includes('/vfile')
          ) {
            return 'markdown-vendor';
          }
          if (
            id.includes('/socket.io-client/')
            || id.includes('/engine.io-client/')
            || id.includes('/socket.io-parser/')
          ) {
            return 'realtime-vendor';
          }
          if (
            id.includes('/@radix-ui/')
            || id.includes('/radix-ui/')
            || id.includes('/cmdk/')
          ) {
            return 'radix-vendor';
          }
          if (
            id.includes('/recharts/')
            || id.includes('/d3-')
            || id.includes('/victory-vendor/')
          ) {
            return 'charts-vendor';
          }
          if (id.includes('/@tanstack/')) {
            return 'virtual-list';
          }
          if (id.includes('/framer-motion/') || id.includes('/motion-')) {
            return 'animation';
          }
          if (id.includes('/animejs/')) {
            return 'animejs';
          }
          if (id.includes('/lucide-react/')) {
            return 'icons';
          }
          if (
            id.includes('/axios/')
            || id.includes('/dexie/')
            || id.includes('/idb-keyval/')
            || id.includes('/immer/')
            || id.includes('/zustand/')
            || id.includes('/tweetnacl')
            || id.includes('/comlink/')
            || id.includes('/tailwind-merge/')
            || id.includes('/clsx/')
          ) {
            return 'core-vendor';
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
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
