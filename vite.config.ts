import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 管理端独立端口 5176；/api 代理到独立 mock server（:8001），
// 后续替换为真实后端时只需改 target。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
