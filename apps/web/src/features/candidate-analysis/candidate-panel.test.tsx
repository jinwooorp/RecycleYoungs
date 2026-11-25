import { StrictMode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { CandidatePanel } from './candidate-panel';
import { useCandidates } from './use-candidates';
import {
  candidateStorageKey,
  candidateSlots,
  readCandidateStorage,
  type Candidate,
} from '@/entities/candidate/candidates';

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

function Fixture({
  active = true,
  quarter = '20262',
  mapReady = true,
}: {
  active?: boolean;
  quarter?: string;
  mapReady?: boolean;
}) {
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
        quarter={quarter}
        mapReady={mapReady}
        onSelect={(item) => candidates.setSelected(item.slot)}
      />
    </>
  );
}

function openDetails(slot: string) {
  fireEvent.click(
    screen.getByRole('button', { name: `후보지 ${slot} 상세 및 관리 열기` }),
  );
}

function comparisonCell(group: string, label: string, slot: string) {
  const table = within(screen.getByRole('table', { name: group }));
  const column = table
    .getAllByRole('columnheader')
    .findIndex((header) => header.textContent?.startsWith(`${slot} ·`));
  const row = table.getByRole('rowheader', { name: label }).closest('tr')!;
  return within(within(row).getAllByRole('cell')[column - 1]);
}

function seedCandidates(items: Candidate[]) {
  localStorage.setItem(
    candidateStorageKey,
    JSON.stringify({
      version: 2,
      items: items.map((item) => ({ ...item, note: '' })),
    }),
  );
}

function savedCandidates() {
  const result = readCandidateStorage('localStorage');
  expect(result.status).toBe('ready');
  return result.status === 'ready' ? result.items : [];
}

afterEach(() => {
  localStorage.removeItem(candidateStorageKey);
  sessionStorage.removeItem(candidateStorageKey);
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
  expect(screen.getByRole('region', { name: '후보지 요약' })).toBeVisible();
  openDetails('A');
  fireEvent.change(screen.getByRole('textbox', { name: '후보지 A 이름' }), {
    target: { value: '새 이름' },
  });
  fireEvent.click(screen.getByRole('button', { name: '후보지 A 이름 저장' }));
  openDetails('B');
  fireEvent.click(screen.getByRole('button', { name: '후보지 B 삭제' }));
  expect(savedCandidates()).toEqual([
    { slot: 'A', name: '새 이름', ...center, note: '' },
    {
      slot: 'C',
      name: '후보지 C',
      longitude: 127.02,
      latitude: 37.5,
      note: '',
    },
  ]);
  fireEvent.click(screen.getByRole('button', { name: '등록 3' }));
  await screen.findByText('후보지 B를 등록했습니다.');
  const saved = JSON.parse(localStorage.getItem(candidateStorageKey)!);
  expect(saved.items.map((item: { slot: string }) => item.slot)).toEqual([
    'A',
    'B',
    'C',
  ]);

  view.unmount();
  localStorage.setItem(
    candidateStorageKey,
    JSON.stringify({
      ...saved,
      items: saved.items.reverse(),
    }),
  );
  render(<Fixture />);
  for (const slot of ['A', 'B', 'C']) openDetails(slot);
  expect(
    screen
      .getAllByRole('textbox', { name: /후보지 [ABC] 이름/ })
      .map((input) => input.getAttribute('aria-label')),
  ).toEqual(['후보지 A 이름', '후보지 B 이름', '후보지 C 이름']);
  expect(
    screen.getByRole('button', { name: '후보지 A 지도에서 위치 확인' }),
  ).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: '후보지 A 요약' })).getByRole(
      'heading',
      { name: 'A · 새 이름' },
    ),
  ).toBeVisible();
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
  expect(readCandidateStorage('sessionStorage').status).toMatch(
    /invalid|unsupported/,
  );
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
  expect(readCandidateStorage('localStorage').status).toBe('missing');
});

