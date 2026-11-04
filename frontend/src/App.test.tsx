import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App';

beforeEach(() => {
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', '');
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ items: [] }))),
      ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('초기에는 네 메뉴와 지도만 표시하고 상세 패널은 닫는다', async () => {
  render(<App />);
  expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  const brand = screen.getByRole('img', { name: 'RecycleYoungs' });
  expect(brand).toBeVisible();
  expect(brand.closest('a')).toBeNull();
  expect(screen.queryByText('RecycleYoungs')).not.toBeInTheDocument();
  expect(
    screen.queryByText('서울시 카페 창업 상권 분석'),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('상권 탐색')).not.toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: '탐색 메뉴' })).toBeVisible();
  for (const name of ['지역 탐색', '주변 카페', '상권 분석', '후보지 비교']) {
    expect(screen.getByRole('button', { name })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  }
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(screen.getByRole('search', { name: '장소 검색' })).toBeVisible();
  expect(
    screen.queryByText('서울특별시', { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '장소 검색' })).toBeDisabled();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '지도 설정이 필요합니다',
  );
  expect(screen.getByRole('button', { name: '지도 확대' })).toBeDisabled();
});

test('같은 메뉴를 다시 누르면 닫고 다른 메뉴를 누르면 내용을 전환한다', () => {
  render(<App />);
  const toggle = screen.getByRole('button', { name: '지역 탐색' });
  const map = screen.getByRole('region', { name: '서울 상권 지도' });
  const search = screen.getByRole('textbox', { name: '장소 검색' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(
    screen.getByRole('complementary', { name: '지역 탐색' }),
  ).toBeVisible();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('region', { name: '서울 상권 지도' })).toBe(map);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: '주변 카페' }));
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(
    screen.getByRole('complementary', { name: '주변 카페' }),
  ).toHaveTextContent('현재 지도 영역 카페');
  expect(screen.getByRole('textbox', { name: '장소 검색' })).toBe(search);
  expect(screen.getByRole('region', { name: '서울 상권 지도' })).toBe(map);
});

test('장소 검색은 패널·지도 밖에 유지하고 닫는 동안 패널 접근을 차단한다', () => {
  render(<App />);
  const search = screen.getByRole('search', { name: '장소 검색' });
  expect(
    screen.getByRole('region', { name: '서울 상권 지도' }),
  ).not.toContainElement(search);
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색' }));
  const panel = screen.getByRole('complementary', { name: '지역 탐색' });
  expect(panel).not.toContainElement(search);
  expect(search).toHaveTextContent('검색');
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색 패널 닫기' }));
  expect(panel).toHaveAttribute('inert');
  expect(panel).toHaveAttribute('aria-hidden', 'true');
  expect(panel).toHaveTextContent('행정구역 선택');
  // 닫는 도중 다른 메뉴를 선택해도 이전 내용이나 지연 콜백에 가려지지 않습니다.
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(screen.getByRole('complementary', { name: '상권 분석' })).toBe(panel);
  expect(panel).not.toHaveAttribute('inert');
  expect(panel).toHaveTextContent('행정구역 전체 통계');
  expect(screen.getByRole('search', { name: '장소 검색' })).toBe(search);
});

test('닫기 버튼과 Escape는 패널을 접고 선택 메뉴로 포커스를 돌린다', () => {
  render(<App />);
  const menu = screen.getByRole('button', { name: '지역 탐색' });
  fireEvent.click(menu);
  const close = screen.getByRole('button', { name: '지역 탐색 패널 닫기' });
  close.focus();
  fireEvent.click(close);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(menu).toHaveFocus();
  fireEvent.click(menu);
  screen.getByRole('button', { name: '지역 탐색 패널 닫기' }).focus();
  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
  expect(menu).toHaveAttribute('aria-expanded', 'false');
  expect(menu).toHaveFocus();
});

test('미연동 장소·반경 입력과 행정구역 전체 통계를 구분한다', () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '지역 탐색' }));
  expect(screen.getByText('서울특별시 · 고정')).toBeVisible();
  expect(screen.getByRole('combobox', { name: '자치구' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: '행정동' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: '장소 검색' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '주변 카페' }));
  expect(
    screen.queryByRole('combobox', { name: '탐색 반경' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '선택 지점 주변' }));
  expect(screen.getByRole('combobox', { name: '탐색 반경' })).toBeEnabled();
  expect(screen.getByRole('combobox', { name: '탐색 반경' })).toHaveValue(
    '500',
  );
  expect(screen.getByText('중심점이 선택되지 않았습니다.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '지도 영역' }));
  expect(screen.getByText(/자치구를 선택하거나 지도를 확대하면/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '상권 분석' }));
  expect(
    screen.getByRole('region', { name: '행정구역 전체 통계' }),
  ).toHaveTextContent('지역 탐색에서 자치구 또는 행정동을 선택해 주세요.');
  expect(screen.getByText('점포 현황')).toBeVisible();
  expect(screen.getByText('추정매출')).toBeVisible();
  expect(screen.getByText('유동인구')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '후보지 비교' }));
  expect(
    screen.getByText(
      '등록된 후보지가 없습니다. 지도 또는 장소 검색에서 추가하세요.',
    ),
  ).toBeVisible();
  expect(screen.getByRole('region', { name: '비교 결과' })).toBeVisible();
  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/districts',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(fetch.mock.calls.every(([url]) => url === '/api/v1/districts')).toBe(
    true,
  );
});
