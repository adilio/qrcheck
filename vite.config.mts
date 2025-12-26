import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const repoBase = process.env.QRCHECK_BASE ?? './';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? repoBase : '/',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['qrcheck.png', 'share-card.png', 'icons/*.png'],
      manifest: {
        name: 'QRCheck - Safe QR Code Scanner',
        short_name: 'QRCheck',
        description: 'Privacy-focused QR code and URL security scanner',
        theme_color: '#2e7d32',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/?source=pwa',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        shortcuts: [
          {
            name: 'Scan QR Code',
            url: '/?action=scan',
            icons: [{ src: 'icons/shortcut-scan.png', sizes: '96x96' }]
          },
          {
            name: 'Check URL',
            url: '/?action=check',
            icons: [{ src: 'icons/shortcut-url.png', sizes: '96x96' }]
          }
        ],
        share_target: {
          action: '/?share-target',
          method: 'GET',
          params: {
            title: 'title',
            text: 'text',
            url: 'url'
          }
        }
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,json}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'threat-data',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
              }
            }
          },
          {
            urlPattern: /urlhaus\/hosts\.json/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'urlhaus-data',
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 // 24 hours
              }
            }
          },
          {
            urlPattern: /\.netlify\/functions\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxAgeSeconds: 60 * 60 * 4 // 4 hours
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  root: '.',
  publicDir: 'public',
  server: {
    fs: {
      // Allow serving files from root
      strict: false
    }
  }
}));
