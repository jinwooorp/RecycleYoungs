import {
  selectTestDistricts,
  openTestRegionFilter,
  openTestRegionDongs,
} from '@/test/region-filter';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ExploreApp from '@/pages/explore/explore-page';
import { AnalysisPanel } from './analysis-panel';
import type { RegionExplorer } from '@/features/region-selection/use-region-explorer';
import * as comparison from './statistic-comparison';
import { quarterCatalogFixture } from '@/test/quarter-catalog';
import { MemoryRouter } from 'react-router';
import { metricCodes } from '@/entities/statistics/statistics';

const sourceBatch = {
  batchId: '00000000-0000-0000-0000-000000000004',
  publishedAt: '2026-10-02T12:34:56Z',
};
const stores = {
  storeCount: '9007199254740993',
  generalStoreCount: null,
  franchiseStoreCount: '0',
  openedStoreCount: '1',
  closedStoreCount: '2',
  openingRate: '123.456789012345678900',
  closureRate: '0.0000',
  sourceBatch,
};
const sales = {
  monthlySalesAmount: '9223372036854775807',
  monthlySalesCount: null,
  weekdaySalesAmount: '0',
  weekendSalesAmount: '1',
  sourceBatch: { ...sourceBatch, publishedAt: '2026-10-03T00:00:00Z' },
};
const foot = {
  totalFootTraffic: '9007199254740993.123456789012345678900',
  maleFootTraffic: '0.0000',
  femaleFootTraffic: null,
  sourceBatch: { ...sourceBatch, publishedAt: '2026-10-04T00:00:00Z' },
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
function statistic(url: string, data: unknown) {
  const dong = url.includes('/dongs/');
  return json({
    [dong ? 'dongCode' : 'districtCode']: url.split('/')[4],
    quarterCode: new URL(url, 'http://localhost').searchParams.get(
      'quarterCode',
    ),
    ...(url.includes('/foot-traffic') ? {} : { industryCode: 'CS100010' }),
    data,
  });
}
function mockApi(
  stats?: (url: string, options: RequestInit) => Promise<Response>,
  catalog: () => Response = () => json(quarterCatalogFixture),
) {
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (url === '/api/v1/statistics/quarters') return catalog();
    if (url.includes('/stats/'))
      return stats
        ? stats(url, options)
        : statistic(
            url,
            url.includes('/stores')
              ? stores
              : url.includes('/sales')
                ? sales
                : foot,
          );
    if (url === '/api/v1/districts')
      return json({
        items: [
          { districtCode: '11110', districtName: '종로구' },
          { districtCode: '11140', districtName: '중구' },
        ],
      });
    if (url.endsWith('/dongs'))
      return json({
        items: [
          {
            districtCode: url.split('/')[4],
            dongCode: `${url.split('/')[4]}515`,
            dongName: '선택동',
            labelPoint: { type: 'Point', coordinates: [126.98, 37.57] },
          },
        ],
      });
    return json({
      type: 'Feature',
      id: url.split('/')[4],
      properties: {
        regionCode: url.split('/')[4],
        regionType: url.includes('/dongs/') ? 'DONG' : 'DISTRICT',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [126.9, 37.5],
            [127, 37.5],
            [127, 37.6],
            [126.9, 37.5],
          ],
        ],
      },
    });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function chooseDistrict(code = '11110') {
  openTestRegionFilter();
  await screen.findByRole('button', { name: '종로구' });
  selectTestDistricts(code);
}
beforeEach(() => vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', ''));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function summary(label: string) {
  return screen.getByRole('region', { name: `${label} 요약` });
}

function details() {
  return within(screen.getByRole('region', { name: '선택한 세부 분석' }));
}

function analysisOption(name: string) {
  return within(screen.getByRole('group', { name: '통계 항목' })).getByRole(
    'button',
    { name },
  );
}

