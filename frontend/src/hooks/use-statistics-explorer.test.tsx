import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useStatisticsExplorer } from './use-statistics-explorer';

function response(url: string, count: string | null = null) {
  return new Response(
    JSON.stringify({
      [url.includes('/dongs/') ? 'dongCode' : 'districtCode']:
        url.split('/')[4],
      quarterCode: new URL(url, 'http://localhost').searchParams.get(
        'quarterCode',
      ),
      ...(url.includes('/foot-traffic') ? {} : { industryCode: 'CS100010' }),
      data:
        count === null || !url.includes('/stores')
          ? null
          : {
              storeCount: count,
              generalStoreCount: null,
              franchiseStoreCount: '0',
              openedStoreCount: null,
              closedStoreCount: null,
              openingRate: '0.0000',
              closureRate: null,
              sourceBatch: {
                batchId: '00000000-0000-0000-0000-000000000004',
                publishedAt: '2026-10-02T00:00:00Z',
              },
            },
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

test('활성 패널에서 구→동→구 변경 즉시 결과를 숨기고 취소를 무시한 오래된 응답도 차단한다', async () => {
  const pending: {
    url: string;
    signal: AbortSignal;
    finish: (response: Response) => void;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, options: RequestInit) =>
        new Promise<Response>((resolve) =>
          pending.push({
            url,
            signal: options.signal as AbortSignal,
            finish: resolve,
          }),
        ),
    ),
  );
  const view = renderHook(
    ({ district, dong, active }) =>
      useStatisticsExplorer(district, dong, active),
    { initialProps: { district: '11110', dong: '', active: true } },
  );
  expect(pending).toHaveLength(3);
  await act(async () =>
    pending.forEach((p) => p.finish(response(p.url, '9007199254740993'))),
  );
  expect(view.result.current.stores.data?.data?.storeCount).toBe(
    '9007199254740993',
  );
  view.rerender({ district: '11110', dong: '11110515', active: true });
  expect(view.result.current.stores.status).toBe('loading');
  expect(view.result.current.stores.data).toBeNull();
  expect(pending).toHaveLength(6);
  expect(pending[3].url).toContain('/dongs/11110515/stats/');
  view.rerender({ district: '11140', dong: '', active: true });
  expect(pending).toHaveLength(9);
  expect(pending.slice(0, 6).every((p) => p.signal.aborted)).toBe(true);
  await act(async () =>
    pending.slice(6).forEach((p) => p.finish(response(p.url, '42'))),
  );
  await act(async () =>
    pending.slice(3, 6).forEach((p) => p.finish(response(p.url, '777'))),
  );
  expect(view.result.current.stores.data?.data?.storeCount).toBe('42');
  expect(view.result.current.stores.data?.districtCode).toBe('11140');
  expect(view.result.current.sales.data?.data).toBeNull();
  view.rerender({ district: '11140', dong: '', active: false });
  expect(view.result.current.stores.status).toBe('idle');
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
  view.unmount();
});

test('StrictMode에서 각 API 요청 수명을 정리하고 지역이 없으면 새 요청하지 않는다', async () => {
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    async (url) => response(url),
  );
  vi.stubGlobal('fetch', fetch);
  const view = renderHook(
    ({ district }) => useStatisticsExplorer(district, '', true),
    {
      initialProps: { district: '11110' },
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      ),
    },
  );
  await waitFor(() =>
    expect(view.result.current.footTraffic.status).toBe('ready'),
  );
  const count = fetch.mock.calls.length;
  view.rerender({ district: '' });
  expect(view.result.current.target).toBeNull();
  expect(view.result.current.stores.status).toBe('idle');
  expect(fetch.mock.calls).toHaveLength(count);
  expect(fetch.mock.calls.every(([, options]) => options.signal?.aborted)).toBe(
    true,
  );
});

test('분기 변경은 요청을 구분·취소하고 늦은 응답을 차단하며 같은 조건 재렌더는 재조회하지 않는다', async () => {
  const pending: {
    url: string;
    signal: AbortSignal;
    finish: (response: Response) => void;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, options: RequestInit) =>
        new Promise<Response>((finish) =>
          pending.push({ url, signal: options.signal as AbortSignal, finish }),
        ),
    ),
  );
  const view = renderHook(
    ({ quarter, active }) =>
      useStatisticsExplorer('11440', '', active, quarter),
    { initialProps: { quarter: '20261', active: true } },
  );
  expect(pending).toHaveLength(3);
  view.rerender({ quarter: '20262', active: true });
  expect(pending).toHaveLength(6);
  expect(pending.slice(0, 3).every((p) => p.signal.aborted)).toBe(true);
  await act(async () =>
    pending.slice(3).forEach((p) => p.finish(response(p.url, '42'))),
  );
  await act(async () =>
    pending.slice(0, 3).forEach((p) => p.finish(response(p.url, '777'))),
  );
  expect(view.result.current.stores.data?.quarterCode).toBe('20262');
  expect(view.result.current.stores.data?.data?.storeCount).toBe('42');
  view.rerender({ quarter: '20262', active: true });
  expect(pending).toHaveLength(6);
  view.rerender({ quarter: '20262', active: false });
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
  view.rerender({ quarter: '20261', active: true });
  expect(pending).toHaveLength(9);
  expect(view.result.current.stores.data).toBeNull();
  view.unmount();
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
});
