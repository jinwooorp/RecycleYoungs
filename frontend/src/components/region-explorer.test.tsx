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
import ExploreApp from '@/App';
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
        items: [{ districtCode: '00110', districtName: '예시구' }],
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
  await screen.findByRole('option', { name: '예시구' });
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '00110' },
  });
  await screen.findByRole('option', { name: '예시동' });
  fireEvent.change(screen.getByRole('combobox', { name: '행정동' }), {
    target: { value: '00110001' },
  });
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/dongs/00110001/boundary',
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '주변 탐색' }));
  fireEvent.click(screen.getByRole('button', { name: '주변 탐색 패널 닫기' }));
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(screen.getByRole('combobox', { name: '자치구' })).toHaveValue('00110');
  expect(screen.getByRole('combobox', { name: '행정동' })).toHaveValue(
    '00110001',
  );
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith('/dongs')),
  ).toHaveLength(1);
  fireEvent.change(screen.getByRole('combobox', { name: '자치구' }), {
    target: { value: '' },
  });
  expect(screen.getByRole('combobox', { name: '행정동' })).toHaveValue('');
  expect(screen.getByRole('combobox', { name: '행정동' })).toBeDisabled();
});

test('목록 로딩·오류·재시도·빈 목록을 화면에서 구분한다', async () => {
  let finish!: (response: Response) => void;
  let retry = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      retry
        ? Promise.resolve(json({ items: [] }))
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    ),
  );
  render(<App />);
  const panel = screen.getByRole('group', { name: '지역 필터' });
  expect(within(panel).getByRole('status')).toHaveTextContent(
    '자치구 목록 불러오는 중',
  );
  expect(
    within(panel).getByRole('combobox', { name: '자치구' }),
  ).toBeDisabled();
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
  fireEvent.click(toggle);
  expect(screen.getByText('서울특별시')).toBeVisible();
  expect(screen.getByRole('combobox', { name: '자치구' })).toHaveFocus();
  expect(screen.getByRole('combobox', { name: '행정동' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('combobox', { name: '자치구' }), {
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
  expect(screen.getByRole('button', { name: '지역 필터 닫기' })).toHaveFocus();
  const pointerListener = add.mock.calls.find(
    ([type]) => type === 'pointerdown',
  )![1];
  act(() => {
    desktop = true;
    listeners.forEach((listener) => listener());
  });
  expect(
    screen.queryByRole('button', { name: '지역 필터' }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
  expect(remove).toHaveBeenCalledWith('pointerdown', pointerListener);
  const controls = screen.getByRole('group', { name: '지역 필터' });
  expect(controls).toHaveFocus();
  act(() => {
    desktop = false;
    listeners.forEach((listener) => listener());
  });
  const compactToggle = screen.getByRole('button', { name: '지역 필터' });
  expect(compactToggle).toHaveFocus();
  expect(compactToggle).toHaveAttribute('aria-expanded', 'false');
  expect(compactToggle).toHaveAttribute('aria-controls', controls.id);
  expect(controls).not.toBeVisible();
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
  await screen.findByRole('option', { name: '첫구' });
  const district = screen.getByRole('combobox', { name: '자치구' });
  fireEvent.change(district, { target: { value: '00110' } });
  fireEvent.change(district, { target: { value: '00120' } });
  expect(pending[0].signal.aborted).toBe(true);
  expect(screen.getByRole('combobox', { name: '행정동' })).toBeDisabled();
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
  expect(screen.getByRole('option', { name: '최신동' })).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: '과거동' }),
  ).not.toBeInTheDocument();
  expect(district).toHaveValue('00120');
});
