import { defineConfig } from 'vite'

const backend = 'http://localhost:8080'

export default defineConfig({
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/ws': { target: backend.replace('http', 'ws'), ws: true },
    },
  },
})