test('동 경계 후보지는 반경 카페만 비교하고 다른 후보지는 정확한 원천 통계를 조회한다', async () => {
  seedCandidates([
    { slot: 'A', name: '동 내부', ...center },
    { slot: 'B', name: '동 경계', longitude: 127.01, latitude: 37.5 },
  ]);
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
  await waitFor(() =>
    expect(
      within(
        screen.getByRole('region', { name: '주변 경쟁 환경' }),
      ).getAllByText('401곳'),
    ).toHaveLength(2),
  );
  expect(
    within(
      screen.getByRole('table', { name: '소속 행정동 전체 통계' }),
    ).getAllByText(/여러 행정동 경계/),
  ).toHaveLength(3);
  expect(await screen.findByText('0개')).toBeVisible();
  openDetails('A');
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
  await waitFor(() =>
    expect(
      within(
        screen.getByRole('region', { name: '주변 경쟁 환경' }),
      ).getAllByText('802곳'),
    ).toHaveLength(2),
  );
  expect(statPaths()).toEqual(before);
});

test('후보지 삭제와 비활성 패널은 요청을 취소하고 늦은 응답을 표시하지 않는다', async () => {
  seedCandidates([{ slot: 'A', name: '대기 위치', ...center }]);
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
  expect(savedCandidates()).toEqual([]);
});

