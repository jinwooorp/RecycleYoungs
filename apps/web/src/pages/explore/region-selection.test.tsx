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
import { StrictMode } from 'react';
import ExploreApp from './explore-page';
import { quarterCatalogFixture } from '@/test/quarter-catalog';
import { MemoryRouter } from 'react-router';

beforeEach(() => vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', ''));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const feature = (code: string, kind: string) => ({
  type: 'Feature',
  id: code,
  properties: { regionType: kind, regionCode: code },
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

test('실제 선택 UI에서 구·동 선택을 유지하고 메뉴 전환·닫기 이후에도 복원한다', async () => {
  const fetch = vi.fn(async (input: string) => {
    if (input === '/api/v1/districts')
      return json({
        items: [
          { districtCode: '00110', districtName: '예시구' },
          { districtCode: '00120', districtName: '다른구' },
        ],
      });
    if (input.endsWith('/dongs'))
      return json({
        items: [
          {
            dongCode: '00110001',
            districtCode: '00110',
            dongName: '예시동',
            labelPoint: { type: 'Point', coordinates: [127, 37] },
          },
        ],
      });
    return json(
      feature(
        input.split('/')[4],
        input.includes('/dongs/') ? 'DONG' : 'DISTRICT',
      ),
    );
  });
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  openTestRegionFilter();
  await screen.findByRole('button', { name: '예시구' });
  selectTestDistricts('00110');
  expect(screen.getByRole('button', { name: '자치구' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  const dongs = openTestRegionDongs();
  expect(dongs.getByRole('button', { name: '행정동 전체' })).toHaveFocus();
  fireEvent.click(await dongs.findByRole('button', { name: '예시동' }));
  expect(screen.getByRole('status', { name: '현재 지역' })).toHaveTextContent(
    '서울특별시 · 예시구 · 예시동',
  );
  fireEvent.click(screen.getByRole('button', { name: '이전 단계: 자치구' }));
  expect(screen.getByRole('button', { name: '예시구' })).toHaveFocus();
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/dongs/00110001/boundary',
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '주변 탐색' }));
  fireEvent.click(screen.getByRole('button', { name: '주변 탐색 패널 닫기' }));
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(openTestRegionFilter()).toHaveAccessibleDescription(
    '적용한 자치구 1개: 예시구 · 예시동',
  );
  expect(
    openTestRegionDongs().getByRole('button', { name: '예시동' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith('/dongs')),
  ).toHaveLength(1);
  fireEvent.click(
    openTestRegionDongs().getByRole('button', { name: '행정동 전체' }),
  );
  expect(screen.getByRole('status', { name: '현재 지역' })).toHaveTextContent(
    '서울특별시 · 예시구',
  );
  fireEvent.click(
    openTestRegionDongs().getByRole('button', { name: '예시동' }),
  );
  fireEvent.click(screen.getByRole('button', { name: '이전 단계: 자치구' }));
  const other = screen.getByRole('button', { name: '다른구' });
  fireEvent.click(other);
  expect(screen.getByRole('button', { name: '행정동' })).toBeDisabled();
  expect(
    screen.getByRole('status', { name: '현재 지역' }),
  ).not.toHaveTextContent('예시동');
  fireEvent.click(other);
  expect(screen.getByRole('button', { name: '행정동' })).toBeEnabled();
  expect(
    openTestRegionDongs().getByRole('button', { name: '행정동 전체' }),
  ).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '지역 필터 초기화' }));
  expect(
    screen.queryByRole('button', { name: '행정동' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '서울 전체' })).toHaveFocus();
});

