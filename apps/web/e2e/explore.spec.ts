import type { Page, Request } from '@playwright/test';
import { candidates } from './fixtures';
import type { StoredCandidate } from '../src/lib/candidates';
import {
  test,
  expect,
  scenario,
  openRegionFilter,
  selectDistrict,
  noOverflow,
} from './test-support';

async function seedCandidates(page: Page, items: StoredCandidate[]) {
  await page.goto('/');
  await page.evaluate((items) => {
    localStorage.setItem(
      'recycleyoungs.candidates',
      JSON.stringify({ version: 2, items }),
    );
  }, items);
}

async function candidateValue(
  page: Page,
  group: string,
  label: string,
  slot: string,
) {
  const region = page.getByRole('region', { name: group, exact: true });
  if (await page.evaluate(() => matchMedia('(min-width: 64rem)').matches)) {
    const table = region.getByRole('table', { name: group });
    const column = await table
      .getByRole('columnheader', { name: new RegExp(`^${slot} ·`) })
      .evaluate((el) => (el as HTMLTableCellElement).cellIndex);
    const row = table
      .getByRole('rowheader', { name: label, exact: true })
      .locator('..');
    return row.getByRole('cell').nth(column - 1);
  }
  return region
    .getByRole('region', { name: label, exact: true })
    .locator('dl > div')
    .filter({
      has: page.getByRole('term').filter({ hasText: new RegExp(`^${slot} ·`) }),
    })
    .getByRole('definition');
}

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
  await expect(dock).toHaveCSS('width', '352px');
  await expect(dock).toHaveCSS('height', '62px');
  await expect(page.getByRole('complementary')).toHaveCount(0);
  let panelBox: Awaited<ReturnType<typeof map.boundingBox>> = null;
  for (const name of ['주변 탐색', '상권 분석', '후보지 분석']) {
    const menu = dock.getByRole('button', { name, exact: true });
    const target = (await menu.boundingBox())!;
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
    await menu.click();
    const panel = page.getByRole('complementary', { name });
    await expect(
      panel.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await expect.poll(() => map.boundingBox()).toEqual(mapBox);
    await expect
      .poll(() =>
        panel.evaluate((el) =>
          el
            .getAnimations()
            .some((animation) => animation.playState === 'running'),
        ),
      )
      .toBe(false);
    if (panelBox === null) panelBox = (await panel.boundingBox())!;
    else expect(await panel.boundingBox()).toEqual(panelBox);
    await expect
      .poll(async () => {
        const panelBox = (await panel.boundingBox())!;
        const dockBox = (await dock.boundingBox())!;
        return dockBox.y - (panelBox.y + panelBox.height);
      })
      .toBeCloseTo(8);
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
  await openRegionFilter(page);
  const step = page.getByRole('button', { name: '행정동', exact: true });
  await step.click();
  const dong = page
    .getByRole('group', { name: '행정동 목록' })
    .getByRole('button', { name: '서교동', exact: true });
  await dong.click();
  await dong.press('Escape');
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
  await seedCandidates(page, candidates.slice(0, 2));
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
  const candidate = await candidateValue(
    page,
    '소속 행정동 전체 통계',
    '카페 업종 점포 수',
    'A',
  );
  await expect(
    page.getByRole('region', { name: '소속 행정동 전체 통계' }),
  ).toContainText('2026년 1분기');
  await expect(candidate).toContainText('20개');
  const competition = page.getByRole('region', {
    name: '주변 경쟁 환경',
    exact: true,
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
  await seedCandidates(page, candidates.slice(0, 1));
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
    page.getByRole('region', { name: '후보지 A 주변 경쟁 환경' }),
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
    page.getByRole('button', { name: '마포구', exact: true }),
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

test('탭의 v1을 한 번 이전하고 메뉴 전환·새로고침·새 탭에서 메모를 확인한다', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(({ slot, name, longitude, latitude }) => {
    sessionStorage.setItem(
      'recycleyoungs.candidates',
      JSON.stringify({
        version: 1,
        items: [{ slot, name, longitude, latitude }],
      }),
    );
  }, candidates[0]);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/explore');
  const openCandidates = (tab: Page) =>
    tab.getByRole('button', { name: '후보지 분석', exact: true }).click();
  await openCandidates(page);
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('recycleyoungs.candidates')),
    )
    .toBeNull();
  const noteField = page.getByRole('textbox', { name: '후보지 A 메모' });
  await expect(noteField).toHaveValue('');
  const note = '평일 점심에 방문\n<em>간판 확인</em>';
  await noteField.fill(note);
  await page.getByRole('button', { name: '주변 탐색', exact: true }).click();
  await openCandidates(page);
  await expect(noteField).toHaveValue(note);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('recycleyoungs.candidates')!).items[0]
            .note,
      ),
    )
    .toBe('');
  await noteField.press('Tab');
  const save = page.getByRole('button', { name: '후보지 A 메모 저장' });
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('후보지 A 메모를 저장했습니다.')).toBeVisible();
  await noOverflow(page);
  await page.reload();
  await openCandidates(page);
  await expect(noteField).toHaveValue(note);
  const nextTab = await context.newPage();
  await nextTab.goto('/explore');
  await openCandidates(nextTab);
  await expect(
    nextTab.getByRole('textbox', { name: '후보지 A 메모' }),
  ).toHaveValue(note);
  await nextTab.close();
});

