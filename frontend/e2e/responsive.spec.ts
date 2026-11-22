import type { Locator } from '@playwright/test';
import { expect, noOverflow, openRegionFilter, test } from './test-support';

async function expectChevron(control: Locator, nativeSelect = true) {
  const wrapper = nativeSelect ? control.locator('..') : control;
  const arrow = wrapper.locator('svg.lucide-chevron-down');
  await expect(arrow).toHaveAttribute('aria-hidden', 'true');
  await expect(arrow).toHaveCSS('pointer-events', 'none');
  const field = (await control.boundingBox())!;
  const icon = (await arrow.boundingBox())!;
  expect(icon.width).toBeCloseTo(16);
  expect(icon.height).toBeCloseTo(16);
  expect(field.x + field.width - icon.x - icon.width).toBeCloseTo(12);
  expect(icon.y + icon.height / 2 - field.y - field.height / 2).toBeCloseTo(0);
  if (nativeSelect) {
    await expect(control).toHaveCSS('appearance', 'none');
    await expect(control).toHaveCSS('padding-left', '12px');
    await expect(control).toHaveCSS('padding-right', '40px');
    await expect(control).toHaveCSS('text-overflow', 'ellipsis');
  }
}

test('320×568에서 키보드로 상세 패널을 열고 스크롤하며 지역 필터를 조작한다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/explore');

  const menu = page.getByRole('button', { name: '상권 분석', exact: true });
  const panel = page.getByRole('complementary', { name: '상권 분석' });
  const title = panel.getByRole('heading', { name: '상권 분석', level: 2 });
  const close = panel.getByRole('button', { name: '상권 분석 패널 닫기' });

  await menu.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(title).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();

  const filter = page.getByRole('button', { name: '지역 필터', exact: true });
  const controls = page.getByRole('group', { name: '지역 필터' });
  const district = controls.getByRole('combobox', { name: '자치구' });
  const noticeCard = page.getByRole('alert').filter({
    has: page.getByRole('heading', {
      name: '지도 설정이 필요합니다',
      exact: true,
    }),
  });
  await expect(filter).toBeInViewport({ ratio: 1 });
  await expect(noticeCard).toBeInViewport({ ratio: 1 });
  const filterBox = (await filter.boundingBox())!;
  const cardBox = (await noticeCard.boundingBox())!;
  expect(filterBox.y + filterBox.height).toBeLessThanOrEqual(cardBox.y);

  await filter.click();
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await expect(controls).toBeVisible();
  await expect(district).toBeEnabled();
  await district.selectOption('11440');
  await district.press('Escape');
  await expect(controls).toBeHidden();
  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(filter).toBeFocused();
  await expect(filter).toContainText('마포구');

  await menu.press('Enter');
  await expect(title).toBeFocused();
  await expect(
    panel.getByRole('region', { name: '점포 수 요약' }),
  ).toContainText('120');
  // 패널 전환이 끝나 닫기 버튼을 누를 수 있는 위치에서 스크롤을 검사합니다.
  await close.click({ trial: true });
  const stores = panel.getByRole('tab', { name: '점포 현황' });
  await expect(stores).not.toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  const quarter = panel.getByRole('combobox', { name: '통계 기준 분기' });
  await expect(quarter).toBeFocused();
  await expect(quarter).toHaveCSS('outline-width', '2px');
  await expect(quarter).toBeInViewport({ ratio: 1 });
  await quarter.selectOption('20261');
  await expect(quarter).toHaveValue('20261');
  await expect(
    panel.getByRole('region', { name: '점포 수 요약' }),
  ).toContainText('110');
  await page.keyboard.press('Tab');
  await expect(
    panel.getByRole('button', { name: '분기 목록 새로고침' }),
  ).toBeFocused();

  const sourceDetails = panel.getByText('데이터 출처 상세', { exact: true });
  const sourceLink = panel.getByRole('link', {
    name: '서울시 상권분석서비스(점포-자치구)',
  });
  await page.keyboard.press('Tab');
  await expect(sourceDetails).toBeFocused();
  await expect(sourceLink).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(sourceLink).toBeVisible();
  await noOverflow(page);
  await page.keyboard.press('Tab');
  await expect(sourceLink).toBeFocused();
  await expect(sourceLink).toHaveAttribute(
    'href',
    'https://data.seoul.go.kr/dataList/OA-22173/S/1/datasetView.do',
  );
  await page.keyboard.press('Shift+Tab');
  await expect(sourceDetails).toBeFocused();
  await page.keyboard.press('Space');
  await expect(sourceLink).toBeHidden();

  await page.keyboard.press('Tab');
  await expect(stores).toBeFocused();
  await expect(stores).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Tab');
  const statistics = panel.getByRole('tabpanel', { name: '점포 현황' });
  await expect(statistics).toBeFocused();
  const lastAxis = statistics
    .getByRole('region', { name: '개업·폐업 점포' })
    .getByText('상한 2 개');
  await expect(lastAxis).not.toBeInViewport();
  await page.keyboard.press('End');
  await expect(lastAxis).toBeInViewport({ ratio: 1 });
  await expect(statistics).toBeFocused();
  expect(await page.evaluate(() => innerWidth)).toBe(320);
  await noOverflow(page);
});

