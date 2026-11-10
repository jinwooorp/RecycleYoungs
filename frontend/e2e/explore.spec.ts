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
  const hero = page.getByRole('region', {
    name: '카페 창업할 곳, 감으로만 고르지 마세요.',
  });
  await expect(hero.getByRole('heading', { level: 1 })).toBeVisible();
  await hero.getByRole('link', { name: '시작하기', exact: true }).click();
  await expect(page).toHaveURL('/explore');
  await expect(
    page.getByRole('main', { name: 'RecycleYoungs 탐색 화면' }),
  ).toBeFocused();
  await noOverflow(page);
});

test('직접 탐색 접속과 SDK 키 누락 안내', async ({ page }) => {
  await page.goto('/explore');
  await expect(
    page.getByRole('main', { name: 'RecycleYoungs 탐색 화면' }),
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

test('세 메뉴 전환, 닫기와 Escape 포커스', async ({ page }) => {
  await page.goto('/explore');
  for (const name of ['주변 카페', '상권 분석', '후보지 분석']) {
    const menu = page.getByRole('button', { name, exact: true });
    await menu.click();
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: `${name} 패널 닫기` }).click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await menu.click();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
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
  await expect(
    page.getByRole('region', { name: '당월 추정매출액 요약' }),
  ).toContainText('9,007,199,254,740,993');
  await expect(
    page.getByRole('region', { name: '지역 전체 유동인구 요약' }),
  ).toContainText('123,456.7800');
  for (const label of [
    '점포 수 요약',
    '당월 추정매출액 요약',
    '지역 전체 유동인구 요약',
  ]) {
    const card = page.getByRole('region', { name: label, exact: true });
    await expect(card).toContainText('비교 불가:');
    await expect(card).not.toContainText('%');
  }
  const count = statisticsRequests.length;
  await page.getByRole('tab', { name: '추정매출', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText(
    '9,007,199,254,740,993',
  );
  await page.getByRole('tab', { name: '유동인구', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('123,456.7800');
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
  await expect(
    page.getByRole('region', { name: '행정구역 전체 통계' }),
  ).not.toContainText(/창업.*점수|추천 순위/);
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
  ).toContainText('123,456.7800');
  await scenario(page, 'normal');
  await sales.getByRole('button', retry).click();
  await expect(sales).toContainText('9,007,199,254,740,993');
});

test('매출 자료 없음은 조회 오류와 구분', async ({ page }) => {
  await scenario(page, 'sales-empty');
  await page.goto('/explore');
  await selectDistrict(page);
  await page.getByRole('button', { name: '상권 분석', exact: true }).click();
  const sales = page.getByRole('region', { name: '당월 추정매출액 요약' });
  await expect(sales).toContainText('자료 없음');
  await expect(sales.getByRole('alert')).toHaveCount(0);
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
