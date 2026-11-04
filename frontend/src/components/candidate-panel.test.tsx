import { StrictMode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { CandidatePanel } from './candidate-panel';
import { useCandidates } from '@/hooks/use-candidates';
import { candidateStorageKey, readCandidates } from '@/lib/candidates';

const center = { longitude: 127, latitude: 37.5 };
const sourceBatch = {
  batchId: '00000000-0000-0000-0000-000000000001',
  publishedAt: '2026-10-01T00:00:00Z',
};
const district = {
  districtCode: '00110',
  districtName: '예시구',
  containsCenter: true,
};
const dong = {
  dongCode: '00110001',
  districtCode: '00110',
  dongName: '예시동',
  containsCenter: true,
};
const membership = {
  districts: [district],
  dongs: [dong],
  boundaryBatch: sourceBatch,
};

function Fixture({ active = true }: { active?: boolean }) {
  const candidates = useCandidates();
  return (
    <>
      {[0, 1, 2, 3].map((offset) => (
        <button
          key={offset}
          onClick={() =>
            void candidates.add({
              ...center,
              longitude: center.longitude + offset / 100,
            })
          }
        >
          등록 {offset}
        </button>
      ))}
      <CandidatePanel
        candidates={candidates}
        active={active}
        mapReady
        onSelect={vi.fn()}
      />
    </>
  );
}

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

test('서버 소속 판정, 재시도, 중복·최대 세 곳 제한, 이름 변경·삭제와 탭 복원', async () => {
  let reject = true;
  const fetch = vi.fn(async (path: string) => {
    if (path.startsWith('/api/v1/regions/nearby')) {
      if (reject)
        return Response.json({ code: 'DATA_NOT_READY' }, { status: 503 });
      const url = new URL(path, 'http://localhost');
      expect(url.searchParams.get('radiusM')).toBe('1');
      return Response.json(membership);
    }
    return new Response(null, { status: 503 });
  });
  vi.stubGlobal('fetch', fetch);
  const view = render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '등록 0' }));
  await screen.findByText('지역 데이터가 아직 준비되지 않았습니다.');
  reject = false;
  fireEvent.click(screen.getByRole('button', { name: '등록 다시 시도' }));
  await screen.findByText('후보지 A를 등록했습니다.');
  fireEvent.click(screen.getByRole('button', { name: '등록 0' }));
  expect(screen.getByText('이미 등록된 위치입니다.')).toBeVisible();
  for (const [offset, slot] of [
    [1, 'B'],
    [2, 'C'],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name: `등록 ${offset}` }));
    await screen.findByText(`후보지 ${slot}를 등록했습니다.`);
  }
  fireEvent.click(screen.getByRole('button', { name: '등록 3' }));
  expect(
    screen.getByText('후보지는 최대 3곳까지 등록할 수 있습니다.'),
  ).toBeVisible();
  expect(screen.getByRole('table', { name: '후보지 비교표' })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: '후보지 A 이름' }), {
    target: { value: '새 이름' },
  });
  fireEvent.click(screen.getByRole('button', { name: '후보지 A 이름 저장' }));
  fireEvent.click(screen.getByRole('button', { name: '후보지 B 삭제' }));
  expect(readCandidates()).toEqual([
    { slot: 'A', name: '새 이름', ...center },
    { slot: 'C', name: '후보지 C', longitude: 127.02, latitude: 37.5 },
  ]);
  fireEvent.click(screen.getByRole('button', { name: '등록 3' }));
  await screen.findByText('후보지 B를 등록했습니다.');
  const saved = JSON.parse(sessionStorage.getItem(candidateStorageKey)!);
  expect(saved.items.map((item: { slot: string }) => item.slot)).toEqual([
    'A',
    'B',
    'C',
  ]);

  view.unmount();
  sessionStorage.setItem(
    candidateStorageKey,
    JSON.stringify({
      ...saved,
      items: saved.items.reverse(),
    }),
  );
  render(<Fixture />);
  expect(
    screen
      .getAllByRole('textbox', { name: /후보지 [ABC] 이름/ })
      .map((input) => input.getAttribute('aria-label')),
  ).toEqual(['후보지 A 이름', '후보지 B 이름', '후보지 C 이름']);
  expect(screen.getByRole('button', { name: 'A · 새 이름' })).toBeVisible();
});

test.each([
  'invalid json',
  JSON.stringify({ version: 2, items: [] }),
  JSON.stringify({
    version: 1,
    items: [{ slot: 'A', name: '잘못된 위치', longitude: 181, latitude: 0 }],
  }),
  JSON.stringify({
    version: 1,
    items: Array.from({ length: 4 }, () => ({
      slot: 'A',
      name: '초과',
      ...center,
    })),
  }),
])('손상되거나 지원하지 않는 탭 데이터는 무시합니다: %s', (raw) => {
  sessionStorage.setItem(candidateStorageKey, raw);
  expect(readCandidates()).toEqual([]);
});