test('지역 미선택·닫힌 패널은 통계를 요청하지 않고 지역 선택 후 전체 항목을 선택한다', async () => {
  const fetch = mockApi();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(
    screen.getByText(
      '장소를 검색하거나 지역 필터에서 자치구·행정동을 선택해 주세요.',
    ),
  ).toBeVisible();
  const panel = () => screen.getByRole('complementary', { name: '상권 분석' });
  expect(panel().parentElement).toHaveAttribute('data-compact', 'true');
  expect(within(panel()).getByRole('combobox', { name: '업종' })).toHaveValue(
    'CS100010',
  );
  expect(
    within(panel()).queryByRole('group', { name: '통계 항목' }),
  ).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => url.includes('/stats/'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  await chooseDistrict();
  expect(fetch.mock.calls.some(([url]) => url.includes('/stats/'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(panel().parentElement).toHaveAttribute('data-compact', 'false');
  expect(analysisOption('모두')).toHaveAttribute('aria-pressed', 'true');
});

test('구 공식 통계·동 통계를 실제 DTO로 표시하고 정밀도·당월 의미와 NULL을 유지한다', async () => {
  const fetch = mockApi();
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await within(summary('점포 수')).findByText('9,007,199,254,740,993');
  expect(
    within(screen.getByRole('complementary', { name: '상권 분석' })).getByText(
      '종로구',
    ),
  ).toBeVisible();
  expect(
    within(summary('당월 추정매출액')).getByText('9,223,372,036,854,775,807'),
  ).toBeVisible();
  expect(
    within(summary('지역 전체 유동인구')).getByText(
      '9,007,199,254,740,993.1234567890123456789',
    ),
  ).toBeVisible();
  expect(screen.getByText('123.4567890123456789')).toBeVisible();
  fireEvent.click(analysisOption('점포 현황'));
  expect(
    within(
      screen.getByRole('region', { name: '선택한 세부 분석' }),
    ).getAllByText('0'),
  ).toHaveLength(2);
  expect(screen.getByText('자료 없음')).toBeVisible();
  fireEvent.click(analysisOption('모두'));
  fireEvent.click(analysisOption('추정매출'));
  await within(
    screen.getByRole('region', { name: '선택한 세부 분석' }),
  ).findByText('9,223,372,036,854,775,807');
  expect(
    within(screen.getByRole('region', { name: '선택한 세부 분석' })).getByText(
      '당월 추정매출액',
    ),
  ).toBeVisible();
  const footOption = analysisOption('유동인구');
  footOption.focus();
  fireEvent.click(footOption);
  await within(
    screen.getByRole('region', { name: '선택한 세부 분석' }),
  ).findByText('9,007,199,254,740,993.1234567890123456789');
  expect(screen.getByRole('button', { name: '유동인구' })).toHaveFocus();
  expect(
    screen.queryByText(/점포·매출은 카페·음료 업종/),
  ).not.toBeInTheDocument();
  expect(
    within(
      screen.getByRole('region', { name: '남성·여성 유동인구' }),
    ).getByText('길 단위 유동인구 추정 규모 · 단위 명'),
  ).toBeVisible();
  expect(screen.getByText('자치구 전체')).toBeVisible();
  expect(screen.getByRole('combobox', { name: '통계 기준 분기' })).toHaveValue(
    '20262',
  );
  const industry = screen.getByRole('combobox', { name: '업종' });
  expect(within(industry).getAllByRole('option')).toHaveLength(1);
  expect(within(industry).getByRole('option', { name: '카페' })).toHaveValue(
    'CS100010',
  );
  fireEvent.change(industry, { target: { value: 'CS100010' } });
  for (const [url] of fetch.mock.calls.filter(([url]) =>
    url.includes('/stats/'),
  )) {
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.pathname).toContain('/districts/11110/stats/');
    expect(parsed.searchParams.get('quarterCode')).toBe('20262');
    expect(parsed.searchParams.get('industryCode')).toBe(
      url.includes('foot-traffic') ? null : 'CS100010',
    );
  }
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/stats/')),
  ).toHaveLength(3);
  expect(
    screen.getByRole('complementary', { name: '상권 분석' }),
  ).not.toHaveTextContent(/20262|CS100010/);
  expect(screen.queryByText(sourceBatch.batchId)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  await chooseDistrict();
  await openTestRegionDongs().findByRole('button', { name: '선택동' });
  fireEvent.click(
    openTestRegionDongs().getByRole('button', { name: '선택동' }),
  );
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  fireEvent.click(screen.getByRole('button', { name: '점포 현황' }));
  await within(summary('점포 수')).findByText('9,007,199,254,740,993');
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/dongs/11110515/stats/')),
  ).toHaveLength(3);
  expect(
    screen.getByRole('heading', { name: '종로구 · 선택동' }),
  ).toBeVisible();
  openTestRegionFilter();
  fireEvent.click(
    openTestRegionDongs().getByRole('button', { name: '행정동 전체' }),
  );
  await waitFor(() =>
    expect(
      fetch.mock.calls.filter(([url]) =>
        url.includes('/districts/11110/stats/'),
      ),
    ).toHaveLength(6),
  );
  expect(
    within(
      screen.getByRole('region', { name: '행정구역 전체 통계' }),
    ).getByText('자치구 전체'),
  ).toBeVisible();
  expect(screen.queryByText('종로구 · 선택동')).not.toBeInTheDocument();
});

test('API별 오류·재시도·data:null과 모든 필드 NULL인 실제 행을 분리한다', async () => {
  let fail = true;
  const fetch = mockApi(async (url) =>
    url.includes('/stores')
      ? fail && url.includes('quarterCode=20262')
        ? json({ code: 'DATA_NOT_READY' }, 503)
        : statistic(url, null)
      : statistic(
          url,
          url.includes('/sales')
            ? sales
            : {
                ...foot,
                totalFootTraffic: null,
                maleFootTraffic: null,
                femaleFootTraffic: null,
              },
        ),
  );
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await within(summary('점포 수')).findByText(/통계 데이터가 아직 준비되지/);
  expect(await details().findByText('9,223,372,036,854,775,807')).toBeVisible();
  expect(details().getByRole('alert')).toHaveTextContent('점포 현황');
  expect(
    details().getByRole('region', { name: '남성·여성 유동인구' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '추정매출' }));
  await within(
    screen.getByRole('region', { name: '선택한 세부 분석' }),
  ).findByText('9,223,372,036,854,775,807');
  fireEvent.click(analysisOption('모두'));
  fireEvent.click(analysisOption('유동인구'));
  expect(
    await within(
      screen.getByRole('region', { name: '선택한 세부 분석' }),
    ).findAllByText('자료 없음'),
  ).toHaveLength(3);
  expect(
    screen.getByRole('region', { name: '남성·여성 유동인구' }),
  ).toBeVisible();
  expect(
    screen
      .getByRole('region', { name: '선택한 세부 분석' })
      .querySelector('svg'),
  ).toBeNull();
  expect(
    within(summary('지역 전체 유동인구')).getByText('2026년 10월 4일'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '점포 현황' }));
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '점포 현황 다시 시도' }));
  expect(
    await details().findByText(
      '점포 현황: 선택한 지역·조회 조건의 통계 자료가 없습니다.',
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole('region', { name: '일반·프랜차이즈 점포' }),
  ).toBeNull();
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/stores')),
  ).toHaveLength(2);
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/sales')),
  ).toHaveLength(1);
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/foot-traffic')),
  ).toHaveLength(1);
});

