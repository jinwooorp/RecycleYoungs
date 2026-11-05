import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useCandidateAnalysis } from './use-candidate-analysis';
import type { Candidate } from '@/lib/candidates';

const sourceBatch = {
  batchId: '00000000-0000-0000-0000-000000000001',
  publishedAt: '2026-10-01T00:00:00Z',
};
const a: Candidate = {
  slot: 'A',
  name: '원래 후보지',
  longitude: 127,
  latitude: 37.5,
};
function regions(code: string) {
  return Response.json({
    districts: [
      { districtCode: '00110', districtName: '예시구', containsCenter: true },
    ],
    dongs: [
      {
        districtCode: '00110',
        dongCode: code,
        dongName: code === '00110001' ? '첫동' : '다음동',
        containsCenter: true,
      },
    ],
    boundaryBatch: sourceBatch,
  });
}
function cafes(count: number) {
  return Response.json({
    items: [],
    totalCount: count,
    hasMore: count > 0,
    limit: 200,
    offset: 0,
    sourceBatch,
  });
}
afterEach(() => vi.unstubAllGlobals());

test('슬롯 좌표 교체 중 취소를 무시한 반경·행정동 응답을 차단하고 비활성·삭제·언마운트 요청을 정리한다', async () => {
  const pending: {
    url: string;
    signal: AbortSignal;
    finish: (response: Response) => void;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, { signal }: { signal: AbortSignal }) =>
      url.includes('/regions/')
        ? Promise.resolve(
            regions(url.includes('longitude=127&') ? '00110001' : '00110002'),
          )
        : new Promise<Response>((finish) =>
            pending.push({ url, signal, finish }),
          ),
    ),
  );
  const view = renderHook(
    ({ items, active }) => useCandidateAnalysis(items, 500, active),
    { initialProps: { items: [a], active: true } },
  );
  await waitFor(() => expect(pending).toHaveLength(4));
  const old = [...pending];
  view.rerender({
    items: [{ ...a, longitude: 127.01, name: '새 후보지' }],
    active: true,
  });
  expect(view.result.current[0].cafes.data).toBeNull();
  await waitFor(() => expect(pending).toHaveLength(8));
  expect(old.every((p) => p.signal.aborted)).toBe(true);
  await act(async () => {
    for (const p of pending.slice(4))
      p.finish(
        p.url.includes('/cafes/')
          ? cafes(42)
          : Response.json({
              dongCode: '00110002',
              quarterCode: '20262',
              ...(p.url.includes('foot-traffic')
                ? {}
                : { industryCode: 'CS100010' }),
              data: null,
            }),
      );
  });
  await act(async () => {
    for (const p of old)
      p.finish(
        p.url.includes('/cafes/')
          ? cafes(999)
          : Response.json({
              dongCode: '00110001',
              quarterCode: '20262',
              ...(p.url.includes('foot-traffic')
                ? {}
                : { industryCode: 'CS100010' }),
              data: null,
            }),
      );
  });
  expect(view.result.current[0].cafes.data?.totalCount).toBe(42);
  expect(view.result.current[0].statistics?.stores.data?.dongCode).toBe(
    '00110002',
  );
  view.rerender({ items: [{ ...a, longitude: 127.01 }], active: false });
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
  view.rerender({ items: [{ ...a, longitude: 127.01 }], active: true });
  await waitFor(() => expect(pending.length).toBeGreaterThan(8));
  view.rerender({ items: [], active: true });
  expect(view.result.current).toEqual([]);
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
  view.unmount();
});

test('StrictMode와 패널 빠른 재열기에서 소속 요청을 정리하고 이전 응답을 새 분석에 사용하지 않는다', async () => {
  const pending: {
    signal: AbortSignal;
    finish: (response: Response) => void;
  }[] = [];
  const fetch = vi.fn(
    (_url: string, { signal }: { signal: AbortSignal }) =>
      new Promise<Response>((finish) => pending.push({ signal, finish })),
  );
  vi.stubGlobal('fetch', fetch);
  const view = renderHook(
    ({ active }) => useCandidateAnalysis([a], 500, active),
    {
      initialProps: { active: false },
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      ),
    },
  );
  expect(fetch).not.toHaveBeenCalled();
  view.rerender({ active: true });
  const old = [...pending];
  view.rerender({ active: false });
  expect(old.every((p) => p.signal.aborted)).toBe(true);
  view.rerender({ active: true });
  await act(async () => old.forEach((p) => p.finish(regions('00110001'))));
  expect(view.result.current[0].dong).toBeNull();
  expect(view.result.current[0].cafes.status).toBe('idle');
  view.unmount();
  expect(pending.every((p) => p.signal.aborted)).toBe(true);
});
