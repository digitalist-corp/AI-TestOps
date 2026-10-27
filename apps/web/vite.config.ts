/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  server: {
    port: 3000,
    // host.docker.internal: playops-self(자체 회귀 테스트) 러너 컨테이너가 이 서버 자신의
    // web 컨테이너로 접근할 때 쓰는 호스트명 (DockerRunnerService의 --add-host 참고).
    allowedHosts: ['.ts.net', '.trycloudflare.com', 'host.docker.internal'],
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:8080',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('cookie');
          });
        },
      },
    },
  },
});
