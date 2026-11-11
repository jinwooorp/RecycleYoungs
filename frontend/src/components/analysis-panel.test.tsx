import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ExploreApp from '@/App';
import { AnalysisPanel } from './analysis-panel';
import type { RegionExplorer } from '@/hooks/use-region-explorer';
import * as comparison from '@/lib/statistic-comparison';
import { MemoryRouter } from 'react-router';

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
) {
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
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
  await screen.findByRole('option', { name: '종로구' });
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: code },
  });
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
function expectPublication(original: string, formatted: string) {
  const time = screen.getByRole('tabpanel').querySelector('time');
  expect(time).toHaveAttribute('datetime', original);
  expect(time).toHaveTextContent(formatted);
}

test('지역 미선택·닫힌 패널은 통계를 요청하지 않고 안내와 접근 가능한 탭을 제공한다', async () => {
  const fetch = mockApi();
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(
    screen.getByText('상단 지역 필터에서 자치구 또는 행정동을 선택해 주세요.'),
  ).toBeVisible();
  expect(screen.getByRole('tab', { name: '점포 현황' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(fetch.mock.calls.some(([url]) => url.includes('/stats/'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  await chooseDistrict();
  expect(fetch.mock.calls.some(([url]) => url.includes('/stats/'))).toBe(false);
});

test('구 공식 통계·동 통계를 실제 DTO로 표시하고 정밀도·당월 의미·NULL·출처를 유지한다', async () => {
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
      '9,007,199,254,740,993.123456789012345678900',
    ),
  ).toBeVisible();
  expect(screen.getByText('123.456789012345678900')).toBeVisible();
  expect(screen.getByText('0.0000')).toBeVisible();
  expect(screen.getByText('자료 없음')).toBeVisible();
  expectPublication(sourceBatch.publishedAt, '2026년 10월 2일 오후 9:34:56');
  fireEvent.click(screen.getByRole('tab', { name: '추정매출' }));
  await within(screen.getByRole('tabpanel')).findByText(
    '9,223,372,036,854,775,807',
  );
  expect(
    within(screen.getByRole('tabpanel')).getByText('당월 추정매출액'),
  ).toBeVisible();
  expect(
    screen.getByText(/분기 합계·월평균으로 환산하지 않습니다/),
  ).toBeVisible();
  expectPublication(
    sales.sourceBatch.publishedAt,
    '2026년 10월 3일 오전 9:00:00',
  );
  fireEvent.keyDown(screen.getByRole('tab', { name: '추정매출' }), {
    key: 'ArrowRight',
  });
  await within(screen.getByRole('tabpanel')).findByText(
    '9,007,199,254,740,993.123456789012345678900',
  );
  expect(screen.getByRole('tab', { name: '유동인구' })).toHaveFocus();
  expect(screen.getByText(/카페 업종 전용 통계가 아닙니다/)).toBeVisible();
  expectPublication(
    foot.sourceBatch.publishedAt,
    '2026년 10월 4일 오전 9:00:00',
  );
  for (const [url] of fetch.mock.calls.filter(([url]) =>
    url.includes('/stats/'),
  )) {
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.pathname).toContain('/districts/11110/stats/');
    expect(['20261', '20262']).toContain(
      parsed.searchParams.get('quarterCode'),
    );
    expect(parsed.searchParams.get('industryCode')).toBe(
      url.includes('foot-traffic') ? null : 'CS100010',
    );
  }
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/stats/')),
  ).toHaveLength(6);
  expect(
    screen.getByRole('complementary', { name: '상권 분석' }),
  ).not.toHaveTextContent(/20262|CS100010/);
  expect(screen.queryByText(sourceBatch.batchId)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  await chooseDistrict();
  await screen.findByRole('option', { name: '선택동' });
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '11110515' },
  });
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  fireEvent.click(screen.getByRole('tab', { name: '점포 현황' }));
  await within(summary('점포 수')).findByText('9,007,199,254,740,993');
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/dongs/11110515/stats/')),
  ).toHaveLength(6);
  expect(screen.getByText('종로구 · 선택동')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '' },
  });
  await waitFor(() =>
    expect(
      fetch.mock.calls.filter(([url]) =>
        url.includes('/districts/11110/stats/'),
      ),
    ).toHaveLength(12),
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
  fireEvent.click(screen.getByRole('tab', { name: '추정매출' }));
  await within(screen.getByRole('tabpanel')).findByText(
    '9,223,372,036,854,775,807',
  );
  fireEvent.click(screen.getByRole('tab', { name: '유동인구' }));
  expect(
    await within(screen.getByRole('tabpanel')).findAllByText('자료 없음'),
  ).toHaveLength(3);
  expectPublication(
    foot.sourceBatch.publishedAt,
    '2026년 10월 4일 오전 9:00:00',
  );
  fireEvent.click(screen.getByRole('tab', { name: '점포 현황' }));
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '점포 현황 다시 시도' }));
  expect(
    await screen.findByText('선택한 지역·조회 조건의 통계 자료가 없습니다.'),
  ).toBeVisible();
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/stores')),
  ).toHaveLength(3);
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/sales')),
  ).toHaveLength(2);
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/foot-traffic')),
  ).toHaveLength(2);
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
  await waitFor(() => expect(pending).toHaveLength(6));
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  expect(pending.slice(0, 6).every((p) => p.signal.aborted)).toBe(true);
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11140' },
  });
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await waitFor(() => expect(pending).toHaveLength(12));
  await act(async () => {
    for (const p of pending.slice(0, 6)) p.finish(statistic(p.url, stores));
  });
  expect(screen.queryByText('9,007,199,254,740,993')).not.toBeInTheDocument();
  await act(async () => {
    for (const p of pending.slice(6))
      p.finish(
        statistic(
          p.url,
          p.url.includes('/stores')
            ? { ...stores, storeCount: '42' }
            : p.url.includes('/sales')
              ? sales
              : foot,
        ),
      );
  });
  expect(await within(summary('점포 수')).findByText('42')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await waitFor(() => expect(pending).toHaveLength(18));
  view.unmount();
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
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
      ['지역 전체 유동인구', '9,007,199,254,740,993.123456789012345678900'],
    ];
    for (const [other, value] of values)
      if (other !== label)
        expect(within(summary(other)).getByText(value)).toBeVisible();
    fail = false;
    fireEvent.click(
      within(summary(label)).getByRole('button', {
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
    ).toHaveLength(3);
    expect(
      fetch.mock.calls.filter(([url]) => url.includes('/stats/')),
    ).toHaveLength(7);
  },
);

