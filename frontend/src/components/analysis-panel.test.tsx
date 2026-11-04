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
    quarterCode: '20262',
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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
  await screen.findByText('9,007,199,254,740,993');
  expect(
    within(screen.getByRole('complementary', { name: '상권 분석' })).getByText(
      '종로구',
    ),
  ).toBeVisible();
  expect(screen.getByText('123.456789012345678900')).toBeVisible();
  expect(screen.getByText('0.0000')).toBeVisible();
  expect(screen.getByText('자료 없음')).toBeVisible();
  expect(screen.getByText(sourceBatch.publishedAt)).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: '추정매출' }));
  await screen.findByText('9,223,372,036,854,775,807');
  expect(screen.getByText('당월 추정매출액')).toBeVisible();
  expect(
    screen.getByText(/분기 합계·월평균으로 환산하지 않습니다/),
  ).toBeVisible();
  expect(screen.getByText(sales.sourceBatch.publishedAt)).toBeVisible();
  fireEvent.keyDown(screen.getByRole('tab', { name: '추정매출' }), {
    key: 'ArrowRight',
  });
  await screen.findByText('9,007,199,254,740,993.123456789012345678900');
  expect(screen.getByRole('tab', { name: '유동인구' })).toHaveFocus();
  expect(screen.getByText(/카페 업종 전용 통계가 아닙니다/)).toBeVisible();
  expect(screen.getByText(foot.sourceBatch.publishedAt)).toBeVisible();
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
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  await chooseDistrict();
  await screen.findByRole('option', { name: '선택동' });
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '11110515' },
  });
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  fireEvent.click(screen.getByRole('tab', { name: '점포 현황' }));
  await screen.findByText('9,007,199,254,740,993');
  expect(
    fetch.mock.calls.filter(([url]) => url.includes('/dongs/11110515/stats/')),
  ).toHaveLength(3);
  expect(screen.getByText('종로구 · 선택동')).toBeVisible();
});

test('API별 오류·재시도·data:null과 모든 필드 NULL인 실제 행을 분리한다', async () => {
  let fail = true;
  const fetch = mockApi(async (url) =>
    url.includes('/stores')
      ? fail
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
  await screen.findByText(/통계 데이터가 아직 준비되지/);
  fireEvent.click(screen.getByRole('tab', { name: '추정매출' }));
  await screen.findByText('9,223,372,036,854,775,807');
  fireEvent.click(screen.getByRole('tab', { name: '유동인구' }));
  expect(await screen.findAllByText('자료 없음')).toHaveLength(3);
  expect(screen.getByText(foot.sourceBatch.publishedAt)).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: '점포 현황' }));
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: '점포 현황 다시 시도' }));
  expect(
    await screen.findByText('선택한 지역·조회 조건의 통계 자료가 없습니다.'),
  ).toBeVisible();
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
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '11140' },
  });
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await waitFor(() => expect(pending).toHaveLength(6));
  await act(async () => {
    for (const p of pending.slice(0, 3)) p.finish(statistic(p.url, stores));
  });
  expect(screen.queryByText('9,007,199,254,740,993')).not.toBeInTheDocument();
  await act(async () => {
    for (const p of pending.slice(3))
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
  expect(await screen.findByText('42')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석 패널 닫기' }));
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await waitFor(() => expect(pending).toHaveLength(9));
  view.unmount();
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
});

function App() {
  return (
    <MemoryRouter>
      <ExploreApp />
    </MemoryRouter>
  );
}
