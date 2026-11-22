import type { Request } from '@playwright/test';
import { candidates } from './fixtures';
import {
  test,
  expect,
  scenario,
  openRegionFilter,
  selectDistrict,
  noOverflow,
} from './test-support';

test('랜딩에서 시작하기로 탐색 이동', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('여기 창업해도 돼? | 서울 창업 입지 탐색');
  await expect(
    page.getByRole('banner').getByRole('link', { name: '여기 창업해도 돼?' }),
  ).toHaveAttribute('href', '/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /현재 카페 업종을 지원/,
  );
  const hero = page.getByRole('region', {
    name: '창업할 곳, 감으로만 고르지 마세요.',
  });
  await expect(hero.getByRole('heading', { level: 1 })).toBeVisible();
  await hero.getByRole('link', { name: '시작하기', exact: true }).click();
  await expect(page).toHaveURL('/explore');
  await expect(
    page.getByRole('main', { name: '여기 창업해도 돼? 탐색 화면' }),
  ).toBeFocused();
  await noOverflow(page);
});

test('직접 탐색 접속과 SDK 키 누락 안내', async ({ page }) => {
  await page.goto('/explore');
  await expect(
    page.getByRole('main', { name: '여기 창업해도 돼? 탐색 화면' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Kakao JavaScript 키를 설정하면 서울 지도를 탐색할 수 있습니다. 개발 환경 설정 안내를 확인해 주세요.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '지도 확대', exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => 'kakao' in window)).toBe(false);
});

test('잘못된 주소의 404와 홈 복귀', async ({ page }) => {
  await page.goto('/not-a-route');
  await expect(
    page.getByRole('heading', {
      name: '페이지를 찾을 수 없습니다',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('link', { name: '홈으로', exact: true }).click();
  await expect(page).toHaveURL('/');
});

test('전체 화면 지도 위에서 세 메뉴를 열고 닫아도 지도 크기와 Escape 포커스를 유지한다', async ({
  page,
}) => {
  await page.goto('/explore');
  const map = page.getByLabel('Kakao Maps 지도', { exact: true });
  const dock = page.getByRole('navigation', { name: '탐색 메뉴' });
  const fullScreen = page.viewportSize()!;
  const mapBox = { x: 0, y: 0, ...fullScreen };
  await expect.poll(() => map.boundingBox()).toEqual(mapBox);
  await expect(page.getByRole('complementary')).toHaveCount(0);
  for (const name of ['주변 탐색', '상권 분석', '후보지 분석']) {
    const menu = dock.getByRole('button', { name, exact: true });
    await menu.click();
    const panel = page.getByRole('complementary', { name });
    await expect(
      panel.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await expect.poll(() => map.boundingBox()).toEqual(mapBox);
    await expect
      .poll(async () => {
        const panelBox = (await panel.boundingBox())!;
        const dockBox = (await dock.boundingBox())!;
        return panelBox.y + panelBox.height < dockBox.y;
      })
      .toBe(true);
    await page.getByRole('button', { name: `${name} 패널 닫기` }).click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await menu.click();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => map.boundingBox()).toEqual(mapBox);
  }
  await noOverflow(page);
});

test('구·동 선택, 통계 갱신, 탭과 미검증 숫자 차단', async ({ page }) => {
  const statisticsRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/stats/'))
      statisticsRequests.push(request.url());
  });
  await page.goto('/explore');
  await page.getByRole('button', { name: '상권 분석', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '지역을 선택해 주세요' }),
  ).toBeVisible();
  await selectDistrict(page);
  const summary = page.getByRole('region', {
    name: '점포 수 요약',
    exact: true,
  });
  await expect(summary.getByText('120', { exact: true })).toBeVisible();
  const storeChart = page.getByRole('region', { name: '일반·프랜차이즈 점포' });
  await expect(storeChart).toContainText('마포구 · 자치구 전체');
  await expect(storeChart.getByText('상한 110 개')).toBeVisible();
  await expect(
    page.getByRole('region', { name: '당월 추정매출액 요약' }),
  ).toContainText('9,007,199,254,740,993');
  await expect(
    page.getByRole('region', { name: '지역 전체 유동인구 요약' }),
  ).toContainText('123,456.78');
  for (const label of [
    '점포 수 요약',
    '당월 추정매출액 요약',
    '지역 전체 유동인구 요약',
  ]) {
    const card = page.getByRole('region', { name: label, exact: true });
    await expect(card).not.toContainText('%');
    await expect(card).not.toContainText(/비교 불가|↑|↓/);
    await expect(card.getByText(/서비스 DB 게시일/)).toBeVisible();
  }
  await expect(
    page.getByText('전분기 비교 준비 중', { exact: true }),
  ).toHaveCount(1);
  const count = statisticsRequests.length;
  await page.getByRole('tab', { name: '추정매출', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText(
    '9,007,199,254,740,993',
  );
  await expect(
    page.getByRole('region', { name: '주중·주말 추정매출액' }),
  ).toContainText('상한 6,000,000,000,000,000 원');
  await noOverflow(page);
  await page.getByRole('tab', { name: '유동인구', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('123,456.78');
  await expect(
    page.getByRole('region', { name: '남성·여성 유동인구' }),
  ).toContainText('길 단위 유동인구 추정 규모');
  await expect(page.getByRole('tabpanel')).not.toContainText(/전분기|↑|↓/);
  await page.getByRole('tab', { name: '유동인구', exact: true }).press('Home');
  await expect(page.getByRole('tab', { name: '점포 현황' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(statisticsRequests.length).toBe(count);
  await selectDistrict(page, '11200');
  await expect(summary.getByText('240', { exact: true })).toBeVisible();
  await selectDistrict(page);
  const filter = page.getByRole('button', { name: '지역 필터', exact: true });
  if (await filter.isVisible()) await filter.click();
  const dong = page.getByRole('combobox', { name: '행정동', exact: true });
  await expect(dong).toBeEnabled();
  await dong.selectOption('11440660');
  if (await filter.isVisible()) await dong.press('Escape');
  await expect(
    page.getByRole('heading', { name: '마포구 · 서교동', exact: true }),
  ).toBeVisible();
  await expect(summary.getByText('30', { exact: true })).toBeVisible();
  await expect(storeChart).toContainText('마포구 · 서교동 · 행정동 전체');
  await expect(storeChart.getByText('상한 20 개')).toBeVisible();
  await noOverflow(page);
});

test('매출 API 오류는 독립 표시하고 사용자 재시도로 복구', async ({
  page,
  allowHttpErrors,
}) => {
  allowHttpErrors.add('/api/v1/districts/11440/stats/sales');
  await scenario(page, 'sales-error');
  await page.goto('/explore');
  await selectDistrict(page);
  await page.getByRole('button', { name: '상권 분석', exact: true }).click();
  const sales = page.getByRole('region', { name: '당월 추정매출액 요약' });
  const retry = { name: '당월 추정매출액 다시 시도', exact: true };
  await expect(
    sales.getByRole('alert').filter({ has: page.getByRole('button', retry) }),
  ).toContainText('통계 데이터가 아직 준비되지 않았습니다.');
  await expect(
    page.getByRole('region', { name: '점포 수 요약' }),
  ).toContainText('120');
  await expect(
    page.getByRole('region', { name: '지역 전체 유동인구 요약' }),
  ).toContainText('123,456.78');
  await scenario(page, 'normal');
  await sales.getByRole('button', retry).click();
  await expect(sales).toContainText('9,007,199,254,740,993');
});

test('선택 분기가 지역과 두 분석 패널에 유지되며 새로고침하면 기본 분기로 돌아간다', async ({
  page,
}) => {
  await page.addInitScript(
    (items) =>
      sessionStorage.setItem(
        'recycleyoungs.candidates',
        JSON.stringify({ version: 1, items }),
      ),
    candidates.slice(0, 2),
  );
  const started = new Set<string>();
  const pending = new Map<Request, string>();
  const completed: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.includes('/stats/')) return;
    const key = `${url.pathname}?quarterCode=${url.searchParams.get('quarterCode')}`;
    started.add(key);
    pending.set(request, key);
  });
  page.on('requestfinished', (request) => {
    const key = pending.get(request);
    pending.delete(request);
    if (key && request.existingResponse()?.ok()) completed.push(key);
  });
  page.on('requestfailed', (request) => {
    pending.delete(request);
  });
  await page.goto('/explore');
  await selectDistrict(page);
  await page.getByRole('button', { name: '상권 분석', exact: true }).click();
  const quarter = page.getByRole('combobox', { name: '통계 기준 분기' });
  const stores = page.getByRole('region', { name: '점포 수 요약' });
  await expect(quarter).toHaveValue('20262');
  await expect(stores).toContainText('120');
  const storeChart = page.getByRole('region', { name: '일반·프랜차이즈 점포' });
  const generalStoreCount = storeChart
    .getByText('일반 점포 수', { exact: true })
    .locator('..')
    .locator('dd');
  const franchiseBar = storeChart
    .getByText('프랜차이즈 점포 수')
    .locator('..')
    .locator('rect');
  await expect(generalStoreCount.getByText(/^110\s*개$/)).toBeVisible();
  await expect(franchiseBar).toHaveAttribute('width', '909');
  // StrictMode에서 취소된 요청도 시작 기록에는 남습니다.
  const expected = ['foot-traffic', 'sales', 'stores'].map(
    (metric) => `/api/v1/districts/11440/stats/${metric}?quarterCode=20262`,
  );
  await expect.poll(() => pending.size).toBe(0);
  expect([...started].sort()).toEqual(expected);
  expect(completed.sort()).toEqual(expected);
  await expect(stores.locator('time')).toHaveText('2026년 7월 2일');
  await expect(
    quarter.getByRole('option', { name: '2026년 3분기 · 일부 지표' }),
  ).toHaveCount(1);
  const details = page.getByText('데이터 출처 상세', { exact: true });
  await details.press('Enter');
  await expect(
    page.getByRole('link', { name: '서울시 상권분석서비스(점포-자치구)' }),
  ).toHaveAttribute(
    'href',
    'https://data.seoul.go.kr/dataList/OA-22173/S/1/datasetView.do',
  );
  await details.press('Enter');
  await quarter.selectOption('20263');
  await expect(stores).toContainText('130');
  await expect(generalStoreCount.getByText(/^120\s*개$/)).toBeVisible();
  await expect(franchiseBar).toHaveAttribute('width', '833');
  await expect(stores.locator('time')).toHaveText('2026년 10월 2일');
  await expect(
    page.getByText('자치구 · 추정매출·유동인구 미게시'),
  ).toBeVisible();
  await expect(
    page.getByText('행정동 · 점포·추정매출·유동인구 미게시'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: '당월 추정매출액 요약' }),
  ).toContainText('자료 없음');
  await expect(
    page.getByRole('region', { name: '당월 추정매출액 요약' }).locator('time'),
  ).toHaveCount(0);
  await quarter.selectOption('20261');
  await expect(stores).toContainText('110');
  await expect(generalStoreCount.getByText(/^100\s*개$/)).toBeVisible();
  await expect(franchiseBar).toHaveAttribute('width', '1000');
  await expect(stores.locator('time')).toHaveText('2026년 4월 2일');
  await selectDistrict(page, '11200');
  await expect(quarter).toHaveValue('20261');
  await expect(stores).toContainText('230');
  await expect(storeChart).toContainText('성동구 · 자치구 전체');
  await expect(generalStoreCount.getByText(/^220\s*개$/)).toBeVisible();
  await expect(franchiseBar).toHaveAttribute('width', '454');
  await page.getByRole('button', { name: '후보지 분석', exact: true }).click();
  await expect(quarter).toHaveValue('20261');
  const candidate = page.getByRole('region', { name: '후보지 A 행정동 통계' });
  await expect(candidate).toContainText('2026년 1분기');
  await expect(candidate).toContainText('20개');
  const competition = page.getByRole('region', {
    name: '후보지 A 주변 경쟁 환경',
  });
  await expect(competition.locator('time[datetime="2026-10"]')).toHaveText(
    '2026년 10월',
  );
  await expect(
    competition.locator('time[datetime="2026-11-16T15:00:00Z"]'),
  ).toHaveText('2026년 11월 17일');
  await quarter.selectOption('20262');
  await expect(candidate).toContainText('30개');
  await expect(
    candidate.locator('time[datetime="2026-07-01T15:00:00Z"]'),
  ).toHaveText('2026년 7월 2일');
  await expect(competition.locator('time[datetime="2026-10"]')).toHaveText(
    '2026년 10월',
  );
  await expect(
    competition.locator('time[datetime="2026-11-16T15:00:00Z"]'),
  ).toHaveText('2026년 11월 17일');
  await quarter.selectOption('20261');
  await expect(candidate).toContainText('20개');
  await page.reload();
  await page.getByRole('button', { name: '후보지 분석', exact: true }).click();
  await expect(quarter).toHaveValue('20262');
  await expect(candidate).toContainText('30개');
  await noOverflow(page);
});

test('분기 목록 실패 상태에서 반경 조회가 유지되고 목록 재시도로 통계가 열린다', async ({
  page,
  allowHttpErrors,
}) => {
  allowHttpErrors.add('/api/v1/statistics/quarters');
  await scenario(page, 'quarters-error');
  await page.addInitScript(
    (items) =>
      sessionStorage.setItem(
        'recycleyoungs.candidates',
        JSON.stringify({ version: 1, items }),
      ),
    candidates.slice(0, 1),
  );
  await page.goto('/explore');
  await page.getByRole('button', { name: '후보지 분석', exact: true }).click();
  const quarter = page.getByRole('combobox', { name: '통계 기준 분기' });
  await expect(
    page.getByText(
      '통계 분기 목록을 조회할 데이터가 아직 준비되지 않았습니다.',
    ),
  ).toBeVisible();
  await expect(quarter).toBeDisabled();
  await expect(
    page.getByRole('region', { name: '후보지 A 요약' }),
  ).toContainText('3곳');
  await expect(
    page.getByRole('region', { name: '후보지 A 행정동 통계' }),
  ).toHaveCount(0);
  await scenario(page, 'normal');
  await page.getByRole('button', { name: '분기 목록 다시 시도' }).click();
  await expect(quarter).toHaveValue('20262');
  await expect(
    page.getByRole('region', { name: '후보지 A 행정동 통계' }),
  ).toContainText('30개');
});

test('매출 자료 없음은 조회 오류와 구분', async ({ page }) => {
  await scenario(page, 'sales-empty');
  await page.goto('/explore');
  await selectDistrict(page);
  await page.getByRole('button', { name: '상권 분석', exact: true }).click();
  const sales = page.getByRole('region', { name: '당월 추정매출액 요약' });
  await expect(sales).toContainText('자료 없음');
  await expect(sales.getByRole('alert')).toHaveCount(0);
  await page.getByRole('tab', { name: '추정매출', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText(
    '선택한 지역·조회 조건의 통계 자료가 없습니다.',
  );
  await expect(
    page.getByRole('region', { name: '주중·주말 추정매출액' }),
  ).toHaveCount(0);
});

test('지역 API 오류와 재시도', async ({ page, allowHttpErrors }) => {
  allowHttpErrors.add('/api/v1/districts');
  await scenario(page, 'districts-error');
  await page.goto('/explore');
  await openRegionFilter(page);
  await expect(
    page.getByRole('button', { name: '자치구 목록 다시 시도' }),
  ).toBeVisible();
  await scenario(page, 'normal');
  await page.getByRole('button', { name: '자치구 목록 다시 시도' }).click();
  await expect(
    page.getByRole('combobox', { name: '자치구', exact: true }),
  ).toBeEnabled();
});

test('후보지 빈 목록 안내', async ({ page }) => {
  await page.goto('/explore');
  await page.getByRole('button', { name: '후보지 분석', exact: true }).click();
  await expect(
    page.getByText(
      '등록된 후보지가 없습니다. 지도 또는 장소 검색에서 추가하세요.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '지도에서 후보지 추가', exact: true }),
  ).toBeDisabled();
});

test('합성 후보지 세 곳 복원, 공통 반경 변경과 삭제', async ({ page }) => {
  await page.addInitScript(
    (items) =>
      sessionStorage.setItem(
        'recycleyoungs.candidates',
        JSON.stringify({ version: 1, items }),
      ),
    candidates,
  );
  await page.goto('/explore');
  await page.getByRole('button', { name: '후보지 분석', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '3개 후보지 분석' }),
  ).toBeVisible();
  for (const slot of ['A', 'B', 'C'])
    await expect(
      page.getByRole('region', { name: `후보지 ${slot} 요약`, exact: true }),
    ).toBeVisible();
  const competition = page.getByRole('region', {
    name: '후보지 A 주변 경쟁 환경',
  });
  await expect(competition).toContainText('3곳');
  await expect(competition).toContainText('합성 경쟁 카페');
  await page
    .getByRole('combobox', { name: '공통 탐색 반경' })
    .selectOption('1000');
  await expect(competition).toContainText('7곳');
  await expect(competition).toContainText('공통 반경 1km');
  await page
    .getByRole('combobox', { name: '공통 탐색 반경' })
    .selectOption('500');
  await expect(competition).toContainText('공통 반경 500m');
  await page
    .getByRole('textbox', { name: '후보지 A 이름', exact: true })
    .fill('합성 이름 변경');
  await page
    .getByRole('button', { name: '후보지 A 이름 저장', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: '후보지 A 지도에서 위치 확인',
      exact: true,
    }),
  ).toHaveText('합성 이름 변경');
  await page
    .getByRole('button', { name: '후보지 B 삭제', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: '후보지 B 요약', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '2개 후보지 분석' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem('recycleyoungs.candidates')!).items
          .length,
    ),
  ).toBe(2);
  await noOverflow(page);
});

test('최대 세 곳을 넘는 저장 데이터는 복원하지 않음', async ({ page }) => {
  await page.addInitScript(
    (items) =>
      sessionStorage.setItem(
        'recycleyoungs.candidates',
        JSON.stringify({
          version: 1,
          items: [
            ...items,
            {
              slot: 'D',
              name: '초과 후보지',
              longitude: 126.925,
              latitude: 37.55,
            },
          ],
        }),
      ),
    candidates,
  );
  await page.goto('/explore');
  await page.getByRole('button', { name: '후보지 분석', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '후보지 등록', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: '후보지 A 요약', exact: true }),
  ).toHaveCount(0);
});