test('요약과 세부는 실제 0·NULL을 구분하고 원본 0.0000과 출처를 보존한다', async () => {
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
  expect(
    within(summary('당월 추정매출액')).getByText('자료 없음'),
  ).toBeVisible();
  expect(
    within(summary('당월 추정매출액')).queryByText('원'),
  ).not.toBeInTheDocument();
  expect(
    within(summary('지역 전체 유동인구')).getByText('0.0000'),
  ).toBeVisible();
  expect(within(screen.getByRole('tabpanel')).getAllByText('0')).toHaveLength(
    2,
  );
  expect(
    within(screen.getByRole('tabpanel')).getByText('자료 없음'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: '추정매출' }));
  expect(
    within(screen.getByRole('tabpanel')).getAllByText('자료 없음'),
  ).toHaveLength(2);
  expectPublication(
    sales.sourceBatch.publishedAt,
    '2026년 10월 3일 오전 9:00:00',
  );
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
    dongCode: '11110515',
    revision: 1,
    districts: loading,
    dongs: loading,
    boundary: loading,
    target: null,
    selectDistrict: vi.fn(),
    selectDong: vi.fn(),
  };
  const view = render(<AnalysisPanel region={region} active={false} />);
  expect(
    screen.getByRole('heading', { name: '행정동 이름 확인 중' }),
  ).toBeVisible();
  expect(
    screen.getByRole('region', { name: '행정구역 전체 통계' }),
  ).not.toHaveTextContent(/11110|11110515|20262|CS100010/);
  view.rerender(
    <AnalysisPanel region={{ ...region, dongCode: '' }} active={false} />,
  );
  expect(
    screen.getByRole('heading', { name: '자치구 이름 확인 중' }),
  ).toBeVisible();
});

