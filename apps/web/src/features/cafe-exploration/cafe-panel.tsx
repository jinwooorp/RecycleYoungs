import { useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { cafeBrandLabel } from '@/entities/cafe/cafe-brand';
import { Button } from '@/shared/ui/button';
import { CafeProvenance } from '@/entities/cafe/cafe-provenance';
import type { CafeExplorer } from './use-cafe-explorer';
import { cafeAddress, formatCafeDistance } from '@/entities/cafe/cafes';
import type { RequestResource } from '@/shared/hooks/use-request';
import type { District, Dong } from '@/entities/region/regions';

interface CafeRegion {
  districtCodes: string[];
  districts: RequestResource<District[]>;
  dongCode: string;
  dongs: RequestResource<Dong[]>;
}

function ResourceNotice({
  resource,
  label,
  empty,
}: {
  resource: RequestResource<unknown>;
  label: string;
  empty?: boolean;
}) {
  if (resource.status === 'loading')
    return (
      <p role="status" className="text-xs leading-5 text-muted-foreground">
        {label} 불러오는 중…
      </p>
    );
  if (resource.status === 'error')
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-2 text-xs leading-5"
      >
        <p className="text-destructive">
          {label}: {resource.error}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={resource.retry}
          aria-label={`${label} 다시 시도`}
        >
          다시 시도
        </Button>
      </div>
    );
  if (resource.status === 'ready' && empty)
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        조회 가능한 {label}이 없습니다.
      </p>
    );
  return null;
}

