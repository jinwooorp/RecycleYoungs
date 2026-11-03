import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useCafeExplorer } from './use-cafe-explorer';

afterEach(() => vi.unstubAllGlobals());
const bounds = { west: 126.97, south: 37.55, east: 126.99, north: 37.57 };
const cafe = {
  bizesId: '001',
  storeName: '시청 카페',
  branchName: null,
  semasIndustryCode: 'I21201',
  semasIndustryName: '카페',
  roadAddress: null,
  lotAddress: null,
  longitude: 126.978,
  latitude: 37.5665,
};
function response(id = '001', empty = false) {
  return new Response(
    JSON.stringify({
      items: empty ? [] : [{ ...cafe, bizesId: id }],
      totalCount: empty ? 0 : 1,
      limit: 200,
      offset: 0,
      hasMore: false,
      sourceBatch: {
        batchId: '00000000-0000-0000-0000-000000000004',
        publishedAt: '2026-10-02T00:00:00Z',
      },
    }),
  );
}

test('지도 준비를 기다리고 구 필터·해제와 동 이동에서 지원하는 조건만 조회한다', async () => {
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  const view = renderHook(
    ({ district, key, loading }) =>
      useCafeExplorer(district, key.split(':')[1] ?? '', loading),
    { initialProps: { district: '', key: ':', loading: false } },
  );
  expect(fetch).not.toHaveBeenCalled();
  act(() => view.result.current.onViewportChange(bounds, 4));
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  expect(fetch.mock.calls[0][0]).not.toContain('districtCodes');
  act(() => view.result.current.selectCafe('001'));
  expect(view.result.current.selected?.bizesId).toBe('001');
  view.rerender({ district: '00110', key: '00110:', loading: true });
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.selected).toBeNull();
  view.rerender({ district: '00110', key: '00110:', loading: false });
  expect(fetch).toHaveBeenCalledOnce();
  act(() => view.result.current.onViewportChange(bounds, 4));
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  expect(fetch.mock.calls[1][0]).toContain('districtCodes=00110');
  view.rerender({ district: '00110', key: '00110:00110001', loading: false });
  act(() =>
    view.result.current.onViewportChange({ ...bounds, west: 126.98 }, 4),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(fetch.mock.calls[2][0]).toContain('districtCodes=00110');
  expect(fetch.mock.calls[2][0]).toContain('dongCodes=00110001');
  view.rerender({ district: '', key: ':', loading: false });
  act(() => view.result.current.onViewportChange(bounds, 4));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  expect(fetch.mock.calls[3][0]).not.toContain('districtCodes');
});

test('같은 영역은 재조회하지 않고 취소를 무시하는 오래된 응답도 차단한다', async () => {
  const finishes: ((response: Response) => void)[] = [];
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    () => new Promise<Response>((resolve) => finishes.push(resolve)),
  );
  vi.stubGlobal('fetch', fetch);
  const { result, unmount } = renderHook(() => useCafeExplorer('', '', false));
  act(() => result.current.onViewportChange(bounds, 4));
  act(() => result.current.onViewportChange({ ...bounds, west: 126.98 }, 4));
  expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  await act(async () => finishes[1](response('new')));
  await act(async () => finishes[0](response('old')));
  expect(result.current.items[0].bizesId).toBe('new');
  act(() => result.current.onViewportChange({ ...bounds, west: 126.98 }, 4));
  expect(fetch).toHaveBeenCalledTimes(2);
  act(() => result.current.onViewportChange(bounds, 4));
  unmount();
  expect(fetch.mock.calls[2][1].signal?.aborted).toBe(true);
});

test('StrictMode에서 API 오류 후 재시도하고 빈 목록을 구분한다', async () => {
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      fail
        ? new Response(JSON.stringify({ code: 'DATA_NOT_READY' }), {
            status: 503,
          })
        : response('001', true),
    ),
  );
  const { result } = renderHook(() => useCafeExplorer('', '', false), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    ),
  });
  act(() => result.current.onViewportChange(bounds, 4));
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.error).toContain('준비');
  fail = false;
  act(() => result.current.retry());
  expect(result.current.status).toBe('loading');
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.items).toEqual([]);
  expect(result.current.data?.totalCount).toBe(0);
});

test('구 미선택의 넓은 초기 화면은 조회하지 않고 확대·축소에 따라 조회와 마커 자료를 제어한다', async () => {
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useCafeExplorer('', '', false));
  act(() => result.current.onViewportChange(bounds, 5));
  expect(result.current.status).toBe('idle');
  expect(result.current.needsZoom).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  act(() => result.current.onViewportChange(bounds, 4));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.items).toHaveLength(1);
  act(() => result.current.onViewportChange(bounds, 5));
  expect(result.current.status).toBe('idle');
  expect(result.current.items).toEqual([]);
  expect(result.current.data).toBeNull();
});

test('동 선택 변경은 이전 요청을 취소하고 늦은 다른 동 결과가 섞이지 않는다', async () => {
  const finishes: ((response: Response) => void)[] = [];
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    () => new Promise<Response>((resolve) => finishes.push(resolve)),
  );
  vi.stubGlobal('fetch', fetch);
  const view = renderHook(({ dong }) => useCafeExplorer('11110', dong, false), {
    initialProps: { dong: '11110515' },
  });
  act(() => view.result.current.onViewportChange(bounds, 7));
  view.rerender({ dong: '11110530' });
  expect(view.result.current.items).toEqual([]);
  expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  act(() => view.result.current.onViewportChange(bounds, 7));
  await act(async () => finishes[1](response('new-dong')));
  await act(async () => finishes[0](response('old-dong')));
  expect(view.result.current.items.map((cafe) => cafe.bizesId)).toEqual([
    'new-dong',
  ]);
  expect(fetch.mock.calls[1][0]).toContain('dongCodes=11110530');
});