test('빠른 지역 변경·닫기·메뉴 전환은 요청을 취소하고 늦은 지역 응답을 표시하지 않는다', async () => {
  const pending: {
    url: string;
    signal: AbortSignal;
    finish: (response: Response) => void;
  }[] = [];
  mockApi(
    (url, options) =>
      new Promise((resolve) =>
        pending.push({
          url,
          signal: options.signal as AbortSignal,
          finish: resolve,
        }),
      ),
  );
  const view = render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await waitFor(() => expect(pending).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  expect(pending.slice(0, 3).every((p) => p.signal.aborted)).toBe(true);
  selectTestDistricts('11140');
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await waitFor(() => expect(pending).toHaveLength(6));
  await act(async () => {
    for (const p of pending.slice(0, 3)) p.finish(statistic(p.url, stores));
  });
  expect(screen.queryByText('9,007,199,254,740,993')).not.toBeInTheDocument();
  expect(details().getByText('점포 현황 불러오는 중…')).toBeVisible();
  expect(details().getByText('추정매출 불러오는 중…')).toBeVisible();
  const current = pending.slice(3);
  const salesRequest = current.find(({ url }) => url.includes('/sales'))!;
  await act(async () =>
    salesRequest.finish(statistic(salesRequest.url, sales)),
  );
  expect(
    details().getByRole('region', { name: '주중·주말 추정매출액' }),
  ).toBeVisible();
  expect(details().getByText('점포 현황 불러오는 중…')).toBeVisible();
  expect(
    details().queryByRole('region', { name: '일반·프랜차이즈 점포' }),
  ).toBeNull();
  await act(async () => {
    for (const request of current.filter((entry) => entry !== salesRequest)) {
      const data = request.url.includes('/stores')
        ? { ...stores, storeCount: '42' }
        : foot;
      request.finish(statistic(request.url, data));
    }
  });
  expect(await within(summary('점포 수')).findByText('42')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await waitFor(() => expect(pending).toHaveLength(9));
  view.unmount();
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
});

test('여러 구에서는 분석 구를 직접 고를 때만 세 지표를 조회하고 늦은 이전 구 응답은 버린다', async () => {
  const pending: {
    url: string;
    signal: AbortSignal;
    finish: (response: Response) => void;
  }[] = [];
  const fetch = mockApi(
    (url, { signal }) =>
      new Promise((finish) => pending.push({ url, signal: signal!, finish })),
  );
  render(<App />);
  await chooseDistrict();
  selectTestDistricts('11110', '11140');
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await waitFor(() =>
    expect(
      screen.getByRole('combobox', { name: '통계 기준 분기' }),
    ).toHaveValue('20262'),
  );
  expect(pending).toHaveLength(0);
  const district = screen.getByRole('combobox', { name: '분석할 자치구' });
  expect(district).toHaveValue('');
  expect(
    screen.getByRole('heading', { name: '지역을 선택해 주세요' }),
  ).toBeVisible();
  const boundaryRequests = fetch.mock.calls.filter(([url]) =>
    url.endsWith('/boundary'),
  );

  function selectAnalysisDistrict(code: string) {
    fireEvent.change(district, { target: { value: code } });
    const requests = pending.splice(0);
    expect(
      requests
        .map(({ url }) => new URL(url, 'http://localhost').pathname)
        .sort(),
    ).toEqual(
      ['foot-traffic', 'sales', 'stores'].map(
        (metric) => `/api/v1/districts/${code}/stats/${metric}`,
      ),
    );
    return requests;
  }

  const previous = selectAnalysisDistrict('11110');
  const current = selectAnalysisDistrict('11140');
  expect(previous.every(({ signal }) => signal.aborted)).toBe(true);
  await act(async () => {
    for (const { url, finish } of current)
      finish(
        statistic(
          url,
          url.includes('/stores')
            ? { ...stores, storeCount: '42' }
            : url.includes('/sales')
              ? { ...sales, monthlySalesAmount: '88' }
              : { ...foot, totalFootTraffic: '99' },
        ),
      );
  });
  await act(async () => {
    for (const { url, finish } of previous)
      finish(
        statistic(
          url,
          url.includes('/stores')
            ? stores
            : url.includes('/sales')
              ? sales
              : foot,
        ),
      );
  });
  expect(within(summary('점포 수')).getByText('42')).toBeVisible();
  expect(within(summary('당월 추정매출액')).getByText('88')).toBeVisible();
  expect(within(summary('지역 전체 유동인구')).getByText('99')).toBeVisible();
  expect(pending).toHaveLength(0);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/boundary'))).toEqual(
    boundaryRequests,
  );
});

test('세 핵심 지표의 로딩은 독립적이며 먼저 완료된 요약은 다른 응답을 기다리지 않는다', async () => {
  const pending: { url: string; finish: (response: Response) => void }[] = [];
  mockApi(
    (url) => new Promise((resolve) => pending.push({ url, finish: resolve })),
  );
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  for (const label of ['점포 수', '당월 추정매출액', '지역 전체 유동인구']) {
    expect(summary(label)).toHaveAttribute('aria-busy', 'true');
    expect(within(summary(label)).getAllByRole('status')[0]).toHaveTextContent(
      '불러오는 중',
    );
  }
  const salesRequest = pending.find((p) => p.url.includes('/sales'))!;
  await act(async () =>
    salesRequest.finish(statistic(salesRequest.url, sales)),
  );
  expect(
    within(summary('당월 추정매출액')).getByText('9,223,372,036,854,775,807'),
  ).toBeVisible();
  expect(summary('당월 추정매출액')).toHaveAttribute('aria-busy', 'false');
  expect(summary('점포 수')).toHaveAttribute('aria-busy', 'true');
  expect(summary('지역 전체 유동인구')).toHaveAttribute('aria-busy', 'true');
  const storeRequest = pending.find((p) => p.url.includes('/stores'))!;
  await act(async () =>
    storeRequest.finish(statistic(storeRequest.url, stores)),
  );
  expect(
    within(summary('점포 수')).getByText('9,007,199,254,740,993'),
  ).toBeVisible();
  expect(summary('지역 전체 유동인구')).toHaveAttribute('aria-busy', 'true');
});

test.each([
  ['stores', '점포 수'],
  ['sales', '당월 추정매출액'],
  ['foot-traffic', '지역 전체 유동인구'],
])(
  '%s만 실패해도 나머지 핵심 지표를 표시하고 해당 요청만 재시도한다',
  async (kind, label) => {
    let fail = true;
    const data = (url: string) =>
      url.includes('/stores') ? stores : url.includes('/sales') ? sales : foot;
    const fetch = mockApi(async (url) =>
      url.includes('/' + kind) && url.includes('quarterCode=20262') && fail
        ? json({ code: 'DATA_NOT_READY' }, 503)
        : statistic(url, data(url)),
    );
    render(<App />);
    await chooseDistrict();
    fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
    await within(summary(label)).findByRole('alert');
    const values = [
      ['점포 수', '9,007,199,254,740,993'],
      ['당월 추정매출액', '9,223,372,036,854,775,807'],
      ['지역 전체 유동인구', '9,007,199,254,740,993.1234567890123456789'],
    ];
    for (const [other, value] of values)
      if (other !== label)
        expect(within(summary(other)).getByText(value)).toBeVisible();
    fail = false;
    fireEvent.click(
      screen.getByRole('button', {
        name: `${label} 다시 시도`,
      }),
    );
    await waitFor(() =>
      expect(
        within(summary(label)).queryByRole('alert'),
      ).not.toBeInTheDocument(),
    );
    await within(summary(label)).findByText(
      values.find(([name]) => name === label)![1],
    );
    expect(
      fetch.mock.calls.filter(([url]) => url.includes('/' + kind)),
    ).toHaveLength(2);
    expect(
      fetch.mock.calls.filter(([url]) => url.includes('/stats/')),
    ).toHaveLength(4);
  },
);

test('요약과 세부는 실제 0·NULL을 구분하고 화면에서만 후행 0을 제거한다', async () => {
  mockApi(async (url) =>
    statistic(
      url,
      url.includes('/stores')
        ? { ...stores, storeCount: '0' }
        : url.includes('/sales')
          ? { ...sales, monthlySalesAmount: null }
          : { ...foot, totalFootTraffic: '0.0000' },
    ),
  );
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(await within(summary('점포 수')).findByText('0')).toBeVisible();
  expect(within(summary('점포 수')).getByText('개')).toBeVisible();
  expect(within(summary('점포 수')).getByText('2026년 10월 2일')).toBeVisible();
  expect(
    within(summary('당월 추정매출액')).getByText('자료 없음'),
  ).toBeVisible();
  expect(
    within(summary('당월 추정매출액')).getByText('2026년 10월 3일'),
  ).toBeVisible();
  expect(
    within(summary('지역 전체 유동인구')).getByText('2026년 10월 4일'),
  ).toBeVisible();
  expect(
    within(summary('당월 추정매출액')).queryByText('원'),
  ).not.toBeInTheDocument();
  expect(within(summary('지역 전체 유동인구')).getByText('0')).toBeVisible();
  fireEvent.click(analysisOption('점포 현황'));
  expect(
    within(
      screen.getByRole('region', { name: '선택한 세부 분석' }),
    ).getAllByText('0'),
  ).toHaveLength(3);
  expect(
    within(screen.getByRole('region', { name: '선택한 세부 분석' })).getByText(
      '자료 없음',
    ),
  ).toBeVisible();
  fireEvent.click(analysisOption('모두'));
  fireEvent.click(analysisOption('추정매출'));
  expect(
    within(
      screen.getByRole('region', { name: '선택한 세부 분석' }),
    ).getAllByText('자료 없음'),
  ).toHaveLength(2);
});

test('막대는 원본 값·단위를 한 번씩 표시하고 극소 양수·실제 0·결측을 구분한다', async () => {
  mockApi(async (url) =>
    statistic(
      url,
      url.includes('/stores')
        ? stores
        : url.includes('/sales')
          ? sales
          : {
              ...foot,
              maleFootTraffic: '0.0000000000000000000010',
              femaleFootTraffic: '9007199254740993.123456789012345678900',
            },
    ),
  );
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));

  const storeGroup = await screen.findByRole('region', {
    name: '일반·프랜차이즈 점포',
  });
  expect(
    within(storeGroup).getByText('카페·음료 업종 · 단위 개'),
  ).toBeVisible();
  expect(within(storeGroup).getByText('자료 없음')).toBeVisible();
  expect(within(storeGroup).getByText('상한 0 개')).toBeVisible();
  expect(storeGroup.querySelectorAll('svg')).toHaveLength(1);
  expect(storeGroup.querySelector('line')).toBeInTheDocument();
  const turnover = screen.getByRole('region', { name: '개업·폐업 점포' });
  expect(within(turnover).getByText('카페·음료 업종 · 단위 개')).toBeVisible();
  expect(within(turnover).getByText('상한 2 개')).toBeVisible();
  expect(turnover.querySelector('rect')).toHaveAttribute('width', '5000');

  fireEvent.click(screen.getByRole('button', { name: '추정매출' }));
  const salesGroup = await screen.findByRole('region', {
    name: '주중·주말 추정매출액',
  });
  expect(
    within(salesGroup).getByText('카페·음료 업종 · 단위 원'),
  ).toBeVisible();
  expect(within(salesGroup).getByText('상한 1 원')).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: '선택한 세부 분석' })).getByText(
      '9,223,372,036,854,775,807',
    ),
  ).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: '유동인구' }));
  const footGroup = await screen.findByRole('region', {
    name: '남성·여성 유동인구',
  });
  expect(
    within(footGroup).getByText('길 단위 유동인구 추정 규모 · 단위 명'),
  ).toBeVisible();
  for (const chart of [storeGroup, turnover, salesGroup, footGroup]) {
    expect(chart).not.toHaveTextContent(/종로구|자치구 전체|2026년 2분기/);
  }
  expect(within(footGroup).getByText('0.000000000000000000001')).toBeVisible();
  expect(
    within(footGroup).getByText(
      '축에서 막대 폭을 구분하기 어려운 작은 값입니다.',
    ),
  ).toBeVisible();
  expect(
    within(footGroup).getByText('9,007,199,254,740,993.1234567890123456789'),
  ).toBeVisible();
  const svg = footGroup.querySelectorAll('svg');
  expect(svg).toHaveLength(2);
  expect(svg[0]).toHaveAttribute('aria-hidden', 'true');
  expect(svg[0]).toHaveAttribute('focusable', 'false');
  expect(svg[0]).not.toHaveAttribute('tabindex');
  expect(svg[0].querySelector('line')).toBeNull();
  expect(svg[0].querySelector('rect')).toHaveAttribute('width', '0');
  expect(svg[1].querySelector('rect')).toHaveAttribute('width', '10000');
});