test('반경을 변경하면 이전 카페 응답이 늦게 도착해도 새 건수를 유지한다', async () => {
  seedCandidates([{ slot: 'A', name: '반경 비교', ...center }]);
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
  expect(
    within(
      screen.getByRole('region', { name: '후보지 A 주변 경쟁 환경' }),
    ).getByText('1곳'),
  ).toBeVisible();
  await act(async () => pending.get('500')!.resolve(cafePage(0)));
  expect(screen.queryByText('0곳')).not.toBeInTheDocument();
  expect(
    within(
      screen.getByRole('region', { name: '후보지 A 주변 경쟁 환경' }),
    ).getByText('1곳'),
  ).toBeVisible();
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
  expect(savedCandidates()).toEqual([
    {
      slot: 'A',
      name: '후보지 A',
      longitude: 127.01,
      latitude: 37.5,
      note: '',
    },
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
  seedCandidates([{ slot: 'A', name: '경계 위치', ...center }]);
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
  expect(
    await within(
      screen.getByRole('region', { name: '후보지 A 주변 경쟁 환경' }),
    ).findByText('0곳'),
  ).toBeVisible();
  expect(fetch.mock.calls.some(([path]) => path.includes('/stats/'))).toBe(
    false,
  );
  expect(
    within(
      screen.getByRole('region', { name: '후보지 A 행정동 통계' }),
    ).getByText(reason),
  ).toBeVisible();
});

const cafeItems = Array.from({ length: 4 }, (_, index) => ({
  bizesId: `cafe-${index}`,
  storeName: ['가까운 카페', '두 번째 카페', '세 번째 카페', '네 번째 카페'][
    index
  ],
  branchName: index === 0 ? '서교점' : null,
  semasIndustryCode: 'I21201',
  semasIndustryName: '카페',
  roadAddress: index === 1 ? null : `서울 예시로 ${index + 1}`,
  lotAddress: '서울 예시동 12',
  longitude: center.longitude,
  latitude: center.latitude,
  distanceM: [0, 12.25, 100, 101][index],
}));
function saveItems(count: number) {
  seedCandidates(
    Array.from({ length: count }, (_, index) => ({
      slot: candidateSlots[index],
      name: `검증 후보지 ${index + 1}`,
      longitude: 127 + index / 100,
      latitude: 37.5,
    })),
  );
}
function analysisApi(
  options: {
    differentDong?: boolean;
    failCafe?: boolean;
    nullSales?: boolean;
    empty?: boolean;
  } = {},
) {
  const fetch = vi.fn(async (path: string) => {
    const url = new URL(path, 'http://localhost');
    if (path.includes('/regions/')) {
      const other =
        options.differentDong && url.searchParams.get('longitude') === '127.01';
      return Response.json(
        other
          ? {
              ...membership,
              dongs: [{ ...dong, dongCode: '00110002', dongName: '다른동' }],
            }
          : membership,
      );
    }
    if (path.includes('/cafes/')) {
      if (options.failCafe && url.searchParams.get('longitude') === '127')
        return new Response(null, { status: 503 });
      return Response.json({
        items: options.empty ? [] : cafeItems,
        totalCount: options.empty ? 0 : 401,
        limit: 200,
        offset: 0,
        hasMore: !options.empty,
        sourceBatch: {
          ...sourceBatch,
          publishedAt:
            url.searchParams.get('longitude') === '127'
              ? '2026-11-16T15:00:00Z'
              : '2026-11-17T15:00:00Z',
          referenceMonth: '202610',
        },
      });
    }
    const foot = path.includes('foot-traffic');
    const sales = path.includes('/sales');
    const quarterCode = url.searchParams.get('quarterCode');
    return Response.json({
      dongCode: url.pathname.split('/')[4],
      quarterCode,
      ...(foot ? {} : { industryCode: 'CS100010' }),
      data: foot
        ? {
            totalFootTraffic: '9007199254740993.123456789012345678900',
            maleFootTraffic: null,
            femaleFootTraffic: null,
            sourceBatch: {
              ...sourceBatch,
              publishedAt: '2026-10-03T00:00:00Z',
            },
          }
        : sales
          ? {
              monthlySalesAmount: options.nullSales
                ? null
                : '9223372036854775807',
              monthlySalesCount: null,
              weekdaySalesAmount: null,
              weekendSalesAmount: null,
              sourceBatch: {
                ...sourceBatch,
                publishedAt: '2026-10-02T00:00:00Z',
              },
            }
          : {
              storeCount: quarterCode === '20261' ? '17' : '0',
              generalStoreCount: null,
              franchiseStoreCount: null,
              openedStoreCount: '0',
              closedStoreCount: null,
              openingRate: null,
              closureRate: null,
              sourceBatch:
                quarterCode === '20261'
                  ? { ...sourceBatch, publishedAt: '2026-08-01T00:00:00Z' }
                  : sourceBatch,
            },
    });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('각 후보지의 메모를 편집·저장·비워도 분석을 다시 조회하지 않는다', async () => {
  saveItems(2);
  const fetch = analysisApi();
  const view = render(<Fixture />);
  await waitFor(() =>
    expect(
      fetch.mock.calls.filter(([path]) => path.includes('/stats/')),
    ).toHaveLength(3),
  );
  const requests = fetch.mock.calls.length;
  openDetails('A');
  const field = screen.getByRole('textbox', { name: '후보지 A 메모' });
  field.focus();
  const plainText = '<strong>현장</strong>\n다시 방문';
  fireEvent.change(field, { target: { value: plainText } });
  expect(savedCandidates()[0].note).toBe('');
  const save = screen.getByRole('button', { name: '후보지 A 메모 저장' });
  fireEvent.click(save);
  expect(field).toHaveFocus();
  expect(screen.getByText('후보지 A 메모를 저장했습니다.')).toBeVisible();
  expect(savedCandidates().map(({ note }) => note)).toEqual([plainText, '']);
  openDetails('B');
  expect(screen.getByRole('textbox', { name: '후보지 B 메모' })).toHaveValue(
    '',
  );
  expect(fetch.mock.calls).toHaveLength(requests);
  const name = screen.getByRole('textbox', { name: '후보지 A 이름' });
  fireEvent.change(name, { target: { value: '새 후보지 이름' } });
  fireEvent.submit(name.closest('form')!);
  expect(savedCandidates()[0].note).toBe(plainText);
  view.unmount();
  render(<Fixture />);
  openDetails('A');
  const restored = screen.getByRole('textbox', { name: '후보지 A 메모' });
  expect(restored).toHaveValue(plainText);
  expect(restored).toHaveAttribute('maxlength', '800');
  fireEvent.change(restored, { target: { value: '가'.repeat(801) } });
  expect(restored).toHaveValue('가'.repeat(800));
  fireEvent.change(restored, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '후보지 A 메모 저장' }));
  expect(savedCandidates()[0].note).toBe('');
});

test('메모 쓰기 실패를 알리고 입력한 값을 유지한다', () => {
  saveItems(1);
  analysisApi();
  render(<Fixture />);
  const editor = screen.getByRole('button', {
    name: '후보지 A 상세 및 관리 열기',
  });
  const details = document.getElementById(
    editor.getAttribute('aria-controls')!,
  );
  expect(details).toBeInTheDocument();
  expect(details).not.toHaveAttribute('open');
  openDetails('A');
  const field = screen.getByRole('textbox', { name: '후보지 A 메모' });
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
  fireEvent.change(field, { target: { value: '실패해도 남는 내용' } });
  fireEvent.click(screen.getByRole('button', { name: '후보지 A 메모 저장' }));
  expect(field).toHaveValue('실패해도 남는 내용');
  expect(screen.getByText(/메모를 지속 저장하지 못했습니다/)).toBeVisible();
  expect(
    screen.queryByText('후보지 A 메모를 저장했습니다.'),
  ).not.toBeInTheDocument();
  write.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: '저장소 다시 확인' }));
  expect(screen.getByText('후보지 A 메모를 저장했습니다.')).toBeVisible();
  expect(savedCandidates()[0].note).toBe('실패해도 남는 내용');
});

