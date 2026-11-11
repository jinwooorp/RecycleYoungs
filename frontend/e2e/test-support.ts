import { test as base, expect, type Page } from '@playwright/test';

/** 각 테스트의 새 context에서만 네트워크·브라우저 오류를 수집합니다. */
export const test = base.extend<{ allowHttpErrors: Set<string> }>({
  allowHttpErrors: [
    async ({ context, page }, use) => {
      const allowed = new Set<string>();
      const faults: string[] = [];
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://127.0.0.1:4173') {
          faults.push(`External request blocked: ${url.origin}`);
          await route.abort('blockedbyclient');
        } else {
          await route.continue();
        }
      });
      page.on('pageerror', (error) =>
        faults.push(`Page error: ${error.message}`),
      );
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const path = new URL(message.location().url || 'http://127.0.0.1:4173')
          .pathname;
        if (allowed.has(path) && /status of 503/.test(message.text())) return;
        faults.push(`Console error: ${message.text()}`);
      });
      page.on('requestfailed', (request) => {
        // 화면 전환·지역 변경으로 취소된 요청은 제품의 정상적인 취소 흐름입니다.
        if (request.failure()?.errorText !== 'net::ERR_ABORTED')
          faults.push(`Network error: ${request.url()}`);
      });
      page.on('response', (response) => {
        if (
          response.status() >= 400 &&
          !(
            response.status() === 503 &&
            allowed.has(new URL(response.url()).pathname)
          )
        )
          faults.push(
            `Unexpected HTTP ${response.status()}: ${response.url()}`,
          );
      });
      await use(allowed);
      expect(faults, 'Unexpected browser/network failures').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function scenario(page: Page, value: string) {
  await page.context().addCookies([
    {
      name: 'ry-e2e-scenario',
      value,
      url: 'http://127.0.0.1:4173',
      sameSite: 'Strict',
    },
  ]);
}

/** 모바일 필터를 열고, 선택 후 포커스 복귀를 확인할 버튼을 반환합니다. */
export async function openRegionFilter(page: Page) {
  // RegionFilter와 같은 기준으로 분기해 버튼이 렌더링되기 전에도 모바일을 판별합니다.
  const desktop = await page.evaluate(
    () => window.matchMedia('(min-width: 64rem)').matches,
  );
  const trigger = desktop
    ? null
    : page.getByRole('button', { name: '지역 필터', exact: true });
  if (trigger) {
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(
    page.getByRole('group', { name: '지역 필터', exact: true }),
  ).toBeVisible();
  return trigger;
}

export async function selectDistrict(page: Page, code = '11440') {
  const trigger = await openRegionFilter(page);
  const select = page.getByRole('combobox', { name: '자치구', exact: true });
  await expect(select).toBeEnabled();
  await select.selectOption(code);
  if (trigger) {
    await select.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  }
}

export async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
