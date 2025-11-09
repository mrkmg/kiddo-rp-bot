import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  optimizeDeps: {
    include: ['@ricky0123/vad-web'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      allow: ['..']
    }
  },
  publicDir: 'public',
  plugins: [
    svelte(),
    // Copy VAD assets for production build
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@ricky0123/vad-web/dist/*.onnx',
          dest: 'vad'
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
          dest: 'vad'
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: 'vad'
        }
      ]
    }),
    // Plugin to serve VAD assets in dev mode
    {
      name: 'vad-assets-dev',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/vad/')) {
            // Remove query parameters (e.g., ?import)
            const fileName = req.url.replace('/vad/', '').split('?')[0]
            
            // Try vad-web dist first
            let filePath = path.join(__dirname, 'node_modules/@ricky0123/vad-web/dist', fileName)
            if (fs.existsSync(filePath)) {
              const ext = path.extname(fileName)
              const mimeTypes: Record<string, string> = {
                '.wasm': 'application/wasm',
                '.onnx': 'application/octet-stream',
                '.js': 'application/javascript',
                '.mjs': 'application/javascript'
              }
              res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
              res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
              res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
              return fs.createReadStream(filePath).pipe(res)
            }
            
            // Try onnxruntime-web dist
            filePath = path.join(__dirname, 'node_modules/onnxruntime-web/dist', fileName)
            if (fs.existsSync(filePath)) {
              const ext = path.extname(fileName)
              const mimeTypes: Record<string, string> = {
                '.wasm': 'application/wasm',
                '.js': 'application/javascript',
                '.mjs': 'application/javascript'
              }
              res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
              res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
              res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
              return fs.createReadStream(filePath).pipe(res)
            }
          }
          next()
        })
      }
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Kiddo RP Storyteller',
        short_name: 'Kiddo RP',
        description: 'Interactive voice-driven storytelling for kids ages 6-10',
        theme_color: '#10b981',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Exclude large WASM files from precaching
        globIgnores: ['**/vad/*.wasm'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.openai\.com\/.*/i,
            handler: 'NetworkOnly',
            options: {
              cacheName: 'openai-api-cache',
            }
          },
          {
            urlPattern: /^https:\/\/openrouter\.ai\/.*/i,
            handler: 'NetworkOnly',
            options: {
              cacheName: 'openrouter-api-cache',
            }
          },
          {
            // Cache VAD WASM files on-demand with CacheFirst strategy
            urlPattern: /\/vad\/.*\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vad-wasm-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          },
          {
            // Cache VAD ONNX models on-demand
            urlPattern: /\/vad\/.*\.onnx$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vad-models-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          }
        ]
      }
    })
  ],
})
