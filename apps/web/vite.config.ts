/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import type { Plugin } from 'vite';

/**
 * `@a2ui/web_core` 를 한 사본으로 모은다. `@a2ui/react` 는 자기 안에 web_core 0.15 를 따로 두고,
 * 루트 node_modules 에는 `@a2ui/markdown-it` 의 peer 때문에 0.14 가 올라온다. 사본이 갈리면 렌더러와
 * 우리 카탈로그 · MessageProcessor 가 서로 다른 모듈을 쓰므로, 어디서 import 하든 앱이 고정한 사본을 쓴다.
 */
function singleA2uiWebCore(): Plugin {
  const appEntry = path.resolve(__dirname, 'src/main.tsx');
  return {
    name: 'single-a2ui-web-core',
    enforce: 'pre',
    resolveId(source, importer, options) {
      if (!source.startsWith('@a2ui/web_core') || importer === appEntry) return null;
      return this.resolve(source, appEntry, { ...options, skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [singleA2uiWebCore(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // 테스트에서도 위 플러그인이 `@a2ui/react` 안의 import 를 거치게 한다 (기본은 node_modules 를 Node 가 직접 읽는다).
    server: { deps: { inline: [/@a2ui\//] } },
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
