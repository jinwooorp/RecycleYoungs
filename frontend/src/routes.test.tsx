import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadKakaoMaps } from '@/lib/kakao-maps';
import { AppRoutes } from './routes';

vi.mock('@/lib/kakao-maps', () => ({ loadKakaoMaps: vi.fn() }));

const fetchApi = vi.fn(async () => Response.json({ items: [] }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_KAKAO_MAP_APP_KEY', 'test-key');
  vi.stubGlobal('fetch', fetchApi);
  vi.mocked(loadKakaoMaps).mockRejectedValue(new Error('테스트용 지도 로더'));
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => void navigate(-1)}>테스트 뒤로</button>
      <button onClick={() => void navigate(1)}>테스트 앞으로</button>
    </>
  );
}

function renderRoute(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <HistoryControls />
      <AppRoutes />
    </MemoryRouter>,
  );
}

test('랜딩은 서비스 소개와 탐색 링크를 표시하며 SDK와 API를 시작하지 않는다', () => {
  renderRoute('/');
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: '카페 창업할 곳, 감으로만 고르지 마세요.',
    }),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: '지도 탐색' })).toHaveAttribute(
    'href',
    '#features',
  );
  expect(screen.getByRole('link', { name: '이용 방법' })).toHaveAttribute(
    'href',
    '#how-it-works',
  );
  const callsToAction = screen.getAllByRole('link', {
    name: '시작하기',
  });
  expect(callsToAction).toHaveLength(3);
  for (const link of callsToAction)
    expect(link).toHaveAttribute('href', '/explore');
  expect(
    screen.queryByRole('link', { name: /지도에서 탐색하기/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: '숫자가 가리키는 범위부터 살펴보세요' }),
  ).toBeVisible();
  expect(
    screen.getByRole('region', { name: '후보지를 같은 기준으로 비교하세요' }),
  ).toBeVisible();
  const heroPreview = screen.getByRole('img', {
    name: /홍대입구역의 500m 반경/,
  });
  expect(heroPreview).toHaveAttribute('fetchpriority', 'high');
  expect(
    screen.getByRole('img', { name: /홍대입구역, 서울시청, 성수역 후보지/ }),
  ).toHaveAttribute('loading', 'lazy');
  expect(document.title).toBe('RecycleYoungs | 서울 카페 상권 탐색');
  expect(loadKakaoMaps).not.toHaveBeenCalled();
  expect(fetchApi).not.toHaveBeenCalled();
});

test('탐색 CTA와 뒤로·앞으로 이동 후 탭에 저장된 후보지를 복원한다', async () => {
  sessionStorage.setItem(
    'recycleyoungs.candidates',
    JSON.stringify({
      version: 1,
      items: [
        {
          slot: 'A',
          name: '복원 후보지',
          longitude: 126.978,
          latitude: 37.5665,
        },
      ],
    }),
  );
  renderRoute('/');
  const hero = screen.getByRole('region', {
    name: '카페 창업할 곳, 감으로만 고르지 마세요.',
  });
  fireEvent.click(within(hero).getByRole('link', { name: '시작하기' }));
  const explore = await screen.findByRole('main', {
    name: 'RecycleYoungs 탐색 화면',
  });
  expect(explore).toHaveFocus();
  expect(document.title).toBe('상권 탐색 | RecycleYoungs');
  expect(loadKakaoMaps).toHaveBeenCalledTimes(1);
  expect(fetchApi).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: '테스트 뒤로' }));
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: '카페 창업할 곳, 감으로만 고르지 마세요.',
    }),
  ).toBeVisible();
  expect(explore).not.toBeInTheDocument();
  expect(fetchApi).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: '테스트 앞으로' }));
  await screen.findByRole('main', { name: 'RecycleYoungs 탐색 화면' });
  fireEvent.click(screen.getByRole('button', { name: '후보지 비교' }));
  expect(
    await screen.findByRole('button', { name: 'A · 복원 후보지' }),
  ).toBeVisible();
});

test('/explore에서 탐색 페이지를 바로 렌더링한다', async () => {
  renderRoute('/explore');
  expect(
    await screen.findByRole('main', { name: 'RecycleYoungs 탐색 화면' }),
  ).toBeVisible();
  await waitFor(() => expect(document.title).toBe('상권 탐색 | RecycleYoungs'));
  expect(
    screen.queryByRole('heading', {
      name: '카페 창업할 곳, 감으로만 고르지 마세요.',
    }),
  ).not.toBeInTheDocument();
});

test('알 수 없는 경로에서 홈과 탐색 링크를 제공한다', async () => {
  renderRoute('/missing-page');
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: '페이지를 찾을 수 없습니다',
    }),
  ).toBeVisible();
  expect(document.title).toBe('페이지를 찾을 수 없습니다 | RecycleYoungs');
  expect(screen.getByRole('link', { name: '상권 탐색' })).toHaveAttribute(
    'href',
    '/explore',
  );
  expect(loadKakaoMaps).not.toHaveBeenCalled();
  expect(fetchApi).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: '홈으로' }));
  expect(
    await screen.findByRole('heading', {
      name: '카페 창업할 곳, 감으로만 고르지 마세요.',
    }),
  ).toBeVisible();
});

test('탐색의 홈 링크로 랜딩에 돌아와도 후보지를 보존하고 재진입에서 복원한다', async () => {
  const saved = JSON.stringify({
    version: 1,
    items: [
      {
        slot: 'A',
        name: '홈 이동 후 후보지',
        longitude: 126.978,
        latitude: 37.5665,
      },
    ],
  });
  sessionStorage.setItem('recycleyoungs.candidates', saved);
  renderRoute('/explore');
  const home = await screen.findByRole('link', {
    name: 'RecycleYoungs 홈으로',
  });
  expect(home).toHaveAttribute('href', '/');
  fireEvent.click(home);
  expect(
    await screen.findByRole('heading', {
      name: '카페 창업할 곳, 감으로만 고르지 마세요.',
    }),
  ).toBeVisible();
  expect(sessionStorage.getItem('recycleyoungs.candidates')).toBe(saved);
  fireEvent.click(
    within(screen.getByRole('banner')).getByRole('link', { name: '시작하기' }),
  );
  await screen.findByRole('main', { name: 'RecycleYoungs 탐색 화면' });
  fireEvent.click(screen.getByRole('button', { name: '후보지 비교' }));
  expect(
    await screen.findByRole('button', { name: 'A · 홈 이동 후 후보지' }),
  ).toBeVisible();
});