test('후보지 0개는 등록 안내와 공통 반경만 제공하고 조회하지 않는다', () => {
  const fetch = analysisApi();
  render(<Fixture />);
  expect(screen.getByText(/등록된 후보지가 없습니다/)).toBeVisible();
  expect(
    screen.queryByRole('region', { name: '후보지 요약' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test.each([1, 2, 3])(
  '후보지 %s개의 행정동 통계와 경쟁 카페를 공통 기준으로 조회하고 실제 게시 정보를 표시한다',
  async (count) => {
    saveItems(count);
    const fetch = analysisApi();
    render(<Fixture />);
    expect(screen.queryAllByRole('table')).toHaveLength(count === 1 ? 0 : 2);
    expect(
      screen.getAllByRole('region', { name: /후보지 [ABC] 요약/ }),
    ).toHaveLength(count);
    if (count > 1) openDetails('A');
    const competition = within(
      screen.getByRole('region', { name: '후보지 A 주변 경쟁 환경' }),
    );
    const stats = within(
      screen.getByRole('region', { name: '후보지 A 행정동 통계' }),
    );
    await competition.findByText('가까운 카페 · 서교점');
    const competitionValue =
      count === 1
        ? competition
        : comparisonCell('주변 경쟁 환경', '전체 경쟁 카페', 'A');
    expect(competitionValue.getByText('401곳')).toBeVisible();
    expect(
      competition
        .getAllByRole('listitem')
        .filter((item) => item.closest('ol'))
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('가까운 카페 · 서교점중심점에서 0m서울 예시로 1'),
      expect.stringContaining('두 번째 카페중심점에서 12.3m서울 예시동 12'),
      expect.stringContaining('세 번째 카페중심점에서 100m서울 예시로 3'),
    ]);
    expect(screen.queryByText('네 번째 카페')).not.toBeInTheDocument();
    const metric = (label: string) =>
      count === 1 ? stats : comparisonCell('소속 행정동 전체 통계', label, 'A');
    const sales = metric('당월 추정매출액');
    expect(await sales.findByText('9,223,372,036,854,775,807원')).toBeVisible();
    expect(
      metric('지역 전체 유동인구').getByText(
        '9,007,199,254,740,993.1234567890123456789명',
      ),
    ).toBeVisible();
    expect(metric('카페 업종 점포 수').getByText('0개')).toBeVisible();
    if (count === 1) {
      for (const date of [
        '2026년 10월 1일',
        '2026년 10월 2일',
        '2026년 10월 3일',
      ]) {
        expect(stats.getByText(date)).toBeVisible();
      }
    } else {
      expect(
        metric('카페 업종 점포 수').getByText('2026년 10월 1일'),
      ).toBeVisible();
      expect(sales.getByText('2026년 10월 2일')).toBeVisible();
      expect(
        metric('지역 전체 유동인구').getByText('2026년 10월 3일'),
      ).toBeVisible();
    }
    const cafeDate = (label: string) =>
      count === 1 ? competition : comparisonCell('주변 경쟁 환경', label, 'A');
    expect(
      cafeDate('카페 원천 기준년월').getByText('2026년 10월'),
    ).toHaveAttribute('dateTime', '2026-10');
    expect(
      cafeDate('서비스 DB 게시일').getByText('2026년 11월 17일'),
    ).toBeVisible();
    const details = stats.getByText('데이터 출처 상세');
    fireEvent.click(details);
    expect(details.parentElement).toHaveAttribute('open');
    expect(
      stats.getByRole('link', {
        name: '서울시 상권분석서비스(점포-행정동)',
      }),
    ).toHaveAttribute(
      'href',
      'https://data.seoul.go.kr/dataList/OA-22172/S/1/datasetView.do',
    );
    expect(
      fetch.mock.calls.filter(([path]) => path.includes('/stats/')),
    ).toHaveLength(3);
    expect(fetch.mock.calls.some(([path]) => path.includes('20261'))).toBe(
      false,
    );
    expect(screen.queryByText(/증감률/)).not.toBeInTheDocument();
  },
);

test('분기 변경은 같은 동의 통계만 한 번씩 갱신한다', async () => {
  saveItems(2);
  const fetch = analysisApi();
  const view = render(<Fixture />);
  const statistics = (slot: string) =>
    comparisonCell('소속 행정동 전체 통계', '카페 업종 점포 수', slot);
  const cafeDate = (slot: string) =>
    comparisonCell('주변 경쟁 환경', '서비스 DB 게시일', slot);
  await statistics('A').findByText('0개');
  await comparisonCell('주변 경쟁 환경', '전체 경쟁 카페', 'B').findByText(
    '401곳',
  );
  const paths = (kind: string) =>
    fetch.mock.calls.filter(([path]) => path.includes(kind));
  const regions = paths('/regions/').length;
  const cafes = paths('/cafes/').length;
  expect(cafeDate('A').getByText('2026년 11월 17일')).toBeVisible();
  expect(cafeDate('B').getByText('2026년 11월 18일')).toBeVisible();
  view.rerender(<Fixture quarter="20261" />);
  expect(statistics('A').queryByText('0개')).not.toBeInTheDocument();
  expect(
    statistics('A').queryByText('2026년 10월 1일'),
  ).not.toBeInTheDocument();
  await statistics('A').findByText('17개');
  await statistics('B').findByText('17개');
  expect(
    screen.getByRole('region', { name: '소속 행정동 전체 통계' }),
  ).toHaveTextContent('2026년 1분기');
  expect(statistics('A').getByText('2026년 8월 1일')).toBeVisible();
  expect(cafeDate('A').getByText('2026년 11월 17일')).toBeVisible();
  expect(paths('/stats/')).toHaveLength(6);
  expect(
    paths('/stats/')
      .slice(3)
      .every(([path]) => path.includes('quarterCode=20261')),
  ).toBe(true);
  expect(paths('/regions/')).toHaveLength(regions);
  expect(paths('/cafes/')).toHaveLength(cafes);
});

test('서로 다른 행정동은 각각 조회하고 반경 변경·이름 변경·카드 선택은 통계를 재조회하지 않는다', async () => {
  saveItems(2);
  const fetch = analysisApi({ differentDong: true });
  render(<Fixture />);
  await within(
    screen.getByRole('region', { name: '후보지 B 요약' }),
  ).findByText(/다른동/);
  await waitFor(() =>
    expect(
      fetch.mock.calls.filter(([p]) => p.includes('/stats/')),
    ).toHaveLength(6),
  );
  const requests = fetch.mock.calls.length;
  openDetails('A');
  const name = screen.getByRole('textbox', { name: '후보지 A 이름' });
  name.focus();
  fireEvent.change(name, { target: { value: '변경된 후보지' } });
  fireEvent.submit(name.closest('form')!);
  expect(name).toHaveFocus();
  const select = screen.getByRole('button', {
    name: '후보지 A 지도에서 위치 확인',
  });
  fireEvent.click(select);
  expect(select).toHaveAttribute('aria-pressed', 'true');
  const selected = within(
    screen.getByRole('region', { name: '후보지 A 요약' }),
  ).getByText('지도 선택됨');
  expect(selected).toBeVisible();
  expect(selected.parentElement).toHaveTextContent('예시구');
  const selectB = screen.getByRole('button', {
    name: '후보지 B 지도에서 위치 확인',
  });
  fireEvent.click(selectB);
  expect(selectB).toHaveAttribute('aria-pressed', 'true');
  expect(select).toHaveAttribute('aria-pressed', 'false');
  expect(selected).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('region', { name: '후보지 B 요약' })).getByText(
      '지도 선택됨',
    ).parentElement,
  ).toHaveTextContent('다른동');
  expect(fetch.mock.calls).toHaveLength(requests);
  fireEvent.change(screen.getByRole('combobox', { name: '공통 탐색 반경' }), {
    target: { value: '1000' },
  });
  await waitFor(() =>
    expect(
      fetch.mock.calls.filter(
        ([p]) => p.includes('/cafes/') && p.includes('radiusM=1000'),
      ),
    ).toHaveLength(2),
  );
  expect(fetch.mock.calls.filter(([p]) => p.includes('/stats/'))).toHaveLength(
    6,
  );
  expect(
    fetch.mock.calls
      .filter(([p]) => p.includes('/cafes/'))
      .every(([p]) => p.includes('limit=200&offset=0')),
  ).toBe(true);
  expect(
    fetch.mock.calls
      .filter(([p]) => p.includes('/stats/') && p.includes('/foot-traffic'))
      .every(([p]) => !p.includes('industryCode')),
  ).toBe(true);
  expect(
    fetch.mock.calls
      .filter(([p]) => p.includes('/stats/'))
      .every(([p]) => p.includes('quarterCode=20262')),
  ).toBe(true);
});

test('한 후보지의 반경 오류는 다른 결과를 가리지 않고 해당 반경만 재시도하며 빈 결과를 구분한다', async () => {
  saveItems(2);
  const options = { failCafe: true, empty: false, nullSales: true };
  const fetch = analysisApi(options);
  render(<Fixture />);
  const count = (slot: string) =>
    comparisonCell('주변 경쟁 환경', '전체 경쟁 카페', slot);
  await count('A').findByRole('alert');
  expect(await count('B').findByText('401곳')).toBeVisible();
  expect(
    await comparisonCell(
      '소속 행정동 전체 통계',
      '당월 추정매출액',
      'A',
    ).findByText('자료 없음'),
  ).toBeVisible();
  options.failCafe = false;
  options.empty = true;
  const before = fetch.mock.calls.length;
  fireEvent.click(
    count('A').getByRole('button', { name: 'A 경쟁 카페 다시 시도' }),
  );
  expect(await count('A').findByText('0곳')).toBeVisible();
  expect(
    comparisonCell('주변 경쟁 환경', '카페 원천 기준년월', 'A').getByText(
      '2026년 10월',
    ),
  ).toBeVisible();
  expect(
    comparisonCell('주변 경쟁 환경', '서비스 DB 게시일', 'A').getByText(
      '2026년 11월 17일',
    ),
  ).toBeVisible();
  expect(fetch.mock.calls).toHaveLength(before + 1);
  expect(count('B').getByText('401곳')).toBeVisible();
  openDetails('A');
  expect(
    within(
      screen.getByRole('region', { name: '후보지 A 주변 경쟁 환경' }),
    ).getByText('선택한 반경 내에 카페가 없습니다.'),
  ).toBeVisible();
});

test('후보지 추가가 기존 분석을 재조회하지 않고 삭제 후 다음 카드 또는 제목으로 포커스를 옮긴다', async () => {
  saveItems(1);
  const fetch = analysisApi();
  render(<Fixture />);
  await within(
    screen.getByRole('region', { name: '후보지 A 주변 경쟁 환경' }),
  ).findByText('401곳');
  const count = () =>
    fetch.mock.calls.filter(
      ([p]) => p.includes('longitude=127&') || p.includes('/stats/'),
    ).length;
  const initial = count();
  fireEvent.click(screen.getByRole('button', { name: '등록 1' }));
  await screen.findByText('후보지 B를 등록했습니다.');
  await comparisonCell('주변 경쟁 환경', '전체 경쟁 카페', 'B').findByText(
    '401곳',
  );
  expect(count()).toBe(initial);
  openDetails('A');
  fireEvent.click(screen.getByRole('button', { name: '후보지 A 삭제' }));
  expect(
    screen.getByRole('button', { name: '후보지 B 상세 및 관리 열기' }),
  ).toHaveFocus();
  openDetails('B');
  fireEvent.click(screen.getByRole('button', { name: '후보지 B 삭제' }));
  expect(screen.getByRole('heading', { name: '후보지 등록' })).toHaveFocus();
});

test('공유 통계의 대표 슬롯을 삭제해도 같은 동의 응답을 남기고 관리 버튼으로 포커스를 돌린다', async () => {
  saveItems(3);
  const fetch = analysisApi({ differentDong: true });
  render(<Fixture mapReady={false} />);
  const metric = (slot: string) =>
    comparisonCell('소속 행정동 전체 통계', '카페 업종 점포 수', slot);
  for (const slot of ['A', 'B', 'C']) await metric(slot).findByText('0개');
  const calls = fetch.mock.calls.length;
  openDetails('A');
  expect(fetch.mock.calls).toHaveLength(calls);
  fireEvent.click(screen.getByRole('button', { name: '후보지 A 삭제' }));
  expect(metric('C').getByText('0개')).toBeVisible();
  expect(metric('C').getByText('2026년 10월 1일')).toBeVisible();
  expect(
    screen.getByRole('button', { name: '후보지 B 지도에서 위치 확인' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: '후보지 B 상세 및 관리 열기' }),
  ).toHaveFocus();
  await act(async () => {});
  expect(fetch.mock.calls).toHaveLength(calls);
});

test('화면 폭을 바꿔도 같은 값을 지표별 카드에서 표시하고 빈 슬롯과 요청을 유지한다', async () => {
  saveItems(3);
  const items = savedCandidates().filter(({ slot }) => slot !== 'B');
  items[0].name = '긴후보지이름'.repeat(10);
  localStorage.setItem(
    candidateStorageKey,
    JSON.stringify({ version: 2, items }),
  );
  let wide = true;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return wide;
    },
    addEventListener: (_event: string, callback: () => void) =>
      listeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) =>
      listeners.delete(callback),
  }));
  const fetch = analysisApi();
  render(<Fixture />);
  await comparisonCell(
    '소속 행정동 전체 통계',
    '당월 추정매출액',
    'A',
  ).findByText('9,223,372,036,854,775,807원');
  const before = fetch.mock.calls.length;
  act(() => {
    wide = false;
    listeners.forEach((listener) => listener());
  });
  expect(screen.queryByRole('table')).toBeNull();
  const sales = within(screen.getByRole('region', { name: '당월 추정매출액' }));
  expect(
    sales.getAllByRole('term').map((term) => term.textContent?.slice(0, 1)),
  ).toEqual(['A', 'C']);
  expect(sales.getByText(`A · ${items[0].name}`)).toBeVisible();
  expect(sales.getAllByText('9,223,372,036,854,775,807원')).toHaveLength(2);
  expect(fetch.mock.calls).toHaveLength(before);
});
