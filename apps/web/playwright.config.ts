import { defineConfig } from '@playwright/test';

// --list는 브라우저 없이 수집만 확인합니다. 로컬 실행은 ego(lite)를 사용합니다.
if (
  !process.argv.includes('--list') &&
  !(
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.platform === 'linux'
  )
)
  throw new Error(
    'Playwright 브라우저 실행은 GitHub-hosted Linux Runner에서만 허용합니다. 로컬 검증은 ego(lite)를 사용하세요.',
  );

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/browser',
  reporter: [
    ['line'],
    ['junit', { outputFile: 'test-results/e2e.xml' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'npm run e2e:serve',
    url: 'http://127.0.0.1:4173/__e2e/health',
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
