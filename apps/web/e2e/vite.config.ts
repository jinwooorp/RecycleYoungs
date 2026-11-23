import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type ViteDevServer } from 'vite';

/** 제품과 같은 플러그인·별칭·프록시 방식을 쓰되 실제 .env는 읽지 않습니다. */
export default defineConfig({
  envDir: false,
  define: { 'import.meta.env.VITE_KAKAO_MAP_APP_KEY': JSON.stringify('') },
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4174' },
      '/__e2e': { target: 'http://127.0.0.1:4174' },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'e2e-local-only',
      transformIndexHtml: {
        order: 'pre',
        handler() {
          // 실제 위치·브라우저 권한에 의존하지 않는 거부 경로만 재현합니다.
          return [
            {
              tag: 'script',
              injectTo: 'head-prepend',
              children: `Object.defineProperty(navigator, 'geolocation', {
                configurable: true,
                value: { getCurrentPosition(_success, error) {
                  queueMicrotask(() => error?.({ code: 1, message: 'E2E_DENIED' }));
                } }
              });`,
            },
          ];
        },
      },
      configureServer(server: ViteDevServer) {
        server.middlewares.use((_request, response, next) => {
          response.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:4173; object-src 'none'; base-uri 'self'",
          );
          next();
        });
      },
    },
  ],
});
