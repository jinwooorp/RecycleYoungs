import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, Route, Routes, useNavigationType } from 'react-router';
import { Button } from '@/components/ui/button';
import LandingPage from '@/pages/landing-page';

// 탐색 화면과 지도·데이터 모듈은 /explore 경로에 진입할 때만 불러옵니다.
const ExplorePage = lazy(() => import('./App'));

function RoutePage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const navigationType = useNavigationType();
  useEffect(() => {
    document.title = title;
    // 링크로 이동하면 새 본문에 포커스를 두고 뒤로 가기의 스크롤 복원은 브라우저에 맡깁니다.
    if (navigationType !== 'POP') {
      document.documentElement.scrollTop = 0;
      document
        .querySelector<HTMLElement>('main[tabindex="-1"]')
        ?.focus({ preventScroll: true });
    }
  }, [title, navigationType]);
  return children;
}

function NotFoundPage() {
  return (
    <main
      data-public-page
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center px-6 py-12 focus:outline-none"
    >
      <p className="mb-3 text-sm font-semibold text-primary">
        RecycleYoungs · 404
      </p>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        페이지를 찾을 수 없습니다
      </h1>
      <p className="mt-4 text-muted-foreground">
        주소를 확인하거나 아래 링크에서 탐색을 시작하세요.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Button asChild size="lg" variant="outline">
          <Link to="/">홈으로</Link>
        </Button>
        <Button asChild size="lg">
          <Link to="/explore">상권 탐색</Link>
        </Button>
      </div>
    </main>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RoutePage title="RecycleYoungs | 서울 카페 상권 탐색">
            <LandingPage />
          </RoutePage>
        }
      />
      <Route
        path="/explore"
        element={
          <Suspense
            fallback={
              <p role="status" className="p-6 text-sm text-muted-foreground">
                탐색 화면을 불러오는 중입니다.
              </p>
            }
          >
            <RoutePage title="상권 탐색 | RecycleYoungs">
              <ExplorePage />
            </RoutePage>
          </Suspense>
        }
      />
      <Route
        path="*"
        element={
          <RoutePage title="페이지를 찾을 수 없습니다 | RecycleYoungs">
            <NotFoundPage />
          </RoutePage>
        }
      />
    </Routes>
  );
}