export function CafePanel({
  cafes,
  region,
}: {
  cafes: CafeExplorer;
  region: CafeRegion;
}) {
  const nearby = cafes.mode === 'nearby';
  const pagination = cafes.pagination;
  const { page, totalPages, lastPage } = pagination;
  const listHeading = useRef<HTMLHeadingElement>(null);
  const focusPage = useRef(false);
  useLayoutEffect(() => {
    if (!focusPage.current) return;
    focusPage.current = false;
    listHeading.current?.focus({ preventScroll: true });
    listHeading.current?.scrollIntoView?.({ block: 'start' });
  }, [page]);

  function goTo(next: number) {
    if (pagination.goTo(next)) focusPage.current = true;
  }
  function retryPage(action: () => void) {
    listHeading.current?.focus();
    action();
  }
  const districts =
    region.districts.data?.filter(({ districtCode }) =>
      region.districtCodes.includes(districtCode),
    ) ?? [];
  const dong = region.dongs.data?.find(
    ({ dongCode }) => dongCode === region.dongCode,
  );
  const filterLabel = [
    districts.map((district) => district.districtName).join(', '),
    dong?.dongName,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex min-w-0 flex-col gap-2.5 p-3 break-keep text-pretty sm:px-5">
      <section
        aria-label="탐색 설정"
        className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b pb-2"
      >
        <div
          role="group"
          aria-label="주변 탐색 방식"
          className="explore-nearby-mode flex flex-wrap gap-1"
        >
          <Button
            variant={!nearby ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={!nearby}
            onClick={() => cafes.setMode('viewport')}
          >
            지도 영역
          </Button>
          <Button
            variant={nearby ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={nearby}
            onClick={() => cafes.setMode('nearby')}
          >
            선택 지점 주변
          </Button>
        </div>
        {!nearby && (
          <p className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {region.districtCodes.length
              ? `${filterLabel || '선택 구·동'} 경계 적용`
              : '서울 전체 범위'}
          </p>
        )}
        {nearby && (
          <>
            <div
              role="group"
              aria-label="탐색 반경"
              className="flex flex-wrap items-center gap-1"
            >
              <span className="mr-1 text-xs font-medium">탐색 반경</span>
              {([500, 1000] as const).map((radius) => (
                <Button
                  key={radius}
                  variant={cafes.radiusM === radius ? 'secondary' : 'outline'}
                  size="sm"
                  aria-pressed={cafes.radiusM === radius}
                  onClick={() => {
                    if (cafes.radiusM !== radius) cafes.setRadiusM(radius);
                  }}
                >
                  {radius === 500 ? '500m' : '1km'}
                </Button>
              ))}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
              {cafes.center ? (
                <div
                  className="min-w-0 [overflow-wrap:anywhere]"
                  aria-live="polite"
                >
                  <p className="font-medium">
                    {cafes.centerDetails.pending
                      ? '주소 확인 중…'
                      : cafes.centerDetails.name ||
                        cafes.centerDetails.address ||
                        '지도에서 선택한 위치'}
                  </p>
                  {cafes.centerDetails.name && cafes.centerDetails.address && (
                    <p>{cafes.centerDetails.address}</p>
                  )}
                </div>
              ) : (
                <p>지도에서 중심점을 고르세요.</p>
              )}
              {cafes.center && (
                <Button variant="outline" size="sm" onClick={cafes.clearCenter}>
                  중심점 해제
                </Button>
              )}
            </div>
          </>
        )}
      </section>
      <section
        aria-labelledby="cafe-list-heading"
        className="flex min-w-0 flex-col gap-1.5"
      >
        <h3
          id="cafe-list-heading"
          ref={listHeading}
          tabIndex={-1}
          className="text-sm font-semibold"
        >
          조회된 카페
        </h3>
        {cafes.status === 'idle' && !nearby && (
          <p role="status" className="text-xs leading-5 text-muted-foreground">
            {cafes.needsZoom
              ? '지도를 확대하거나 자치구를 선택하세요.'
              : '지도 영역 확인 중…'}
          </p>
        )}
        <ResourceNotice resource={cafes} label="카페 목록" />
        {cafes.status === 'ready' && cafes.data && (
          <>
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p
                role="status"
                className="text-sm font-semibold text-primary tabular-nums"
              >
                {nearby ? '반경 내 ' : '지도 영역 '}
                {cafes.data.totalCount.toLocaleString('ko-KR')}곳
                {!!pagination.items.length &&
                  pagination.items.length !== cafes.data.totalCount &&
                  ` · ${pagination.items.length.toLocaleString('ko-KR')}곳 표시`}
              </p>
              {totalPages > 0 && (
                <p
                  role="status"
                  className="text-xs text-muted-foreground tabular-nums"
                >
                  {page}/{totalPages.toLocaleString('ko-KR')}페이지
                  {!!pagination.items.length &&
                    ` · ${pagination.firstIndex + 1}~${pagination.firstIndex + pagination.items.length}번째 표시`}
                  {` · 지도 마커 ${cafes.items.length.toLocaleString('ko-KR')}곳`}
                </p>
              )}
            </div>
            {lastPage < totalPages && (
              <p className="text-xs text-muted-foreground">
                조회 범위 제한으로 {lastPage.toLocaleString('ko-KR')}페이지까지
                볼 수 있습니다.
              </p>
            )}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
              <CafeProvenance sourceBatch={cafes.data.sourceBatch} inline />
              {nearby && <span>구·동 필터와 독립 조회</span>}
            </div>
            {cafes.data.totalCount === 0 && (
              <p className="text-sm text-muted-foreground">
                {nearby
                  ? '선택한 반경 내에 조회된 카페가 없습니다.'
                  : '현재 지도 영역에 조회된 카페가 없습니다.'}
              </p>
            )}
            {pagination.pending && (
              <p role="status" className="text-xs text-muted-foreground">
                {page}페이지 카페를 불러오는 중…
              </p>
            )}
            {pagination.changed && (
              <div role="alert" className="space-y-2 text-xs">
                <p className="text-warning">
                  카페 자료가 갱신되었습니다. 첫 페이지부터 다시 조회해 주세요.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => retryPage(pagination.restart)}
                >
                  첫 페이지부터 다시 조회
                </Button>
              </div>
            )}
            {pagination.error && !pagination.changed && (
              <div role="alert" className="space-y-2 text-xs">
                <p className="text-destructive">
                  {page}페이지 카페 목록: {pagination.error}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => retryPage(pagination.retry)}
                >
                  이 페이지 다시 시도
                </Button>
              </div>
            )}
            {!!pagination.items.length && (
              <ul
                aria-label="현재 페이지 카페"
                className="grid min-w-0 gap-1.5 lg:grid-cols-2"
              >
                {pagination.items.map((cafe) => (
                  <li
                    key={cafe.bizesId}
                    className="cafe-result-card flex min-w-0 flex-col rounded-lg border bg-card px-2.5 py-1.5 text-card-foreground [overflow-wrap:anywhere]"
                  >
                    <button
                      type="button"
                      onClick={() => cafes.selectListCafe(cafe)}
                      aria-pressed={
                        cafes.selected?.bizesId === cafe.bizesId ||
                        cafes.listOnlyCafe?.bizesId === cafe.bizesId
                      }
                      className="block w-full flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block text-sm font-semibold text-primary">
                        {cafe.storeName}
                        {cafe.branchName ? ` · ${cafe.branchName}` : ''}
                      </span>
                      <span className="flex flex-wrap gap-x-2 text-xs leading-4 text-muted-foreground tabular-nums">
                        <span>
                          {cafe.semasIndustryName}
                          {nearby &&
                            cafe.distanceM !== undefined &&
                            ` · ${formatCafeDistance(cafe.distanceM)}`}
                        </span>
                        <span>{cafeBrandLabel(cafe)}</span>
                      </span>
                      <span className="block text-xs leading-4 text-muted-foreground">
                        {cafeAddress(cafe)}
                      </span>
                    </button>
                    {cafes.listOnlyCafe?.bizesId === cafe.bizesId && (
                      <p
                        role="status"
                        className="mt-2 rounded-lg bg-accent p-2 text-xs"
                      >
                        {cafe.storeName} 선택됨 · {cafe.semasIndustryName} ·
                        지도 마커 표시 범위 밖
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {lastPage > 1 && !pagination.changed && (
              <CafePageNavigation page={page} lastPage={lastPage} goTo={goTo} />
            )}
          </>
        )}
      </section>
    </div>
  );
}

function CafePageNavigation({
  page,
  lastPage,
  goTo,
}: {
  page: number;
  lastPage: number;
  goTo: (page: number) => void;
}) {
  const firstVisible = Math.floor((page - 1) / 5) * 5 + 1;
  const numbers = Array.from(
    { length: Math.min(5, lastPage - firstVisible + 1) },
    (_, index) => firstVisible + index,
  );
  return (
    <nav
      aria-label="카페 목록 페이지"
      className="flex flex-wrap justify-center gap-1"
    >
      <div className="flex gap-1">
        <PageMove label="첫 페이지" disabled={page === 1} move={() => goTo(1)}>
          <ChevronsLeft aria-hidden="true" />
        </PageMove>
        <PageMove
          label="5페이지 이전"
          disabled={page === 1}
          move={() => goTo(Math.max(1, page - 5))}
        >
          <span aria-hidden="true">−5</span>
        </PageMove>
        <PageMove
          label="이전 페이지"
          disabled={page === 1}
          move={() => goTo(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </PageMove>
      </div>
      <div className="flex gap-1">
        {numbers.map((number) => (
          <Button
            key={number}
            size="icon-lg"
            variant={number === page ? 'default' : 'outline'}
            aria-label={`${number}페이지`}
            aria-current={number === page ? 'page' : undefined}
            onClick={() => goTo(number)}
          >
            <span className="tabular-nums">{number}</span>
          </Button>
        ))}
      </div>
      <div className="flex gap-1">
        <PageMove
          label="다음 페이지"
          disabled={page === lastPage}
          move={() => goTo(page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </PageMove>
        <PageMove
          label="5페이지 다음"
          disabled={page === lastPage}
          move={() => goTo(Math.min(lastPage, page + 5))}
        >
          <span aria-hidden="true">+5</span>
        </PageMove>
        <PageMove
          label="마지막 페이지"
          disabled={page === lastPage}
          move={() => goTo(lastPage)}
        >
          <ChevronsRight aria-hidden="true" />
        </PageMove>
      </div>
    </nav>
  );
}

function PageMove({
  label,
  disabled,
  move,
  children,
}: {
  label: string;
  disabled: boolean;
  move: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="icon-lg"
      variant="outline"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={move}
    >
      {children}
    </Button>
  );
}
