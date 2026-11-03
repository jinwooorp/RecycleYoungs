import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from '@/App';

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
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색' }));
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
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색 패널 닫기' }));
  fireEvent.click(screen.getByRole('button', { name: '주변 카페' }));
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색' }));
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
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색' }));
  const panel = screen.getByRole('complementary', { name: '지역 탐색' });
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