test('탭은 좌우·Home·End 키로 포커스와 선택을 함께 이동하고 요약과 API 요청을 유지한다', async () => {
  const fetch = mockApi();
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await within(summary('점포 수')).findByText('9,007,199,254,740,993');
  const storeTab = screen.getByRole('tab', { name: '점포 현황' });
  fireEvent.keyDown(storeTab, { key: 'ArrowLeft' });
  const footTab = screen.getByRole('tab', { name: '유동인구' });
  expect(footTab).toHaveFocus();
  expect(footTab).toHaveAttribute('aria-selected', 'true');
  expect(footTab).toHaveAttribute('tabindex', '0');
  expect(storeTab).toHaveAttribute('tabindex', '-1');
  expect(screen.getByRole('tabpanel')).toHaveAttribute(
    'aria-labelledby',
    footTab.id,
  );
  fireEvent.keyDown(footTab, { key: 'ArrowRight' });
  expect(storeTab).toHaveFocus();
  fireEvent.keyDown(storeTab, { key: 'End' });
  expect(footTab).toHaveFocus();
  fireEvent.keyDown(footTab, { key: 'Home' });
  expect(storeTab).toHaveFocus();
  fireEvent.keyDown(storeTab, { key: 'Tab' });
  expect(storeTab).toHaveAttribute('aria-selected', 'true');
  expect(
    within(summary('당월 추정매출액')).getByText('9,223,372,036,854,775,807'),
  ).toBeVisible();
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/stats/')),
  ).toHaveLength(6);
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
  fireEvent.click(screen.getByRole('tab', { name: '추정매출' }));
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(pending).toHaveLength(12);
  await act(async () => {
    for (const p of pending.slice(6))
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
    for (const p of pending.slice(0, 6))
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
  expect(screen.getByRole('tab', { name: '추정매출' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(within(screen.getByRole('tabpanel')).getByText('100')).toBeVisible();
});

function App() {
  return (
    <MemoryRouter>
      <ExploreApp />
    </MemoryRouter>
  );
}

test('두 분기 세 지표를 한 번씩 조회하며 미검증 증감을 숨기고 각 분기 출처와 사유를 표시한다', async () => {
  const fetch = mockApi();
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await within(summary('점포 수')).findByText(/비교 불가: 두 분기의 지역 경계/);
  expect(
    screen.getByText(/전분기 비교: 2026년 2분기 · 이전 2026년 1분기/),
  ).toBeVisible();
  expect(
    within(summary('당월 추정매출액')).getByText(
      /비교 불가: 당월 추정매출액의 두 분기 기간/,
    ),
  ).toBeVisible();
  expect(
    within(summary('지역 전체 유동인구')).getByText(
      /비교 불가: 유동인구의 두 분기 공간/,
    ),
  ).toBeVisible();
  expect(screen.queryByText(/↑ 증가|↓ 감소|변동 없음/)).not.toBeInTheDocument();
  const queries = fetch.mock.calls
    .filter(([u]) => u.includes('/stats/'))
    .map(([u]) => u);
  expect(queries).toHaveLength(6);
  for (const quarter of ['20261', '20262'])
    expect(
      queries.filter((u) => u.includes('quarterCode=' + quarter)),
    ).toHaveLength(3);
  expect(new Set(queries).size).toBe(6);
  expect(
    within(screen.getByRole('tabpanel')).getAllByText(
      /2026년 10월 2일 오후 9:34:56/,
    ),
  ).toHaveLength(2);
  for (const name of ['추정매출', '유동인구', '점포 현황'])
    fireEvent.click(screen.getByRole('tab', { name }));
  expect(fetch.mock.calls.filter(([u]) => u.includes('/stats/'))).toHaveLength(
    6,
  );
});
test.each([
  ['stores', '점포 수'],
  ['sales', '당월 추정매출액'],
  ['foot-traffic', '지역 전체 유동인구'],
])(
  '이전 분기 %s만 실패하면 현재 통계는 유지하고 실패 요청만 재시도한다',
  async (kind, label) => {
    let fail = true;
    const fetch = mockApi(async (url) =>
      url.includes('/' + kind) && url.includes('quarterCode=20261') && fail
        ? json({ code: 'DATA_NOT_READY' }, 503)
        : statistic(
            url,
            url.includes('/stores')
              ? stores
              : url.includes('/sales')
                ? sales
                : foot,
          ),
    );
    render(<App />);
    await chooseDistrict();
    fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
    await within(summary(label)).findByText(
      /이전 분기 통계: 통계 데이터가 아직 준비되지/,
    );
    expect(
      within(summary('점포 수')).getByText('9,007,199,254,740,993'),
    ).toBeVisible();
    expect(
      within(summary('당월 추정매출액')).getByText('9,223,372,036,854,775,807'),
    ).toBeVisible();
    fail = false;
    fireEvent.click(
      within(summary(label)).getByRole('button', {
        name: '이전 분기 통계 다시 시도',
      }),
    );
    await within(summary(label)).findByText(/비교 불가:/);
    expect(
      fetch.mock.calls.filter(
        ([u]) => u.includes('/' + kind) && u.includes('quarterCode=20261'),
      ),
    ).toHaveLength(2);
    expect(
      fetch.mock.calls.filter(([u]) => u.includes('quarterCode=20262')),
    ).toHaveLength(3);
    expect(
      fetch.mock.calls.filter(([u]) => u.includes('/stats/')),
    ).toHaveLength(7);
  },
);
test('이전 분기 자료가 없으면 0으로 대체하지 않고 비교 불가 사유를 표시한다', async () => {
  mockApi(async (url) =>
    statistic(
      url,
      url.includes('quarterCode=20261')
        ? null
        : url.includes('/stores')
          ? stores
          : url.includes('/sales')
            ? sales
            : foot,
    ),
  );
  render(<App />);
  await chooseDistrict();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await within(summary('점포 수')).findByText(
    '비교 불가: 한 분기의 통계 자료가 없습니다.',
  );
  expect(
    within(summary('점포 수')).getByText('9,007,199,254,740,993'),
  ).toBeVisible();
  expect(screen.queryByText(/변동 없음|0.0%/)).not.toBeInTheDocument();
});

test.each([
  ['increase', '10', '10.0', '↑ 증가 · 10 개 · 10.0%'],
  ['decrease', '-10', '-10.0', '↓ 감소 · 10 개 · -10.0%'],
  ['unchanged', '0', '0.0', '변동 없음 · 0 개 · 0.0%'],
  ['increase', '1', null, '↑ 증가 · 1 개 · 증감률 계산 불가 (이전 값 0)'],
] as const)(
  '검증된 비교 결과의 %s 표시는 색상과 무관하게 방향·수치·계산 불가를 전달한다',
  async (direction, delta, rate, text) => {
    // 원천 공개 정책은 변경하지 않고 검증된 계산 결과의 UI 표현만 별도로 확인합니다.
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
    await within(summary('점포 수')).findByText(text);
    expect(
      within(summary('점포 수')).getByText(
        /증감률은 소수 둘째 자리에서 반올림/,
      ),
    ).toBeVisible();
    expect(
      within(summary('점포 수')).getByText(/창업 유불리 평가가 아닙니다/),
    ).toBeVisible();
  },
);