test('목록 로딩·오류·재시도·빈 목록을 화면에서 구분한다', async () => {
  let finish!: (response: Response) => void;
  let retry = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url === '/api/v1/statistics/quarters'
        ? Promise.resolve(json(quarterCatalogFixture))
        : retry
          ? Promise.resolve(json({ items: [] }))
          : new Promise<Response>((resolve) => {
              finish = resolve;
            }),
    ),
  );
  render(<App />);
  openTestRegionFilter();
  const panel = screen.getByRole('group', { name: '지역 필터' });
  expect(within(panel).getByText('자치구 목록 불러오는 중…')).toHaveAttribute(
    'role',
    'status',
  );
  expect(
    within(panel).getByRole('button', { name: '서울 전체' }),
  ).toHaveAttribute('aria-pressed', 'true');
  finish(json({ code: 'DATA_NOT_READY' }, 503));
  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    '지역 데이터가 아직 준비되지 않았습니다',
  );
  retry = true;
  fireEvent.click(
    within(panel).getByRole('button', { name: '자치구 목록 다시 시도' }),
  );
  expect(
    await within(panel).findByText('조회 가능한 자치구 목록이 없습니다.'),
  ).toBeVisible();
  expect(within(panel).queryByRole('alert')).not.toBeInTheDocument();
});

function App() {
  return (
    <MemoryRouter>
      <ExploreApp />
    </MemoryRouter>
  );
}

test('모바일은 세 메뉴와 접힌 필터를 제공하고 Escape·닫기·외부 입력의 포커스를 유지한다', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({ items: [{ districtCode: '00110', districtName: '예시구' }] }),
    ),
  );
  render(<App />);
  const navigation = screen.getByRole('navigation', { name: '탐색 메뉴' });
  expect(within(navigation).getAllByRole('button')).toHaveLength(3);
  const toggle = screen.getByRole('button', { name: '지역 필터' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  fireEvent.click(toggle, { detail: 0 });
  expect(screen.getByRole('heading', { name: '지역 필터' })).toBeVisible();
  expect(screen.getByRole('button', { name: '서울 전체' })).toHaveFocus();
  expect(
    screen.queryByRole('button', { name: '행정동' }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('button', { name: '서울 전체' }), {
    key: 'Escape',
  });
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(
    screen.getByRole('complementary', { name: '상권 분석' }),
  ).toBeVisible();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: '지역 필터 닫기' }));
  expect(toggle).toHaveFocus();
  fireEvent.click(toggle);
  const compare = screen.getByRole('button', { name: '후보지 분석' });
  fireEvent.pointerDown(compare);
  compare.focus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(compare).toHaveFocus();
  toggle.focus();
  fireEvent.click(toggle, { detail: 1 });
  expect(toggle).toHaveFocus();
});

test('StrictMode·화면 크기 전환·언마운트에서 필터 리스너와 목록 요청을 정리한다', async () => {
  let desktop = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return desktop;
    },
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_: string, options: RequestInit) => {
      signals.push(options.signal as AbortSignal);
      return new Promise<Response>(() => {});
    }),
  );
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  const view = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  const toggle = screen.getByRole('button', { name: '지역 필터' });
  toggle.focus();
  fireEvent.click(toggle, { detail: 0 });
  const controls = screen.getByRole('group', { name: '지역 필터' });
  expect(screen.getByRole('button', { name: '서울 전체' })).toHaveFocus();
  const pointerListener = add.mock.calls.find(
    ([type]) => type === 'pointerdown',
  )![1];
  for (const value of [true, false]) {
    act(() => {
      desktop = value;
      listeners.forEach((listener) => listener());
    });
    expect(screen.getByRole('button', { name: '서울 전체' })).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', controls.id);
  }
  fireEvent.keyDown(controls, { key: 'Escape' });
  expect(toggle).toHaveFocus();
  expect(controls).not.toBeVisible();
  expect(remove).toHaveBeenCalledWith('pointerdown', pointerListener);
  view.unmount();
  expect(listeners.size).toBe(0);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  add.mockRestore();
  remove.mockRestore();
});

