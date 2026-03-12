import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:18080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
    ],
    exclude: [
      '@codemirror/language-data',
      'react-force-graph-2d',
      'three',
    ],
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (
            id.includes('react-force-graph') ||
            id.includes('/three/') ||
            id.includes('@react-three/')
          ) {
            return 'vendor-graph'
          }
          if (id.includes('recharts')) return 'vendor-charts'
          if (id.includes('react-markdown') || id.includes('remark-gfm')) {
            return 'vendor-markdown'
          }
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('react-router-dom')
          ) {
            return 'vendor-react'
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