test('미확인 지역명은 코드나 임의 명칭 대신 확인 중으로 표시한다', () => {
  const loading = {
    status: 'loading' as const,
    data: null,
    error: null,
    retry: vi.fn(),
  };
  const region: RegionExplorer = {
    districtCode: '11110',
    districtCodes: ['11110'],
    dongCode: '11110515',
    revision: 1,
    cameraKey: '1:0',
    analysis: {
      fromSearch: false,
      districtCode: '11110',
      dongCode: '11110515',
      districtName: undefined,
      dongName: undefined,
    },
    placeRegion: { ...loading, status: 'idle' },
    districts: loading,
    dongs: loading,
    boundary: loading,
    boundaries: [],
    overlays: [],
    analysisDongs: loading,
    searchOutsideFilter: false,
    target: null,
    selectPlace: vi.fn(),
    applyDistricts: vi.fn(),
    selectAnalysisDistrict: vi.fn(),
    selectAnalysisDong: vi.fn(),
    analyzePlace: vi.fn(),
    selectDong: vi.fn(),
  };
  const view = render(
    <AnalysisPanel
      region={region}
      active={false}
      quarter={null}
      selectedMetrics={metricCodes}
      onSelectMetric={vi.fn()}
    />,
  );
  expect(
    screen.getByRole('heading', { name: '행정동 이름 확인 중' }),
  ).toBeVisible();
  expect(
    screen.getByRole('region', { name: '행정구역 전체 통계' }),
  ).not.toHaveTextContent(/11110|11110515|20262|CS100010/);
  view.rerender(
    <AnalysisPanel
      region={{
        ...region,
        analysis: { ...region.analysis, dongCode: '' },
      }}
      active={false}
      quarter={null}
      selectedMetrics={metricCodes}
      onSelectMetric={vi.fn()}
    />,
  );
  expect(
    screen.getByRole('heading', { name: '자치구 이름 확인 중' }),
  ).toBeVisible();
});

