import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // API_ 접두사는 개발 서버에서만 읽습니다. 브라우저 공개용 VITE_ 변수와 구분합니다.
  const env = loadEnv(mode, process.cwd(), 'API_');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      // 포트 충돌 시 다른 포트로 바뀌지 않도록 해 접속 주소를 일정하게 유지합니다.
      strictPort: true,
      proxy: {
        '/api': {
          // 셸 설정을 우선하고, 없으면 환경변수 파일과 로컬 Backend 주소 순서로 사용합니다.
          target:
            process.env.API_PROXY_TARGET ??
            env.API_PROXY_TARGET ??
            'http://localhost:8080',
        },
      },
    },
    test: {
      // 실제 브라우저 없이 DOM을 제공하고, 공통 설정에서 테스트 사이의 화면을 정리합니다.
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