test('다른 탭에서 메모가 바뀌면 입력 중인 메모를 보호한다', async ({
  page,
  context,
}) => {
  await seedCandidates(page, candidates.slice(0, 1));
  await page.goto('/explore');
  const peer = await context.newPage();
  await peer.goto('/explore');
  for (const tab of [page, peer])
    await tab.getByRole('button', { name: '후보지 분석', exact: true }).click();
  const field = page.getByRole('textbox', { name: '후보지 A 메모' });
  const peerField = peer.getByRole('textbox', { name: '후보지 A 메모' });
  const save = { name: '후보지 A 메모 저장' };
  await peerField.fill('첫 저장');
  await peer.getByRole('button', save).click();
  await expect(field).toHaveValue('첫 저장');
  await field.fill('이 탭의 초안');
  await peerField.fill('다른 탭 최신 메모');
  await peer.getByRole('button', save).click();
  await expect(
    page.getByText(/다른 탭의 저장본이 변경되었습니다/),
  ).toBeVisible();
  await expect(field).toHaveValue('이 탭의 초안');
  await page.getByRole('button', save).click();
  await expect(page.getByText(/메모를 지속 저장하지 못했습니다/)).toBeVisible();
  await expect(peerField).toHaveValue('다른 탭 최신 메모');
  await page
    .getByRole('button', { name: '이 탭 변경을 버리고 최신 목록 불러오기' })
    .click();
  await expect(field).toHaveValue('다른 탭 최신 메모');
  await peer.close();
});

test('합성 후보지 세 곳 복원, 공통 반경 변경과 삭제', async ({ page }) => {
  await seedCandidates(page, candidates);
  await page.goto('/explore');
  await page.getByRole('button', { name: '후보지 분석', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '3개 후보지 분석' }),
  ).toBeVisible();
  for (const slot of ['A', 'B', 'C'])
    await expect(
      page.getByRole('region', { name: `후보지 ${slot} 요약`, exact: true }),
    ).toBeVisible();
  const competitionGroup = '주변 경쟁 환경';
  const statisticsGroup = '소속 행정동 전체 통계';
  const cafeCount = (slot: string) =>
    candidateValue(page, competitionGroup, '전체 경쟁 카페', slot);
  const storeCount = (slot: string) =>
    candidateValue(page, statisticsGroup, '카페 업종 점포 수', slot);
  for (const [slot, cafes, stores, month, day] of [
    ['A', '3곳', '30개', '2026-10', '2026년 11월 17일'],
    ['B', '5곳', '45개', '2026-09', '2026년 11월 18일'],
    ['C', '7곳', '30개', '2026-08', '2026년 11월 19일'],
  ]) {
    await expect(await cafeCount(slot)).toHaveText(cafes);
    await expect(await storeCount(slot)).toContainText(stores);
    await expect(
      (
        await candidateValue(page, competitionGroup, '카페 원천 기준년월', slot)
      ).locator('time'),
    ).toHaveAttribute('datetime', month);
    await expect(
      await candidateValue(page, competitionGroup, '서비스 DB 게시일', slot),
    ).toHaveText(day);
  }
  await page
    .getByRole('button', { name: '후보지 A 상세 및 관리 열기' })
    .press('Enter');
  const competition = page.getByRole('region', {
    name: '후보지 A 주변 경쟁 환경',
  });
  await expect(competition).toContainText('합성 경쟁 카페');
  await expect(competition).toContainText('120m');
  await page
    .getByRole('combobox', { name: '공통 탐색 반경' })
    .selectOption('1000');
  await expect(await cafeCount('A')).toHaveText('7곳');
  await expect(await cafeCount('B')).toHaveText('9곳');
  await expect(competition).toContainText('공통 반경 1km');
  await page
    .getByRole('combobox', { name: '공통 탐색 반경' })
    .selectOption('500');
  await expect(await cafeCount('A')).toHaveText('3곳');
  await expect(competition).toContainText('공통 반경 500m');
  await page
    .getByRole('textbox', { name: '후보지 A 이름', exact: true })
    .fill('합성 이름 변경');
  await page
    .getByRole('button', { name: '후보지 A 이름 저장', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: '후보지 A 요약' }),
  ).toContainText('합성 이름 변경');
  await page
    .getByRole('button', { name: '후보지 B 상세 및 관리 열기' })
    .press('Enter');
  await page
    .getByRole('button', { name: '후보지 B 삭제', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: '후보지 B 요약', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '후보지 C 상세 및 관리 열기' }),
  ).toBeFocused();
  await expect(
    page.getByRole('heading', { name: '2개 후보지 분석' }),
  ).toBeVisible();
  await expect(await storeCount('A')).toContainText('30개');
  await expect(await storeCount('C')).toContainText('30개');
  const statsRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/stats/') || request.url().includes('/cafes/'))
      statsRequests.push(request.url());
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(await cafeCount('A')).toHaveText('3곳');
  await expect(await cafeCount('C')).toHaveText('7곳');
  await expect(await storeCount('C')).toContainText('30개');
  expect(statsRequests).toHaveLength(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('recycleyoungs.candidates')!).items
          .length,
    ),
  ).toBe(2);
  await noOverflow(page);
});