test('일곱 가지 선택 조합의 카드와 그래프를 고정 순서로 표시하며 요청을 재사용한다', async () => {
  const fetch = mockApi();
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));

  const stores = '점포 현황';
  const sales = '추정매출';
  const foot = '유동인구';
  const all = '모두';
  const labels = [stores, sales, foot] as const;
  const metricNames = {
    [stores]: ['전체 점포 수', '개업률', '폐업률'],
    [sales]: ['당월 추정매출액', '당월 매출 건수'],
    [foot]: ['전체 유동인구'],
  };
  const chartNames = {
    [stores]: ['일반·프랜차이즈 점포', '개업·폐업 점포'],
    [sales]: ['주중·주말 추정매출액'],
    [foot]: ['남성·여성 유동인구'],
  };
  await details().findByRole('region', { name: chartNames[foot][0] });
  function expectSelection(expected: readonly (typeof labels)[number][]) {
    const selected: readonly string[] =
      expected.length === 3 ? [all] : expected;
    for (const name of [all, ...labels]) {
      const button = analysisOption(name);
      expect(button).toHaveAttribute(
        'aria-pressed',
        String(selected.includes(name)),
      );
      expect(Boolean(button.querySelector('.lucide-check'))).toBe(
        selected.includes(name),
      );
    }
    expect(
      within(details().getByLabelText('세부 지표'))
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(expected.flatMap((name) => metricNames[name]));
    expect(
      details()
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(expected.flatMap((name) => chartNames[name]));
    expect(
      screen.getByRole('region', { name: '핵심 지표' }).querySelectorAll('dl'),
    ).toHaveLength(3);
  }
  function choose(name: string) {
    const button = analysisOption(name);
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveFocus();
  }

  expectSelection(labels);
  choose(stores);
  expectSelection([stores]);
  choose(stores);
  expectSelection([stores]);
  choose(sales);
  expectSelection([stores, sales]);
  choose(stores);
  expectSelection([sales]);
  choose(foot);
  expectSelection([sales, foot]);
  choose(stores);
  expectSelection(labels);
  choose(foot);
  expectSelection([foot]);
  choose(stores);
  expectSelection([stores, foot]);
  choose(all);
  expectSelection(labels);
  choose(sales);
  expectSelection([sales]);
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/stats/')),
  ).toHaveLength(3);
});