test('선택 컨트롤의 공통 화살표와 여백을 유지한다', async ({ page }) => {
  await page.goto('/explore');
  const trigger = await openRegionFilter(page);
  if (trigger) await expectChevron(trigger, false);
  const region = page.getByRole('group', { name: '지역 필터' });
  const district = region.getByRole('combobox', { name: '자치구' });
  const dong = region.getByRole('combobox', { name: '행정동' });
  await expectChevron(district);
  await expectChevron(dong);
  await expect(dong).toBeDisabled();
  await expect(dong).toHaveCSS('cursor', 'not-allowed');
  await district.selectOption('11200');
  await expect(dong).toBeEnabled();
  await dong.selectOption('11200650');
  await expect(dong).toHaveAttribute('data-selected', 'true');
  if (trigger) {
    await dong.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }

  await page.getByRole('button', { name: '상권 분석', exact: true }).click();
  const quarter = page.getByRole('combobox', { name: '통계 기준 분기' });
  await quarter.selectOption('20263');
  await expect(quarter).toHaveAccessibleDescription(/서울 전체 게시 현황/);
  await expectChevron(quarter);

  await page.getByRole('button', { name: '주변 탐색', exact: true }).click();
  await page
    .getByRole('button', { name: '선택 지점 주변', exact: true })
    .click();
  const nearbyRadius = page.getByRole('combobox', { name: '탐색 반경' });
  await expectChevron(nearbyRadius);
  await nearbyRadius.selectOption('1000');
  await expect(nearbyRadius).toHaveValue('1000');

  await page.getByRole('button', { name: '후보지 분석', exact: true }).click();
  const candidateRadius = page.getByRole('combobox', {
    name: '공통 탐색 반경',
  });
  await expectChevron(candidateRadius);
  await candidateRadius.selectOption('1000');
  await expect(candidateRadius).toHaveValue('1000');
  await expect(quarter).toHaveValue('20263');
  await noOverflow(page);
});

test('768×1024와 1024×768 전환에서 지역 선택과 포커스를 유지한다', async ({
  page,
}) => {
  const compact = { width: 768, height: 1024 };
  const wide = { width: 1024, height: 768 };
  await page.setViewportSize(compact);
  await page.goto('/explore');

  const filter = page.getByRole('button', { name: '지역 필터', exact: true });
  const controls = page.getByRole('group', { name: '지역 필터' });
  const district = controls.getByRole('combobox', { name: '자치구' });

  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(controls).toBeHidden();
  await filter.click();
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await expect(controls).toBeVisible();
  await expect(district).toBeEnabled();
  await district.selectOption('11440');
  await district.focus();
  await expect(district).toBeFocused();

  await page.setViewportSize(wide);
  await expect(filter).toBeHidden();
  await expect(controls).toBeVisible();
  await expect(district).toHaveValue('11440');
  await expect(district).toBeFocused();
  await noOverflow(page);

  await page.setViewportSize(compact);
  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(filter).toBeFocused();
  await expect(filter).toContainText('마포구');
  await expect(controls).toBeHidden();

  await page.keyboard.press('Enter');
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await expect(district).toHaveValue('11440');
  await expect(district).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(controls).toBeHidden();
  await expect(filter).toBeFocused();

  // 화면을 넓히면 사라지는 모바일 버튼의 포커스를 표시 중인 필터로 넘깁니다.
  await page.setViewportSize(wide);
  await expect(filter).toBeHidden();
  await expect(district).toBeFocused();
  await page.setViewportSize(compact);
  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(filter).toBeFocused();
  await expect(controls).toBeHidden();
  await noOverflow(page);

  const analysis = page.getByRole('button', { name: '상권 분석', exact: true });
  await analysis.press('Enter');
  const panel = page.getByRole('complementary', { name: '상권 분석' });
  const title = panel.getByRole('heading', { name: '상권 분석', level: 2 });
  await expect(title).toBeFocused();
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(700);
  await page.setViewportSize(wide);
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(840);
  await expect(title).toBeFocused();
  await expect(district).toHaveValue('11440');
  await noOverflow(page);
});

test('모션 감소에서 빠른 Dock 전환과 지도 쪽 포인터 조작을 유지한다', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/explore');
  const dock = page.getByRole('navigation', { name: '탐색 메뉴' });
  for (const name of ['주변 탐색', '후보지 분석', '상권 분석']) {
    await dock.getByRole('button', { name, exact: true }).click();
  }
  const panel = page.getByRole('complementary', { name: '상권 분석' });
  await expect(page.getByRole('complementary')).toHaveCount(1);
  await expect(panel).toHaveCSS('transition-duration', '0s');
  await expect(panel.locator('.explore-panel-view')).toHaveCSS(
    'animation-name',
    'none',
  );

  const map = page.getByLabel('Kakao Maps 지도', { exact: true });
  // 지도 모서리의 빈 부분은 전체 화면 오버레이가 클릭을 가로채지 않습니다.
  await map.click({ position: { x: 4, y: 4 } });
  await expect(panel).toBeVisible();
  const active = dock.getByRole('button', { name: '상권 분석', exact: true });
  await active.press('Space');
  await expect(panel).toBeHidden();
  await expect(active).toBeFocused();
  await noOverflow(page);
});
