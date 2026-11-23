import { fileURLToPath } from 'node:url';
import type { Locator } from '@playwright/test';
import { expect, noOverflow, openRegionFilter, test } from './test-support';

async function expectChevron(control: Locator, nativeSelect = true) {
  const wrapper = nativeSelect ? control.locator('..') : control;
  const arrowSelector = 'svg.lucide-chevron-down';
  const arrow = wrapper.locator(arrowSelector);
  await expect(arrow).toHaveAttribute('aria-hidden', 'true');
  await expect(arrow).toHaveCSS('pointer-events', 'none');
  // 패널 전환 중에도 컨트롤과 화살표의 좌표를 같은 프레임에서 읽습니다.
  const geometry = await control.evaluate(
    (element, { arrowSelector, nativeSelect }) => {
      const wrapper = nativeSelect ? element.parentElement : element;
      const field = element.getBoundingClientRect();
      const icon = wrapper!
        .querySelector(arrowSelector)!
        .getBoundingClientRect();
      return {
        iconWidth: icon.width,
        iconHeight: icon.height,
        rightGap: field.right - icon.right,
        centerOffset: icon.y + icon.height / 2 - field.y - field.height / 2,
      };
    },
    { arrowSelector, nativeSelect },
  );
  expect(geometry.iconWidth).toBeCloseTo(16);
  expect(geometry.iconHeight).toBeCloseTo(16);
  expect(geometry.rightGap).toBeCloseTo(12);
  expect(Math.abs(geometry.centerOffset)).toBeLessThanOrEqual(1);
  if (nativeSelect) {
    await expect(control).toHaveCSS('appearance', 'none');
    await expect(control).toHaveCSS('padding-left', '12px');
    await expect(control).toHaveCSS('padding-right', '40px');
    await expect(control).toHaveCSS('text-overflow', 'ellipsis');
  }
}

async function expectLocationPlacement(notice: Locator, desktop: boolean) {
  await expect(notice).toBeInViewport({ ratio: 1 });
  const geometry = await notice.evaluate((element) => {
    const card = element.getBoundingClientRect();
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    const search = rect('.explore-search-form');
    const filter = rect('.region-filter > button');
    const dock = rect('.explore-dock');
    return {
      cardTop: card.top,
      cardBottom: card.bottom,
      filterBottom: filter.bottom,
      searchBottom: search.bottom,
      dockTop: dock.top,
      searchGap: card.left - search.right,
      filterGap: filter.left - card.right,
      centerOffset: card.top + card.height / 2 - filter.top - filter.height / 2,
    };
  });
  if (desktop) {
    expect(Math.abs(geometry.centerOffset)).toBeLessThanOrEqual(1);
    expect(geometry.searchGap).toBeGreaterThanOrEqual(11);
    expect(geometry.filterGap).toBeGreaterThanOrEqual(11);
  } else {
    expect(geometry.cardTop).toBeGreaterThanOrEqual(
      Math.max(geometry.searchBottom, geometry.filterBottom),
    );
    expect(geometry.cardBottom).toBeLessThanOrEqual(geometry.dockTop);
  }
}

test('위치 안내가 데스크톱 도구와 정렬되고 모바일에서는 아래에 표시된다', async ({
  page,
}, testInfo) => {
  const mapFixture = fileURLToPath(
    new URL('./location-map.fixture.js', import.meta.url),
  );
  await page.route(/\/src\/lib\/kakao-maps\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({ path: mapFixture, contentType: 'text/javascript' }),
  );
  const desktop = !testInfo.project.use.isMobile;
  const viewports = desktop
    ? [
        [1024, 768],
        [1100, 800],
        [1279, 800],
        [1280, 800],
        [1440, 900],
      ]
    : [
        [320, 568],
        [390, 844],
      ];

  for (const [width, height] of viewports) {
    await test.step(`${width}px 권한 거부·수동 오류·재시도 성공`, async () => {
      await page.setViewportSize({ width, height });
      await page.goto('/explore');
      const denied = page.getByRole('status').filter({
        hasText: '위치 권한이 거부되었습니다.',
      });
      await expectLocationPlacement(denied, desktop);

      await page.getByRole('button', { name: '내 위치로 이동' }).click();
      const error = page.getByRole('alert').filter({
        hasText: '현재 위치를 확인하지 못했습니다.',
      });
      await expectLocationPlacement(error, desktop);
      await error.getByRole('button', { name: '위치 확인 다시 시도' }).click();

      const success = page.getByRole('status').filter({
        hasText: '현재 위치를 확인했습니다.',
      });
      await expectLocationPlacement(success, desktop);
      await noOverflow(page);
    });
  }
});

