import { fileURLToPath } from 'node:url';
import type { Locator } from '@playwright/test';
import {
  expect,
  noOverflow,
  openRegionFilter,
  scenario,
  selectDistrict,
  test,
} from './test-support';
import { cafePage, candidates } from './fixtures';

async function recordPanelSizeChanges(panel: Locator) {
  await panel.evaluate((element) => {
    const shell = element.parentElement!;
    let previous: Animation | undefined;
    let count = 0;
    const observer = new MutationObserver(() => {
      if (!shell.hasAttribute('data-size-transition')) return;
      const animation = element
        .getAnimations()
        .find(
          ({ effect }) =>
            effect instanceof KeyframeEffect &&
            effect
              .getKeyframes()
              .some((frame) => 'width' in frame && 'height' in frame),
        );
      if (!animation || animation === previous) return;
      previous = animation;
      element.setAttribute('data-test-size-changes', String(++count));
    });
    observer.observe(shell, {
      attributes: true,
      attributeFilter: ['data-size-transition'],
    });
  });
  return () =>
    panel.evaluate((element) =>
      Number(element.getAttribute('data-test-size-changes')),
    );
}

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
  await page.route(/\/src\/shared\/kakao\/kakao-maps\.ts(?:\?.*)?$/, (route) =>
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

test('세 패널의 확대 크기와 상단 도구·Dock 사이 안전 여백을 유지한다', async ({
  page,
}, testInfo) => {
  const fixture = fileURLToPath(
    new URL('./location-map.fixture.js', import.meta.url),
  );
  await page.route(/\/src\/shared\/kakao\/kakao-maps\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({ path: fixture, contentType: 'text/javascript' }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mobile = testInfo.project.use.isMobile;
  const sizes = mobile
    ? [
        [390, 844, 366, 464.2],
        [320, 568, 296, 286],
        [568, 320, 544, 100],
      ]
    : [
        [1440, 900, 924, 720],
        [1280, 800, 924, 620],
        [1024, 768, 872, 588],
      ];
  await page.addInitScript(
    (items) => {
      localStorage.setItem(
        'recycleyoungs.candidates',
        JSON.stringify({ version: 2, items }),
      );
    },
    candidates.slice(0, 2),
  );
  await page.goto('/explore');
  await expect(
    page.getByRole('button', { name: '내 위치로 이동' }),
  ).toBeEnabled();
  const region = await openRegionFilter(page);
  await page.getByRole('button', { name: '마포구', exact: true }).click();
  await region.press('Escape');
  // 위치 안내가 표시되는 동안 모바일은 임시로 좁은 시트를 사용합니다.
  await expect(page.locator('.explore-location-toast')).toBeHidden();

  for (const [width, height, expectedWidth, expectedHeight] of sizes) {
    await page.setViewportSize({ width, height });
    for (const name of ['주변 탐색', '상권 분석', '후보지 분석']) {
      await page.getByRole('button', { name, exact: true }).click();
      const panel = page.getByRole('complementary', { name, exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.locator('..')).toHaveAttribute(
        'data-compact',
        'false',
      );
      await expect
        .poll(async () => {
          const box = await panel.boundingBox();
          return box ? Math.abs(box.height - expectedHeight) : Infinity;
        })
        .toBeLessThanOrEqual(1);
      const geometry = await panel.evaluate((el) => {
        const panel = el.getBoundingClientRect();
        const rect = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect();
        const dock = rect('.explore-dock');
        return {
          width: panel.width,
          dockGap: dock.top - panel.bottom,
          toolbarGap:
            panel.top -
            Math.max(
              rect('.explore-search-form').bottom,
              rect('.region-filter > button').bottom,
            ),
        };
      });
      expect(geometry.width).toBeCloseTo(expectedWidth);
      expect(geometry.dockGap).toBeCloseTo(8);
      if (mobile) expect(geometry.toolbarGap).toBeGreaterThan(0);
      else {
        expect(geometry.toolbarGap).toBeGreaterThanOrEqual(12);
        expect(geometry.toolbarGap).toBeLessThanOrEqual(16);
      }
      const sections =
        name === '주변 탐색'
          ? ['탐색 설정', '조회된 카페']
          : name === '상권 분석'
            ? ['점포 수 요약', '당월 추정매출액 요약']
            : ['후보지 요약', '주변 경쟁 환경'];
      const first = panel.getByRole('region', {
        name: sections[0],
        exact: true,
      });
      const second = panel.getByRole('region', {
        name: sections[1],
        exact: true,
      });
      await expect(first).toBeVisible();
      await expect(second).toBeVisible();
      const firstBox = (await first.boundingBox())!;
      const secondBox = (await second.boundingBox())!;
      if (width >= 1024 && name === '상권 분석')
        expect(firstBox.x + firstBox.width).toBeLessThanOrEqual(secondBox.x);
      else
        expect(firstBox.y + firstBox.height).toBeLessThanOrEqual(secondBox.y);
      await noOverflow(page);
    }
    await page.keyboard.press('Escape');
  }
});

test('초기 세 패널은 컴팩트한 너비와 콘텐츠 높이를 사용하며 검색과 Dock을 가리지 않는다', async ({
  page,
}, testInfo) => {
  const fixture = fileURLToPath(
    new URL('./location-map.fixture.js', import.meta.url),
  );
  await page.route(/\/src\/shared\/kakao\/kakao-maps\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({ path: fixture, contentType: 'text/javascript' }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/explore');
  await expect(
    page.getByText('위치 권한이 거부되었습니다.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.explore-location-toast')).toBeHidden();
  const mobile = testInfo.project.use.isMobile;
  for (const name of ['주변 탐색', '상권 분석', '후보지 분석']) {
    const menu = page.getByRole('button', { name, exact: true });
    await menu.press('Enter');
    const panel = page.getByRole('complementary', { name, exact: true });
    const heading = panel.getByRole('heading', { name, exact: true });
    await expect(heading).toBeFocused();
    await expect(panel.locator('..')).toHaveAttribute('data-compact', 'true');
    if (name !== '주변 탐색')
      await expect(
        panel.getByRole('combobox', { name: '통계 기준 분기' }),
      ).toBeEnabled();
    if (name === '상권 분석') {
      await expect(panel.getByRole('group', { name: '통계 항목' })).toHaveCount(
        0,
      );
      await expect(
        panel.getByText(/장소를 검색하거나 지역 필터에서/),
      ).toBeVisible();
    } else if (name === '후보지 분석') {
      await expect(panel.getByRole('table')).toHaveCount(0);
      await expect(panel.getByText(/등록된 후보지가 없습니다/)).toBeVisible();
    }
    const geometry = await panel.evaluate((element) => {
      const panelBox = element.getBoundingClientRect();
      const dock = document
        .querySelector('.explore-dock')!
        .getBoundingClientRect();
      const search = document
        .querySelector('.explore-search-form')!
        .getBoundingClientRect();
      const content = element.querySelector('.explore-panel-content')!;
      return {
        height: panelBox.height,
        width: panelBox.width,
        centerOffset: Math.abs(
          (panelBox.left + panelBox.right - dock.left - dock.right) / 2,
        ),
        dockGap: dock.top - panelBox.bottom,
        searchGap: panelBox.top - search.bottom,
        clipped: content.scrollHeight - content.clientHeight,
      };
    });
    expect(geometry.height).toBeLessThan(mobile ? 464 : 720);
    expect(geometry.width).toBeCloseTo(mobile ? 366 : 520);
    expect(geometry.centerOffset).toBeLessThanOrEqual(1);
    expect(geometry.clipped).toBeLessThanOrEqual(1);
    expect(geometry.dockGap).toBeCloseTo(8);
    expect(geometry.searchGap).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await noOverflow(page);
  }
  const filter = await openRegionFilter(page);
  await page.getByRole('button', { name: '마포구', exact: true }).click();
  await filter.press('Escape');
  await page
    .getByRole('button', { name: '상권 분석', exact: true })
    .press('Enter');
  const analysis = page.getByRole('complementary', { name: '상권 분석' });
  await expect(
    analysis.getByRole('region', { name: '점포 수 요약' }),
  ).toBeVisible();
  await expect(analysis.locator('..')).toHaveAttribute('data-compact', 'false');
  await openRegionFilter(page);
  await page.getByRole('button', { name: '서울 전체', exact: true }).click();
  await filter.press('Escape');
  await expect(analysis.locator('..')).toHaveAttribute('data-compact', 'true');
  await expect(analysis.getByRole('group', { name: '통계 항목' })).toHaveCount(
    0,
  );
});

test('카페 결과가 확정될 때만 패널 크기를 바꾸고 일시 오류와 재시도 중에는 유지한다', async ({
  page,
  allowHttpErrors,
}) => {
  const fixture = fileURLToPath(
    new URL('./location-map.fixture.js', import.meta.url),
  );
  await page.route(/\/src\/shared\/kakao\/kakao-maps\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({ path: fixture, contentType: 'text/javascript' }),
  );
  const api = '/api/v1/cafes/viewport';
  allowHttpErrors.add(api);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  let outcome: 'data' | 'error' | 'empty' = 'data';
  let finishLoading!: () => void;
  const loading = new Promise<void>((resolve) => {
    finishLoading = resolve;
  });
  let finishRetry!: () => void;
  const retrying = new Promise<void>((resolve) => {
    finishRetry = resolve;
  });
  const pageData = cafePage(500, 126.923);
  await page.route(/\/api\/v1\/cafes\/viewport\?/, async (route) => {
    if (outcome === 'data') {
      await loading;
      const items = pageData.items.map((item) => ({
        ...item,
        distanceM: undefined,
      }));
      await route.fulfill({ json: { ...pageData, items } });
    } else if (outcome === 'error') {
      await route.fulfill({
        status: 503,
        json: { code: 'DATA_NOT_READY', status: 503 },
      });
    } else {
      await retrying;
      await route.fulfill({
        json: { ...pageData, totalCount: 0, items: [], hasMore: false },
      });
    }
  });
  await page.goto('/explore');
  const menu = page.getByRole('button', { name: '주변 탐색', exact: true });
  await menu.press('Enter');
  const panel = page.getByRole('complementary', { name: '주변 탐색' });
  const shell = panel.locator('..');
  await expect(page.getByText(/위치 권한이 거부되었습니다/)).toBeVisible();
  await expect(page.locator('.explore-location-toast')).toBeHidden();
  const transitions = await recordPanelSizeChanges(panel);
  const toggle = await openRegionFilter(page);
  await page.getByRole('button', { name: '마포구', exact: true }).click();
  await toggle.press('Escape');
  await expect(panel.getByText('카페 목록 불러오는 중…')).toBeVisible();
  await expect(shell).toHaveAttribute('data-compact', 'true');
  expect(await transitions()).toBe(0);
  finishLoading();
  await expect(
    panel.getByRole('list', { name: '현재 페이지 카페' }),
  ).toBeVisible();
  await expect(shell).toHaveAttribute('data-compact', 'false');
  await expect.poll(transitions).toBe(1);
  await expect(shell).not.toHaveAttribute('data-size-transition');
  outcome = 'error';
  await openRegionFilter(page);
  await page.getByRole('button', { name: '성동구', exact: true }).click();
  await toggle.press('Escape');
  const retry = panel.getByRole('button', { name: '카페 목록 다시 시도' });
  await expect(retry).toBeVisible();
  await expect(shell).toHaveAttribute('data-compact', 'false');
  expect(await transitions()).toBe(1);
  outcome = 'empty';
  await retry.press('Enter');
  await expect(panel.getByText('카페 목록 불러오는 중…')).toBeVisible();
  await expect(shell).toHaveAttribute('data-compact', 'false');
  expect(await transitions()).toBe(1);
  finishRetry();
  await expect(
    panel.getByText('현재 지도 영역에 조회된 카페가 없습니다.'),
  ).toBeVisible();
  await expect(shell).toHaveAttribute('data-compact', 'true');
  await expect.poll(transitions).toBe(2);
  await expect(shell).not.toHaveAttribute('data-size-transition');
  await noOverflow(page);
});

test('상권·후보지 패널은 대상 추가·제거와 메뉴 전환이 끝나면 기존 크기를 복원한다', async ({
  page,
}, testInfo) => {
  const fixture = fileURLToPath(
    new URL('./location-map.fixture.js', import.meta.url),
  );
  await page.route(/\/src\/shared\/kakao\/kakao-maps\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({ path: fixture, contentType: 'text/javascript' }),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/explore');
  await expect(page.getByText(/위치 권한이 거부되었습니다/)).toBeVisible();
  await expect(page.locator('.explore-location-toast')).toBeHidden();
  const panel = page.locator('#explore-panel');
  const shell = panel.locator('..');
  const transitions = await recordPanelSizeChanges(panel);
  const expectEnd = async (count: number, compact: boolean) => {
    await expect(shell).toHaveAttribute('data-compact', String(compact));
    await expect.poll(transitions).toBe(count);
    await expect(shell).not.toHaveAttribute('data-size-transition');
    const geometry = await panel.evaluate((element) => {
      const { left, right, bottom, width, height } =
        element.getBoundingClientRect();
      const dock = document
        .querySelector('.explore-dock')!
        .getBoundingClientRect();
      return {
        width,
        height,
        gap: dock.top - bottom,
        center: (left + right - dock.left - dock.right) / 2,
        inlineSize: [element.style.width, element.style.height],
      };
    });
    expect(geometry.width).toBeCloseTo(
      testInfo.project.use.isMobile ? 366 : compact ? 520 : 924,
    );
    const expandedHeight = testInfo.project.use.isMobile ? 464.2 : 720;
    if (compact) expect(geometry.height).toBeLessThan(expandedHeight);
    else
      expect(Math.abs(geometry.height - expandedHeight)).toBeLessThanOrEqual(1);
    expect(geometry.gap).toBeCloseTo(8);
    expect(Math.abs(geometry.center)).toBeLessThanOrEqual(1);
    expect(geometry.inlineSize).toEqual(['', '']);
  };
  const dock = page.getByRole('navigation', { name: '탐색 메뉴' });
  const useMenu = (name: string) =>
    dock.getByRole('button', { name, exact: true }).press('Enter');
  await useMenu('상권 분석');
  await selectDistrict(page);
  await expectEnd(1, false);
  await useMenu('후보지 분석');
  await expectEnd(2, true);
  await panel
    .getByRole('button', { name: '지도에서 후보지 추가' })
    .press('Enter');
  const map = page.getByLabel('Kakao Maps 지도', { exact: true });
  const level = await map.getAttribute('data-map-level');
  await map.click({ position: { x: 160, y: 200 } });
  await expect(
    panel.getByRole('region', { name: '후보지 A 요약' }),
  ).toBeVisible();
  await expectEnd(3, false);
  await panel
    .getByRole('button', { name: '후보지 A 상세 및 관리 열기' })
    .press('Enter');
  await panel.getByRole('button', { name: '후보지 A 삭제' }).press('Enter');
  await expectEnd(4, true);
  await useMenu('상권 분석');
  await expectEnd(5, false);
  const filter = await openRegionFilter(page);
  await page.getByRole('button', { name: '서울 전체', exact: true }).click();
  await filter.press('Escape');
  await expectEnd(6, true);
  await expect(map).toHaveAttribute('data-map-level', level!);
  await noOverflow(page);
});

test('카페 출처 상세는 넓은 패널에서 토글 옆에, 좁은 패널에서 아래에 표시한다', async ({
  page,
}, testInfo) => {
  const fixture = fileURLToPath(
    new URL('./location-map.fixture.js', import.meta.url),
  );
  await page.route(/\/src\/shared\/kakao\/kakao-maps\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({ path: fixture, contentType: 'text/javascript' }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario(page, 'cafe-pagination');
  await page.goto('/explore');
  await selectDistrict(page);
  await expect(page.locator('.explore-location-toast')).toBeHidden();
  await page
    .getByRole('button', { name: '주변 탐색', exact: true })
    .press('Enter');
  const panel = page.getByRole('complementary', { name: '주변 탐색' });
  const cafes = panel.getByRole('list', { name: '현재 페이지 카페' });
  const pager = panel.getByRole('navigation', { name: '카페 목록 페이지' });
  const summary = panel.getByText('데이터 출처 상세', { exact: true });
  const provider = panel.getByText(
    '제공기관 소상공인시장진흥공단 · 공공데이터포털',
  );
  const link = panel.getByRole('link', {
    name: '소상공인시장진흥공단_상가(상권)정보_API',
  });
  await expect(cafes.getByRole('listitem')).toHaveCount(10);
  await expect(provider).toBeHidden();
  await expect(link).toBeHidden();
  const mobile = testInfo.project.use.isMobile;
  if (!mobile) await expect(pager).toBeInViewport({ ratio: 1 });
  await summary.press('Enter');
  await expect(summary).toBeFocused();
  await expect(link).toHaveAttribute(
    'href',
    'https://www.data.go.kr/data/15012005/openapi.do',
  );
  await expect(provider).toBeVisible();
  const toggleBox = (await summary.boundingBox())!;
  const providerBox = (await provider.boundingBox())!;
  const linkBox = (await link.boundingBox())!;
  if (mobile) {
    expect(providerBox.y).toBeGreaterThanOrEqual(
      toggleBox.y + toggleBox.height - 1,
    );
  } else {
    expect(Math.abs(toggleBox.y - providerBox.y)).toBeLessThanOrEqual(1);
    expect(providerBox.x).toBeGreaterThan(toggleBox.x + toggleBox.width);
    expect(linkBox.x).toBeGreaterThan(toggleBox.x + toggleBox.width);
    await expect(pager).toBeInViewport({ ratio: 1 });
  }
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Space');
  await expect(link).toBeHidden();
  await expect(cafes.getByRole('listitem')).toHaveCount(10);
  await noOverflow(page);
});

test('상권 도구와 선택 조합별 지표·그래프가 패널 너비에 맞춰 배치된다', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/explore');
  await selectDistrict(page);
  await page
    .getByRole('button', { name: '상권 분석', exact: true })
    .press('Enter');
  const panel = page.getByRole('complementary', { name: '상권 분석' });
  const quarter = panel.getByRole('combobox', { name: '통계 기준 분기' });
  const district = panel.getByRole('heading', { name: '마포구', exact: true });
  const industry = panel.getByRole('combobox', { name: '업종' });
  await expect(district).toBeVisible();
  await expect(panel.getByText('자치구 전체', { exact: true })).toBeVisible();
  await expect(industry.getByRole('option', { name: '카페' })).toHaveCount(1);
  const shops = panel.getByRole('region', { name: '일반·프랜차이즈 점포' });
  const changes = panel.getByRole('region', { name: '개업·폐업 점포' });
  const metrics = panel.locator('[aria-label="세부 지표"] > div');
  const graphs = panel.locator('.analysis-detail-graphs > section');
  const options = panel.getByRole('group', { name: '통계 항목' });
  const option = (name: string) =>
    options.getByRole('button', { name, exact: true });
  const rows = async (items: Locator) =>
    items.evaluateAll((elements) => {
      const widths = new Map<number, number[]>();
      for (const el of elements) {
        const { top, width } = el.getBoundingClientRect();
        const y = Math.round(top);
        widths.set(y, [...(widths.get(y) ?? []), width]);
      }
      return Array.from(widths.values());
    });
  await expect(metrics).toHaveCount(6);
  await expect(graphs).toHaveCount(4);
  await expect(option('모두')).toHaveAttribute('aria-pressed', 'true');
  await expect(changes.getByText('상한 2 개')).toBeVisible();
  const quarterBox = (await quarter.boundingBox())!;
  const districtBox = (await district.boundingBox())!;
  const industryBox = (await industry.boundingBox())!;
  const shopsBox = (await shops.boundingBox())!;
  const changesBox = (await changes.boundingBox())!;
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  const mobile = testInfo.project.use.isMobile;
  if (mobile) {
    expect(districtBox.y).toBeGreaterThanOrEqual(
      quarterBox.y + quarterBox.height,
    );
    expect(changesBox.y).toBeGreaterThan(shopsBox.y + shopsBox.height);
  } else {
    expect(
      Math.abs(middle(quarterBox) - middle(districtBox)),
    ).toBeLessThanOrEqual(1);
    expect(industryBox.y).toBeCloseTo(quarterBox.y);
    expect(districtBox.x).toBeGreaterThan(quarterBox.x + quarterBox.width);
    expect(industryBox.x).toBeGreaterThan(districtBox.x + districtBox.width);
    expect(changesBox.y).toBeCloseTo(shopsBox.y);
    expect(changesBox.x).toBeGreaterThan(shopsBox.x + shopsBox.width);
  }
  expect((await rows(metrics)).map((row) => row.length)).toEqual(
    mobile ? [1, 1, 1, 1, 1, 1] : [3, 3],
  );
  expect((await rows(graphs)).map((row) => row.length)).toEqual(
    mobile ? [1, 1, 1, 1] : [2, 2],
  );
  await option('점포 현황').press('Space');
  await option('추정매출').press('Enter');
  await expect(metrics).toHaveCount(5);
  await expect(graphs).toHaveCount(3);
  const metricRows = await rows(metrics);
  const graphRows = await rows(graphs);
  expect(metricRows.map((row) => row.length)).toEqual(
    mobile ? [1, 1, 1, 1, 1] : [3, 2],
  );
  expect(graphRows.map((row) => row.length)).toEqual(
    mobile ? [1, 1, 1] : [2, 1],
  );
  if (!mobile) {
    expect(metricRows[1][0]).toBeGreaterThan(metricRows[0][0]);
    expect(graphRows[1][0]).toBeCloseTo(graphRows[0][0] + graphRows[0][1] + 12);
  }
  await option('추정매출').press('Space');
  await option('유동인구').press('Enter');
  await expect(metrics).toHaveCount(4);
  expect((await rows(metrics)).map((row) => row.length)).toEqual(
    mobile ? [1, 1, 1, 1] : [2, 2],
  );
  for (const [metric, chart] of [
    ['추정매출', '주중·주말 추정매출액'],
    ['유동인구', '남성·여성 유동인구'],
  ]) {
    await option('모두').press('Enter');
    await option(metric).press('Enter');
    const graph = panel.getByRole('region', { name: chart });
    await expect(graph).toBeVisible();
    expect((await graph.boundingBox())!.width).toBeGreaterThanOrEqual(
      shopsBox.width,
    );
  }
  await noOverflow(page);
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
  const stores = panel.getByRole('button', { name: '점포 현황' });
  const all = panel.getByRole('button', { name: '모두', exact: true });
  const sales = panel.getByRole('button', { name: '추정매출', exact: true });
  const foot = panel.getByRole('button', { name: '유동인구', exact: true });
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

  await page.keyboard.press('Tab');
  const industry = panel.getByRole('combobox', { name: '업종' });
  await expect(industry).toBeFocused();
  await expect(industry).toHaveValue('CS100010');
  await page.keyboard.press('Tab');
  await expect(all).toBeFocused();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(stores).toBeFocused();
  await expect(stores).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Space');
  await expect(stores).toHaveAttribute('aria-pressed', 'true');
  await expect(stores).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sales).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sales).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+Tab');
  await expect(stores).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(sales).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Tab');
  await expect(foot).toBeFocused();
  await page.keyboard.press('Tab');
  const statistics = panel.getByRole('region', { name: '선택한 세부 분석' });
  await expect(statistics).toBeFocused();
  const lastAxis = statistics
    .getByRole('region', { name: '개업·폐업 점포' })
    .getByText('상한 2 개');
  await expect(lastAxis).not.toBeInViewport();
  await page.keyboard.press('End');
  const scroll = panel.locator('.explore-panel-content');
  await expect
    .poll(() =>
      scroll.evaluate((content) =>
        Math.abs(
          content.scrollHeight - content.clientHeight - content.scrollTop,
        ),
      ),
    )
    .toBeLessThanOrEqual(1);
  // 맨 아래에는 출처가 있으므로 위로 한 줄 스크롤해 마지막 그래프의 축도 읽습니다.
  await page.keyboard.press('ArrowUp');
  await expect(lastAxis).toBeInViewport({ ratio: 1 });
  await expect(statistics).toBeFocused();
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
  await expectChevron(page.getByRole('combobox', { name: '업종' }));

  await page.getByRole('button', { name: '주변 탐색', exact: true }).click();
  await page
    .getByRole('button', { name: '선택 지점 주변', exact: true })
    .click();
  const nearbyRadius = page.getByRole('group', { name: '탐색 반경' });
  const radius500 = nearbyRadius.getByRole('button', { name: '500m' });
  const radius1000 = nearbyRadius.getByRole('button', { name: '1km' });
  await expect(radius500).toHaveAttribute('aria-pressed', 'true');
  await radius1000.press('Space');
  await expect(radius1000).toBeFocused();
  await expect(radius1000).toHaveAttribute('aria-pressed', 'true');
  await expect(radius500).toHaveAttribute('aria-pressed', 'false');

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
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(872);
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
