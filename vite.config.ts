import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

export const previewCsp = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
  "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
  "img-src 'self' https: data: blob:", "media-src 'self' https: blob:",
  "connect-src 'self' https: ws: wss:", "form-action 'self'",
].join('; ')

// 管理端独立端口 5176；E2E 使用隔离 API 的动态代理目标。
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'analyze' ? [visualizer({ filename: 'dist/bundle-stats.html', template: 'treemap', gzipSize: true, brotliSize: true })] : [])],
  preview: { headers: { 'Content-Security-Policy': previewCsp, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' } },
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
}))