test('반경 안에 있더라도 중심점을 덮는 서울 구가 없으면 등록하지 않는다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        districts: [{ ...district, containsCenter: false }],
        dongs: [],
      }),
    ),
  );
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '등록 0' }));
  await screen.findByText(/서울 경계에 속하지 않는 위치/);
  expect(readCandidates()).toEqual([]);
});

test('동 경계 후보지는 반경 카페만 비교하고 다른 후보지는 정확한 원천 통계를 조회한다', async () => {
  sessionStorage.setItem(
    candidateStorageKey,
    JSON.stringify({
      version: 1,
      items: [
        { slot: 'A', name: '동 내부', ...center },
        { slot: 'B', name: '동 경계', longitude: 127.01, latitude: 37.5 },
      ],
    }),
  );
  let retrySales = false;
  const fetch = vi.fn(async (path: string) => {
    const url = new URL(path, 'http://localhost');
    const params = url.searchParams;
    if (path.includes('/regions/'))
      return Response.json(
        params.get('longitude') === '127'
          ? membership
          : {
              ...membership,
              dongs: [
                dong,
                { ...dong, dongCode: '00110002', dongName: '인접동' },
              ],
            },
      );
    if (path.includes('/cafes/'))
      return Response.json({
        items: [],
        limit: 200,
        offset: 0,
        hasMore: true,
        sourceBatch,
        totalCount: params.get('radiusM') === '500' ? 401 : 802,
      });
    const foot = path.includes('foot-traffic');
    const sales = path.includes('/sales');
    if (sales && !retrySales) return new Response(null, { status: 503 });
    return Response.json({
      dongCode: dong.dongCode,
      quarterCode: '20262',
      ...(foot ? {} : { industryCode: 'CS100010' }),
      data: foot
        ? {
            totalFootTraffic: '0',
            maleFootTraffic: null,
            femaleFootTraffic: null,
            sourceBatch,
          }
        : sales
          ? {
              monthlySalesAmount: '9007199254740993',
              monthlySalesCount: null,
              weekdaySalesAmount: null,
              weekendSalesAmount: null,
              sourceBatch,
            }
          : {
              storeCount: '0',
              generalStoreCount: null,
              franchiseStoreCount: null,
              openedStoreCount: '0',
              closedStoreCount: null,
              openingRate: null,
              closureRate: null,
              sourceBatch,
            },
    });
  });
  vi.stubGlobal('fetch', fetch);
  render(<Fixture />);
  await waitFor(() => expect(screen.getAllByText('401곳')).toHaveLength(2));
  expect(screen.getByText(/여러 행정동 경계/)).toBeVisible();
  expect(await screen.findByText('전체 0')).toBeVisible();
  expect(screen.getByText('개업 0 · 폐업 자료 없음')).toBeVisible();
  expect(await screen.findByText('0명')).toBeVisible();
  retrySales = true;
  fireEvent.click(
    await screen.findByRole('button', { name: 'A 추정매출 다시 시도' }),
  );
  expect(await screen.findByText('9,007,199,254,740,993원')).toBeVisible();
  const statPaths = () =>
    fetch.mock.calls
      .map(([path]) => path)
      .filter((path) => path.includes('/stats/'));
  const before = statPaths();
  expect(before).toEqual(
    expect.arrayContaining([
      '/api/v1/dongs/00110001/stats/stores?quarterCode=20262&industryCode=CS100010',
      '/api/v1/dongs/00110001/stats/sales?quarterCode=20262&industryCode=CS100010',
      '/api/v1/dongs/00110001/stats/foot-traffic?quarterCode=20262',
    ]),
  );
  expect(before.every((path) => path.includes('/00110001/'))).toBe(true);
  fireEvent.change(screen.getByRole('combobox', { name: '공통 탐색 반경' }), {
    target: { value: '1000' },
  });
  await waitFor(() => expect(screen.getAllByText('802곳')).toHaveLength(2));
  expect(statPaths()).toEqual(before);
});

test('후보지 삭제와 비활성 패널은 요청을 취소하고 늦은 응답을 표시하지 않는다', async () => {
  sessionStorage.setItem(
    candidateStorageKey,
    JSON.stringify({
      version: 1,
      items: [{ slot: 'A', name: '대기 위치', ...center }],
    }),
  );
  const requests: {
    signal: AbortSignal;
    resolve: (response: Response) => void;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_path: string, { signal }: { signal: AbortSignal }) =>
        new Promise<Response>((resolve) => requests.push({ signal, resolve })),
    ),
  );
  const view = render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
  await waitFor(() => expect(requests.length).toBeGreaterThan(0));
  view.rerender(
    <StrictMode>
      <Fixture active={false} />
    </StrictMode>,
  );
  expect(requests.every(({ signal }) => signal.aborted)).toBe(true);
  view.rerender(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole('button', { name: '후보지 A 삭제' }));
  expect(requests.every(({ signal }) => signal.aborted)).toBe(true);
  await act(async () =>
    requests.forEach(({ resolve }) => resolve(Response.json(membership))),
  );
  expect(screen.queryByText('예시동')).not.toBeInTheDocument();
  expect(readCandidates()).toEqual([]);
});

