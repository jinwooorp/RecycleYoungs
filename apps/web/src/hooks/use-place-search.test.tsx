import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { KakaoMaps } from '@/lib/kakao-maps';
import {
  searchPlaces,
  type PlaceSearchPage,
  type PlaceSearchResult,
} from '@/lib/place-search';
import { usePlaceSearch } from './use-place-search';
vi.mock('@/lib/place-search', () => ({ searchPlaces: vi.fn() }));
const search = vi.mocked(searchPlaces);
const maps = {} as KakaoMaps;
const place: PlaceSearchResult = {
  id: 'station',
  name: '홍대입구역',
  address: '서울특별시 마포구 양화로 160',
  kind: '지하철역',
  longitude: 126.923,
  latitude: 37.557,
  isSeoul: true,
};
const page: PlaceSearchPage = {
  items: [place],
  hasMore: false,
  partial: false,
};
beforeEach(() => vi.clearAllMocks());

test('명시적 제출만 검색하고 공백·새 검색어·지역 재선택을 구분한다', async () => {
  search.mockResolvedValue(page);
  const view = renderHook(({ revision }) => usePlaceSearch(maps, revision), {
    initialProps: { revision: 0 },
  });
  act(() => view.result.current.changeQuery('   '));
  act(() => view.result.current.submit());
  expect(search).not.toHaveBeenCalled();
  act(() => view.result.current.changeQuery(' 홍대입구역 '));
  expect(search).not.toHaveBeenCalled();
  act(() => view.result.current.submit());
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  expect(search).toHaveBeenCalledWith(maps, '홍대입구역');
  act(() => view.result.current.selectResult(place));
  expect(view.result.current.selected?.place).toEqual(place);
  expect(view.result.current.view).toBe('selection');
  act(() => view.result.current.changeQuery('서울시청'));
  expect(view.result.current.data).toBeNull();
  expect(view.result.current.status).toBe('idle');
  expect(view.result.current.isOpen).toBe(false);
  view.rerender({ revision: 1 });
  expect(view.result.current.selected).toBeNull();
  view.rerender({ revision: 2 });
  expect(view.result.current.selected).toBeNull();
});

test('취소할 수 없는 오래된 콜백은 검색어 변경·재검색·SDK 교체 후 결과를 덮어쓰지 않는다', async () => {
  const finishes: ((page: PlaceSearchPage) => void)[] = [];
  search.mockImplementation(
    () => new Promise((resolve) => finishes.push(resolve)),
  );
  const view = renderHook(
    ({ sdk }: { sdk: KakaoMaps | null }) => usePlaceSearch(sdk, 0),
    {
      initialProps: { sdk: maps as KakaoMaps | null },
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      ),
    },
  );
  act(() => view.result.current.changeQuery('이전 검색'));
  act(() => view.result.current.submit());
  act(() => view.result.current.changeQuery('새 검색'));
  act(() => view.result.current.submit());
  await act(async () =>
    finishes[1]({ ...page, items: [{ ...place, name: '새 검색' }] }),
  );
  await act(async () =>
    finishes[0]({ ...page, items: [{ ...place, name: '이전 검색' }] }),
  );
  expect(view.result.current.data?.items[0].name).toBe('새 검색');
  act(() => view.result.current.submit());
  view.rerender({ sdk: null });
  await act(async () => finishes[2](page));
  expect(view.result.current.data).toBeNull();
  view.rerender({ sdk: {} as KakaoMaps });
  act(() => view.result.current.submit());
  view.unmount();
  await act(async () => finishes[3](page));
});

test('오류·재시도·결과 없음과 Escape 이후 닫힌 목록을 유지한다', async () => {
  search
    .mockRejectedValueOnce(new Error('검색 실패'))
    .mockResolvedValueOnce({ items: [], hasMore: false, partial: false });
  const { result } = renderHook(() => usePlaceSearch(maps, 0));
  act(() => result.current.changeQuery('검색어'));
  act(() => result.current.submit());
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.error).toBe('검색 실패');
  act(() => result.current.submit());
  act(() => result.current.close());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.data?.items).toEqual([]);
  expect(result.current.isOpen).toBe(false);
});

test('Services 객체가 같아도 지도 세대가 바뀌면 이전 로딩·응답을 재사용하지 않는다', async () => {
  let finish!: (page: PlaceSearchPage) => void;
  search
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(page);
  const view = renderHook(({ session }) => usePlaceSearch(maps, 0, session), {
    initialProps: { session: {} },
  });
  act(() => view.result.current.changeQuery('서울시청'));
  act(() => view.result.current.submit());
  view.rerender({ session: {} });
  expect(view.result.current.status).toBe('idle');
  await act(async () => finish(page));
  expect(view.result.current.data).toBeNull();
  act(() => view.result.current.submit());
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
});
