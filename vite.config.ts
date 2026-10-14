import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'FieldSurvey',
        short_name: 'FieldSurvey',
        description: 'Offline field survey collection',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f3efe4',
        theme_color: '#0c4f3e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff,woff2}'],
        globIgnores: ['**/map-package/**'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    outDir: mode === 'bare' ? 'dist-bare' : mode === 'e2e' ? 'dist-e2e' : 'dist',
  },
  preview: {
    host: '127.0.0.1',
  },
  server: {
    watch: {
      ignored: ['**/*.pdf'],
    },
  },
}));