test('빠른 구 변경은 이전 동 목록을 숨기고 취소를 무시하는 응답도 차단한다', async () => {
  const pending: {
    code: string;
    signal: AbortSignal;
    finish: (response: Response) => void;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options: RequestInit) => {
      if (url === '/api/v1/districts')
        return Promise.resolve(
          json({
            items: [
              { districtCode: '00110', districtName: '첫구' },
              { districtCode: '00120', districtName: '다음구' },
            ],
          }),
        );
      if (url.endsWith('/dongs'))
        return new Promise<Response>((finish) =>
          pending.push({
            code: url.split('/')[4],
            signal: options.signal as AbortSignal,
            finish,
          }),
        );
      return Promise.resolve(json(feature(url.split('/')[4], 'DISTRICT')));
    }),
  );
  render(<App />);
  openTestRegionFilter();
  await screen.findByRole('button', { name: '첫구' });
  selectTestDistricts('00110');
  selectTestDistricts('00120');
  expect(pending[0].signal.aborted).toBe(true);
  const dongs = openTestRegionDongs();
  expect(dongs.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByText('행정동 목록 불러오는 중…')).toBeVisible();
  const dong = (districtCode: string, dongName: string) => ({
    items: [
      {
        districtCode,
        dongCode: `${districtCode}001`,
        dongName,
        labelPoint: { type: 'Point', coordinates: [127, 37] },
      },
    ],
  });
  await act(async () => pending[1].finish(json(dong('00120', '최신동'))));
  await act(async () => pending[0].finish(json(dong('00110', '과거동'))));
  expect(dongs.getByRole('button', { name: '최신동' })).toBeInTheDocument();
  expect(
    dongs.queryByRole('button', { name: '과거동' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '이전 단계: 자치구' }));
  expect(screen.getByRole('button', { name: '다음구' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('서버의 25개 구를 즉시 선택하고 필터를 닫아도 보존하며 서울 전체로 초기화한다', async () => {
  const districts = Array.from({ length: 25 }, (_, index) => ({
    districtCode: String(11000 + index),
    districtName: `예시구 ${index + 1}`,
  }));
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/v1/statistics/quarters')
      return json(quarterCatalogFixture);
    if (url === '/api/v1/districts') return json({ items: districts });
    if (url.endsWith('/dongs')) return json({ items: [] });
    return json(feature(url.split('/')[4], 'DISTRICT'));
  });
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  const trigger = openTestRegionFilter();
  const list = within(screen.getByRole('group', { name: '자치구 목록' }));
  expect(screen.getByText('고정')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '서울특별시' }),
  ).not.toBeInTheDocument();
  expect(list.getByRole('button', { name: '서울 전체' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    screen.queryByRole('button', { name: '적용' }),
  ).not.toBeInTheDocument();

  const first = await list.findByRole('button', { name: '예시구 1' });
  const second = list.getByRole('button', { name: '예시구 2' });
  fireEvent.click(first);
  expect(trigger).toHaveAccessibleDescription(/^적용한 자치구 1개: 예시구 1/);
  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/districts/11000/boundary',
    expect.anything(),
  );
  expect(screen.getByRole('button', { name: '행정동' })).toBeEnabled();
  fireEvent.click(second);
  expect(screen.getByRole('button', { name: '행정동' })).toBeDisabled();
  expect(
    screen.getByText('여러 자치구를 선택한 경우 행정동을 선택할 수 없습니다.'),
  ).toBeVisible();
  fireEvent.click(second);
  expect(second).toHaveAttribute('aria-pressed', 'false');
  fireEvent.keyDown(first, { key: 'Escape' });
  expect(trigger).toHaveFocus();

  openTestRegionFilter();
  expect(first).toHaveAttribute('aria-pressed', 'true');
  expect(list.getAllByRole('button')).toHaveLength(26);
  selectTestDistricts(...districts.map(({ districtCode }) => districtCode));
  expect(trigger).toHaveAccessibleDescription(
    /^적용한 자치구 25개:.*예시구 25/,
  );
  expect(list.getByRole('button', { name: '서울 전체' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const requests = fetch.mock.calls
    .map(([url]) => url)
    .filter((url) => url.endsWith('/boundary'));
  expect(new Set(requests).size).toBe(25);
  const map = screen.getByLabelText('Kakao Maps 지도');
  fireEvent.pointerDown(map);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveAccessibleDescription(/^적용한 자치구 25개:/);

  openTestRegionFilter();
  fireEvent.click(list.getByRole('button', { name: '서울 전체' }));
  expect(trigger).toHaveAccessibleDescription(
    '서울특별시 전체 · 선택한 자치구 0개',
  );
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(
    screen.queryByRole('button', { name: '행정동' }),
  ).not.toBeInTheDocument();
  expect(list.getByRole('button', { name: '서울 전체' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