test('320×568에서 키보드로 상세 패널을 열고 스크롤하며 지역 필터를 조작한다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/explore');

  const dock = page.getByRole('navigation', { name: '탐색 메뉴' });
  await expect(dock).toHaveCSS('width', '296px');
  await expect(dock).toHaveCSS('height', '62px');
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
  const district = controls.getByRole('button', {
    name: '마포구',
    exact: true,
  });
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

  await filter.press('Enter');
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await expect(controls).toBeVisible();
  await expect(district).toBeEnabled();
  await expect(district).toHaveCSS('min-height', '44px');
  const seoul = controls.getByRole('button', { name: '서울 전체' });
  await expect(seoul).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(district).toBeFocused();
  await page.keyboard.press('Space');
  await expect(district).toHaveAttribute('aria-pressed', 'true');
  await expect(district).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
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
  await expectChevron(trigger, false);
  const region = page.getByRole('group', { name: '지역 필터' });
  const district = region.getByRole('button', { name: '성동구', exact: true });
  const dongStep = region.getByRole('button', { name: '행정동', exact: true });
  await expect(dongStep).toHaveCount(0);
  await district.click();
  await expect(district).toHaveAttribute('aria-pressed', 'true');
  await expect(dongStep).toBeEnabled();
  await dongStep.press('Enter');
  await expect(dongStep).toHaveAttribute('aria-current', 'step');
  const allDongs = region.getByRole('button', { name: '행정동 전체' });
  await expect(allDongs).toBeFocused();
  const dong = region.getByRole('button', { name: '성수1가1동' });
  await page.keyboard.press('Tab');
  await expect(dong).toBeFocused();
  await page.keyboard.press('Space');
  await expect(dong).toHaveAttribute('aria-pressed', 'true');
  await expect(allDongs).toHaveAttribute('aria-pressed', 'false');
  await expect(trigger).toContainText('성동구 · 성수1가1동');
  await region
    .getByRole('button', { name: '이전 단계: 자치구' })
    .press('Enter');
  await expect(district).toBeFocused();
  await expect(district).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

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
  const district = controls.getByRole('button', {
    name: '마포구',
    exact: true,
  });

  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(controls).toBeHidden();
  await filter.press('Enter');
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await expect(controls).toBeVisible();
  await expect(district).toBeEnabled();
  await expect(
    controls.getByRole('button', { name: '서울 전체' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(district).toBeFocused();
  await page.keyboard.press('Space');
  await expect(district).toBeFocused();

  for (const size of [wide, compact]) {
    await page.setViewportSize(size);
    await expect(filter).toBeVisible();
    await expect(controls).toBeVisible();
    await expect(district).toHaveAttribute('aria-pressed', 'true');
    await expect(district).toBeFocused();
    await noOverflow(page);
  }

  await page.keyboard.press('Escape');
  await expect(controls).toBeHidden();
  await expect(filter).toBeFocused();
  await expect(filter).toContainText('마포구');

  await page.keyboard.press('Enter');
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await expect(district).toHaveAttribute('aria-pressed', 'true');
  await expect(district).toBeFocused();
  await page.keyboard.press('Escape');

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
  await expect(filter).toContainText('마포구');
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
