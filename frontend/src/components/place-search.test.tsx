import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { KakaoMaps } from '@/lib/kakao-maps';
import { searchPlaces, type PlaceSearchPage } from '@/lib/place-search';
import { usePlaceSearch } from '@/hooks/use-place-search';
import { PlaceSearch } from './place-search';
vi.mock('@/lib/place-search', () => ({ searchPlaces: vi.fn() }));
const searchApi = vi.mocked(searchPlaces);
const maps = {} as KakaoMaps;
const place = {
  id: 'station',
  name: '홍대입구역',
  address: '서울특별시 마포구 양화로 160',
  kind: '지하철역',
  longitude: 126.923,
  latitude: 37.557,
  isSeoul: true,
};
const data: PlaceSearchPage = {
  items: [
    place,
    {
      ...place,
      id: 'unsafe',
      name: '<img src=x onerror=alert(1)>',
      address: '<script>부산 주소</script>',
      isSeoul: false,
    },
  ],
  hasMore: true,
  partial: false,
};
const onNearby = vi.fn(),
  onEscape = vi.fn(),
  retry = vi.fn();
function Harness({ status = 'ready' }: { status?: 'ready' | 'error' }) {
  const search = usePlaceSearch(status === 'ready' ? maps : null, 0);
  return (
    <div onKeyDown={onEscape}>
      <PlaceSearch
        search={search}
        connection={{ status, context: null, retry }}
        panelOpen
        regionFiltered
        onNearby={onNearby}
      />
      <button onClick={search.showSelection}>지도에서 선택한 장소</button>
    </div>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
});

test('지도 마커로 결과를 다시 열어도 현재 포커스를 옮기지 않는다', async () => {
  searchApi.mockResolvedValue(data);
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: '장소 검색' });
  const submit = screen.getByRole('button', { name: '장소 검색 실행' });
  expect(submit).toHaveAttribute('aria-expanded', 'false');
  fireEvent.change(input, { target: { value: '홍대입구역' } });
  fireEvent.submit(input.closest('form')!);
  const results = screen.getByRole('region', { name: '장소 검색 결과' });
  expect(submit).toHaveAttribute('aria-expanded', 'true');
  expect(submit).toHaveAttribute('aria-controls', results.id);
  fireEvent.click(
    await screen.findByRole('button', { name: /홍대입구역.*서울특별시/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: '검색 결과 닫기' }));
  expect(input).toHaveFocus();
  expect(submit).toHaveAttribute('aria-expanded', 'false');
  expect(submit).not.toHaveAttribute('aria-controls');
  fireEvent.click(screen.getByRole('button', { name: '지도에서 선택한 장소' }));
  expect(screen.getByRole('heading', { name: '선택한 위치' })).toBeVisible();
  expect(input).toHaveFocus();
});

test('입력은 자동 검색하지 않고 Enter 제출·선택·별도 반경 시작과 안전한 문자열 표시를 제공한다', async () => {
  searchApi.mockResolvedValue(data);
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: '장소 검색' });
  expect(input).toBeEnabled();
  expect(screen.getByRole('button', { name: '장소 검색 실행' })).toBeDisabled();
  fireEvent.change(input, { target: { value: '홍대입구역' } });
  expect(searchApi).not.toHaveBeenCalled();
  fireEvent.submit(input.closest('form')!);
  await screen.findByRole('button', { name: /홍대입구역.*서울특별시/ });
  expect(screen.getByText(/첫 페이지의 최대 15개/)).toBeVisible();
  expect(document.querySelector('img,script')).toBeNull();
  expect(
    screen.getByText(/서울 서비스 범위 밖 또는 소재 확인 필요/),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: /홍대입구역.*서울특별시/ }),
  );
  const nearby = screen.getByRole('button', { name: '이 위치 주변 카페 보기' });
  expect(nearby).toHaveFocus();
  expect(onNearby).not.toHaveBeenCalled();
  expect(screen.getByText(/기존 구·동 필터가 유지됩니다/)).toBeVisible();
  fireEvent.click(nearby);
  expect(onNearby).toHaveBeenCalledWith(place);
  fireEvent.keyDown(nearby, { key: 'Escape' });
  expect(
    screen.queryByRole('region', { name: '장소 검색 결과' }),
  ).not.toBeInTheDocument();
  expect(input).toHaveFocus();
  expect(onEscape).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '다른 검색' } });
  expect(screen.queryByText('선택한 위치')).not.toBeInTheDocument();
});

test('검색 실패·재시도·빈 결과·부분 실패와 로딩 상태를 구분한다', async () => {
  let finish!: (data: PlaceSearchPage) => void;
  searchApi
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error('서비스 실패'))
    .mockResolvedValueOnce({ items: [], hasMore: false, partial: false })
    .mockResolvedValueOnce({ ...data, partial: true });
  render(<Harness />);
  const input = screen.getByRole('textbox', { name: '장소 검색' });
  fireEvent.change(input, { target: { value: '서울시청' } });
  fireEvent.submit(input.closest('form')!);
  expect(screen.getByRole('status')).toHaveTextContent('검색 중');
  finish(data);
  await screen.findByRole('button', { name: /홍대입구역.*서울특별시/ });
  fireEvent.submit(input.closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('서비스 실패');
  fireEvent.click(screen.getByRole('button', { name: '검색 다시 시도' }));
  expect(
    await screen.findByText(
      '검색 결과가 없습니다. 다른 검색어로 시도해 주세요.',
    ),
  ).toBeVisible();
  fireEvent.submit(input.closest('form')!);
  expect(
    await screen.findByText(/일부 검색을 불러오지 못했습니다/),
  ).toBeVisible();
  await waitFor(() => expect(searchApi).toHaveBeenCalledTimes(4));
});

test('SDK 실패는 검색을 비활성화하고 지도 SDK 재시도로 연결한다', () => {
  render(<Harness status="error" />);
  expect(screen.getByRole('textbox', { name: '장소 검색' })).toBeDisabled();
  expect(
    screen.getByText('지도와 검색 서비스를 불러오지 못했습니다.'),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: '검색 서비스 다시 시도' }),
  );
  expect(retry).toHaveBeenCalledOnce();
  expect(searchApi).not.toHaveBeenCalled();
});