test('한 후보지의 반경 오류와 통계 행 부재를 다른 후보지의 값과 구분한다', async ({
  page,
  allowHttpErrors,
}) => {
  allowHttpErrors.add('/api/v1/cafes/nearby');
  await scenario(page, 'candidate-partial');
  await seedCandidates(page, candidates.slice(0, 2));
  await page.goto('/explore');
  await page.getByRole('button', { name: '후보지 분석', exact: true }).click();
  const cafe = (slot: string) =>
    candidateValue(page, '주변 경쟁 환경', '전체 경쟁 카페', slot);
  await expect(await cafe('A')).toHaveText('3곳');
  const failed = await cafe('B');
  await expect(failed.getByRole('alert')).toBeVisible();
  const sales = await candidateValue(
    page,
    '소속 행정동 전체 통계',
    '당월 추정매출액',
    'B',
  );
  await expect(sales).toHaveText('선택한 지역·분기의 자료 없음');
  await expect(sales.locator('time')).toHaveCount(0);
  await scenario(page, 'normal');
  await failed.getByRole('button', { name: 'B 경쟁 카페 다시 시도' }).click();
  await expect(failed).toHaveText('5곳');
  await expect(await cafe('A')).toHaveText('3곳');
});

test('최대 세 곳을 넘는 저장 데이터는 복원하지 않음', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(
    (items) =>
      localStorage.setItem(
        'recycleyoungs.candidates',
        JSON.stringify({
          version: 2,
          items: [
            ...items,
            {
              slot: 'D',
              note: '',
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

test('두 구를 함께 탐색하고 경계만 재시도한 뒤 통계는 한 지역씩 조회한다', async ({
  page,
  allowHttpErrors,
}) => {
  const failed = '/api/v1/districts/11200/boundary';
  const success = '/api/v1/districts/11440/boundary';
  allowHttpErrors.add(failed);
  const requests: string[] = [];
  page.on('response', (response) => {
    requests.push(new URL(response.url()).pathname);
  });
  await scenario(page, 'district-boundary-error');
  await page.goto('/explore');
  const filter = await openRegionFilter(page);
  const mapo = page.getByRole('button', { name: '마포구', exact: true });
  const seongdong = page.getByRole('button', { name: '성동구', exact: true });
  const dongStep = page.getByRole('button', { name: '행정동', exact: true });
  await expect(dongStep).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '적용', exact: true }),
  ).toHaveCount(0);
  await mapo.click();
  await expect(filter).toHaveAccessibleDescription(
    /^적용한 자치구 1개: 마포구/,
  );
  await expect(dongStep).toBeEnabled();
  await mapo.press('Escape');
  await expect(filter).toBeFocused();
  await openRegionFilter(page);
  await expect(mapo).toHaveAttribute('aria-pressed', 'true');
  await seongdong.click();
  await expect(seongdong).toHaveAttribute('aria-pressed', 'true');
  await expect(filter).toHaveAccessibleDescription(
    /^적용한 자치구 2개: 마포구, 성동구/,
  );
  await expect(dongStep).toBeDisabled();

  const retry = page.getByRole('button', { name: '성동구 경계 다시 시도' });
  await expect(retry).toBeVisible();
  await scenario(page, 'normal');
  await retry.click();
  await expect
    .poll(() => requests.filter((path) => path === failed).length)
    .toBe(2);
  expect(requests.filter((path) => path === success)).toHaveLength(1);
  await expect(retry).toBeHidden();
  await filter.press('Escape');
  await page.getByRole('button', { name: '상권 분석', exact: true }).click();
  expect(requests.filter((path) => path.includes('/stats/'))).toHaveLength(0);
  const district = page.getByRole('combobox', { name: '분석할 자치구' });
  const summary = page.getByRole('region', { name: '점포 수 요약' });
  await district.selectOption('11200');
  await expect(summary.getByText('240', { exact: true })).toBeVisible();
  await district.selectOption('11440');
  await expect(summary.getByText('120', { exact: true })).toBeVisible();
  const dong = page.getByRole('combobox', { name: '분석할 행정동' });
  await dong.selectOption('11440660');
  await expect(summary.getByText('30', { exact: true })).toBeVisible();
  expect(requests.filter((path) => path.endsWith('/boundary'))).toHaveLength(3);
  await openRegionFilter(page);
  await page.getByRole('button', { name: '지역 필터 초기화' }).click();
  await expect(filter).toHaveAccessibleDescription(
    '서울특별시 전체 · 선택한 자치구 0개',
  );
  await expect(page.getByRole('button', { name: '서울 전체' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(summary).toHaveCount(0);
  await noOverflow(page);
});
