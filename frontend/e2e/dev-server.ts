import { createServer } from 'vite';
import { startMockApi } from './mock-api.ts';

// Playwright webServer와 ego(lite)가 동일한 격리 환경을 사용합니다.
const api = await startMockApi();
try {
  const vite = await createServer({ configFile: 'e2e/vite.config.ts' });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await Promise.all([
      vite.close(),
      new Promise<void>((resolve, reject) =>
        api.close((error) => (error ? reject(error) : resolve())),
      ),
    ]);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void close();
    });
  await vite.listen();
  console.log(
    'Synthetic E2E environment: http://127.0.0.1:4173 (no SDK key / no Backend)',
  );
} catch (error) {
  api.close();
  throw error;
}