test('반경을 변경하면 이전 카페 응답이 늦게 도착해도 새 건수를 유지한다', async () => {
  sessionStorage.setItem(
    candidateStorageKey,
    JSON.stringify({
      version: 1,
      items: [{ slot: 'A', name: '반경 비교', ...center }],
    }),
  );
  const pending = new Map<
    string,
    { signal: AbortSignal; resolve: (response: Response) => void }
  >();
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, { signal }: { signal: AbortSignal }) => {
      if (path.includes('/regions/'))
        return Promise.resolve(Response.json({ ...membership, dongs: [] }));
      const radius = new URL(path, 'http://localhost').searchParams.get(
        'radiusM',
      )!;
      return new Promise<Response>((resolve) =>
        pending.set(radius, { signal, resolve }),
      );
    }),
  );
  const cafePage = (totalCount: number) =>
    Response.json({
      items: totalCount
        ? [
            {
              bizesId: 'example',
              storeName: '예시 카페',
              branchName: null,
              semasIndustryCode: 'I21201',
              semasIndustryName: '카페',
              roadAddress: null,
              lotAddress: null,
              ...center,
              distanceM: 0,
            },
          ]
        : [],
      limit: 200,
      offset: 0,
      totalCount,
      hasMore: false,
      sourceBatch,
    });
  render(<Fixture />);
  await waitFor(() => expect(pending.has('500')).toBe(true));
  fireEvent.change(screen.getByRole('combobox', { name: '공통 탐색 반경' }), {
    target: { value: '1000' },
  });
  await waitFor(() => expect(pending.has('1000')).toBe(true));
  expect(pending.get('500')!.signal.aborted).toBe(true);
  await act(async () => pending.get('1000')!.resolve(cafePage(1)));
  expect(screen.getByText('1곳')).toBeVisible();
  await act(async () => pending.get('500')!.resolve(cafePage(0)));
  expect(screen.queryByText('0곳')).not.toBeInTheDocument();
  expect(screen.getByText('1곳')).toBeVisible();
});

test('등록 검증 중 A를 삭제하면 응답 이후 새 위치를 A에 등록한다', async () => {
  let finish!: (response: Response) => void;
  const validation = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetch = vi.fn(async (path: string) => {
    if (!path.includes('/regions/nearby'))
      return new Response(null, { status: 503 });
    if (path.includes('longitude=127.01')) return validation;
    return Response.json(membership);
  });
  vi.stubGlobal('fetch', fetch);
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '등록 0' }));
  await screen.findByText('후보지 A를 등록했습니다.');
  fireEvent.click(screen.getByRole('button', { name: '등록 1' }));
  expect(screen.getByText(/서울 경계에 속하는지 확인 중/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '후보지 A 삭제' }));
  await act(async () => finish(Response.json(membership)));
  expect(readCandidates()).toEqual([
    { slot: 'A', name: '후보지 A', longitude: 127.01, latitude: 37.5 },
  ]);
});

test.each([
  {
    label: '중심점을 포함하는 자치구가 두 곳인 경우',
    regions: {
      ...membership,
      districts: [
        district,
        { ...district, districtCode: '00120', districtName: '인접구' },
      ],
    },
    reason: '여러 자치구 경계에 걸쳐 있어 행정동 통계를 비교할 수 없습니다.',
  },
  {
    label: '유일한 행정동의 자치구 코드가 일치하지 않는 경우',
    regions: { ...membership, dongs: [{ ...dong, districtCode: '00120' }] },
    reason: '자치구와 행정동의 소속 코드가 일치하지 않아 비교할 수 없습니다.',
  },
])('$label 반경 카페만 조회한다', async ({ regions, reason }) => {
  sessionStorage.setItem(
    candidateStorageKey,
    JSON.stringify({
      version: 1,
      items: [{ slot: 'A', name: '경계 위치', ...center }],
    }),
  );
  const fetch = vi.fn(async (path: string) => {
    if (path.includes('/regions/nearby')) return Response.json(regions);
    if (path.includes('/cafes/nearby'))
      return Response.json({
        items: [],
        limit: 200,
        offset: 0,
        totalCount: 0,
        hasMore: false,
        sourceBatch,
      });
    return new Response(null, { status: 503 });
  });
  vi.stubGlobal('fetch', fetch);
  render(<Fixture />);
  expect(await screen.findByText('0곳')).toBeVisible();
  expect(fetch.mock.calls.some(([path]) => path.includes('/stats/'))).toBe(
    false,
  );
  expect(screen.getAllByText(reason)).toHaveLength(3);
});