test('같은 지역의 패널을 빠르게 재열어도 취소한 응답이 새 요약을 덮어쓰지 않는다', async () => {
  const pending: {
    url: string;
    finish: (response: Response) => void;
    signal: AbortSignal;
  }[] = [];
  mockApi(
    (url, options) =>
      new Promise((resolve) =>
        pending.push({
          url,
          finish: resolve,
          signal: options.signal as AbortSignal,
        }),
      ),
  );
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  fireEvent.click(screen.getByRole('button', { name: '추정매출' }));
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(pending).toHaveLength(6);
  await act(async () => {
    for (const p of pending.slice(3))
      p.finish(
        statistic(
          p.url,
          p.url.includes('/stores')
            ? { ...stores, storeCount: '42' }
            : p.url.includes('/sales')
              ? { ...sales, monthlySalesAmount: '100' }
              : foot,
        ),
      );
    for (const p of pending.slice(0, 3))
      p.finish(
        statistic(
          p.url,
          p.url.includes('/stores')
            ? { ...stores, storeCount: '987' }
            : p.url.includes('/sales')
              ? { ...sales, monthlySalesAmount: '999' }
              : foot,
        ),
      );
  });
  expect(within(summary('점포 수')).getByText('42')).toBeVisible();
  expect(within(summary('당월 추정매출액')).getByText('100')).toBeVisible();
  expect(screen.queryByText('987')).not.toBeInTheDocument();
  expect(screen.queryByText('999')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '추정매출' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    within(screen.getByRole('region', { name: '선택한 세부 분석' })).getByText(
      '100',
    ),
  ).toBeVisible();
});

