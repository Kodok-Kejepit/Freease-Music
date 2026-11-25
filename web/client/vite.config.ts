import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Saat pengembangan, /api & /voice diteruskan ke server Node (npm run dev di folder server).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Freease',
        short_name: 'Freease',
        description: 'Musik, anime, manga, manhwa & manhua tanpa iklan — lirik, karaoke, asisten suara, Freease Stream.',
        lang: 'id',
        theme_color: '#0A0A10',
        background_color: '#0A0A10',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/voice\//],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('ytimg.com') || url.hostname.endsWith('ggpht.com') || url.hostname.endsWith('googleusercontent.com'),
            handler: 'CacheFirst',
            options: { cacheName: 'artwork', expiration: { maxEntries: 600, maxAgeSeconds: 30 * 86400 } },
          },
          {
            // Freease Stream: sampul anime & gambar komik (lewat proxy server) — cepat saat dibuka lagi.
            urlPattern: ({ url }) => url.pathname === '/api/fs/img' || url.hostname.endsWith('animekompi.sbs'),
            handler: 'CacheFirst',
            options: { cacheName: 'stream-img', expiration: { maxEntries: 1500, maxAgeSeconds: 14 * 86400 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:8080', '/voice': 'http://localhost:8080' },
  },
  test: { environment: 'node' },
});
