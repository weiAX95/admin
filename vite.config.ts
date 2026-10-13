import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 管理端独立端口 5176；E2E 使用隔离 API 的动态代理目标。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    proxy: {
      '/api': {
        target: process.env.ADMIN_API_PROXY_TARGET || 'http://127.0.0.1:8002',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