function App() {
  return (
    <MemoryRouter>
      <ExploreApp />
    </MemoryRouter>
  );
}

test('분기 기본값과 선택이 패널·지역 전환에 유지되며 다시 진입하면 기본값을 쓴다', async () => {
  const fetch = mockApi(async (url) =>
    statistic(
      url,
      url.includes('/stores')
        ? {
            ...stores,
            storeCount: url.includes('20261') ? '42' : '80',
            generalStoreCount: url.includes('20261') ? '39' : '60',
            sourceBatch: url.includes('20261')
              ? { ...sourceBatch, publishedAt: '2026-07-16T15:00:00Z' }
              : sourceBatch,
          }
        : url.includes('/sales')
          ? sales
          : foot,
    ),
  );
  const view = render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  const selector = () =>
    screen.getByRole('combobox', { name: '통계 기준 분기' });
  expect(selector()).toHaveValue('20262');
  await within(summary('점포 수')).findByText('80');
  const requests = () =>
    fetch.mock.calls.filter(([url]) => url.includes('/stats/'));
  expect(requests()).toHaveLength(3);
  expect(requests().every(([url]) => url.includes('quarterCode=20262'))).toBe(
    true,
  );
  expect(screen.getAllByText('전분기 비교 준비 중')).toHaveLength(1);
  expect(
    screen
      .getByRole('region', { name: '선택한 세부 분석' })
      .querySelector('time'),
  ).toBeNull();
  expect(within(summary('점포 수')).getByText('2026년 10월 2일')).toBeVisible();
  const group = () =>
    screen.getByRole('region', { name: '일반·프랜차이즈 점포' });
  expect(within(group()).getByText('상한 60 개')).toBeVisible();
  fireEvent.click(analysisOption('점포 현황'));
  fireEvent.click(analysisOption('추정매출'));
  fireEvent.change(selector(), { target: { value: '20261' } });
  expect(within(summary('점포 수')).queryByText('80')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: '일반·프랜차이즈 점포' }),
  ).toBeNull();
  expect(
    within(summary('점포 수')).queryByText('2026년 10월 2일'),
  ).not.toBeInTheDocument();
  await within(summary('점포 수')).findByText('42');
  expect(within(group()).getByText('상한 39 개')).toBeVisible();
  expect(screen.getByRole('heading', { name: '종로구' })).toBeVisible();
  expect(screen.getByText('자치구 전체')).toBeVisible();
  expect(
    within(selector()).getByRole('option', { selected: true }),
  ).toHaveTextContent('2026년 1분기');
  expect(analysisOption('추정매출')).toHaveAttribute('aria-pressed', 'true');
  expect(
    within(summary('점포 수')).getByText('2026년 7월 17일'),
  ).toHaveAttribute('dateTime', '2026-07-16T15:00:00Z');
  expect(requests().slice(3)).toHaveLength(3);
  expect(
    requests()
      .slice(3)
      .every(([url]) => url.includes('quarterCode=20261')),
  ).toBe(true);
  await chooseDistrict('11140');
  expect(
    screen.queryByRole('region', { name: '일반·프랜차이즈 점포' }),
  ).toBeNull();
  await within(summary('점포 수')).findByText('42');
  expect(screen.getByRole('heading', { name: '중구' })).toBeVisible();
  expect(screen.getByText('자치구 전체')).toBeVisible();
  expect(selector()).toHaveValue('20261');
  expect(analysisOption('추정매출')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '후보지 분석' }));
  expect(selector()).toHaveValue('20261');
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(selector()).toHaveValue('20261');
  expect(analysisOption('점포 현황')).toHaveAttribute('aria-pressed', 'true');
  expect(analysisOption('추정매출')).toHaveAttribute('aria-pressed', 'true');
  expect(analysisOption('유동인구')).toHaveAttribute('aria-pressed', 'false');
  expect(
    fetch.mock.calls.filter(([url]) => url === '/api/v1/statistics/quarters'),
  ).toHaveLength(1);
  view.unmount();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await waitFor(() => expect(selector()).toHaveValue('20262'));
});

test('분기 목록 오류·빈 결과·재시도와 목록에서 사라진 선택을 구분한다', async () => {
  let response: unknown = null;
  const fetch = mockApi(undefined, () =>
    response ? json(response) : json({ code: 'DATA_NOT_READY' }, 503),
  );
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await screen.findByText(
    '통계 분기 목록을 조회할 데이터가 아직 준비되지 않았습니다.',
  );
  expect(fetch.mock.calls.some(([url]) => url.includes('/stats/'))).toBe(false);
  response = {
    ...quarterCatalogFixture,
    quarters: [],
    defaultQuarterCode: null,
  };
  fireEvent.click(screen.getByRole('button', { name: '분기 목록 다시 시도' }));
  await screen.findByText('조회 가능한 통계 분기가 없습니다.');
  expect(fetch.mock.calls.some(([url]) => url.includes('/stats/'))).toBe(false);
  const refresh = () =>
    screen.getByRole('button', { name: '분기 목록 새로고침' });
  response = quarterCatalogFixture;
  fireEvent.click(refresh());
  await within(
    await screen.findByRole('region', { name: '점포 수 요약' }),
  ).findByText('9,007,199,254,740,993');
  response = {
    ...quarterCatalogFixture,
    quarters: quarterCatalogFixture.quarters.slice(1),
    defaultQuarterCode: '20261',
  };
  fireEvent.click(refresh());
  await screen.findByText(
    '선택한 분기를 조회할 수 없습니다. 다른 분기를 선택해 주세요.',
  );
  const selector = screen.getByRole('combobox', { name: '통계 기준 분기' });
  expect(selector).toHaveValue('');
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/stats/')),
  ).toHaveLength(3);
  fireEvent.change(selector, { target: { value: '20261' } });
  await within(summary('점포 수')).findByText('9,007,199,254,740,993');
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/stats/')),
  ).toHaveLength(6);
});

test.each([
  ['increase', '10', '10.0', '↑ 증가 · 10 개 · 10.0%'],
  ['decrease', '-10', '-10.0', '↓ 감소 · 10 개 · -10.0%'],
  ['unchanged', '0', '0.0', '변동 없음 · 0 개 · 0.0%'],
  ['increase', '1', null, '↑ 증가 · 1 개 · 증감률 계산 불가 (이전 값 0)'],
] as const)(
  '내부 %s 계산 결과가 있어도 화면에 방향·수치·증감률을 공개하지 않는다',
  async (direction, delta, rate, text) => {
    // 계산 결과가 전달되더라도 화면에서 증감 공개를 차단합니다.
    vi.spyOn(comparison, 'compareStatistic').mockReturnValue({
      status: 'available',
      direction,
      delta,
      rate,
    });
    mockApi();
    render(<App />);
    await chooseDistrict();
    fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
    const stores = within(summary('점포 수'));
    await stores.findByText('9,007,199,254,740,993');
    expect(screen.getAllByText('전분기 비교 준비 중')).toHaveLength(1);
    expect(stores.queryByText(text)).not.toBeInTheDocument();
    expect(stores.queryByText(/↑|↓|변동 없음|%/)).not.toBeInTheDocument();
  },
);
