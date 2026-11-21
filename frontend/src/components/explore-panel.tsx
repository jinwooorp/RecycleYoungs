import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnalysisPanel } from '@/components/analysis-panel';
import type { CafeExplorer } from '@/hooks/use-cafe-explorer';
import { cafeAddress, formatCafeDistance } from '@/lib/cafes';
import type {
  RegionExplorer,
  RegionResource,
} from '@/hooks/use-region-explorer';

export type ExploreMenu = 'cafes' | 'analysis' | 'compare';

function ResourceNotice({
  resource,
  label,
  empty,
}: {
  resource: RegionResource<unknown>;
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
        className="flex flex-col items-start gap-2 text-xs leading-5 text-muted-foreground"
      >
        <p>
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

/** 메뉴별 후속 연동 영역을 분리하고 실제 데이터가 없는 상태를 안내합니다. */
export function ExplorePanel({
  menu,
  region,
  cafes,
  active = true,
  quarter,
}: {
  menu: ExploreMenu;
  region: RegionExplorer;
  cafes: CafeExplorer;
  active?: boolean;
  quarter: string | null;
}) {
  if (menu === 'cafes') return <CafePanel cafes={cafes} />;
  if (menu === 'analysis')
    return <AnalysisPanel region={region} active={active} quarter={quarter} />;
  return null;
}

function CafePanel({ cafes }: { cafes: CafeExplorer }) {
  const nearby = cafes.mode === 'nearby';
  return (
    <div className="flex flex-col gap-4 p-5 break-keep text-pretty">
      <section aria-labelledby="nearby-heading" className="flex flex-col gap-3">
        <div
          role="group"
          aria-label="주변 탐색 방식"
          className="explore-nearby-mode grid grid-cols-2 gap-2"
        >
          <Button
            variant="outline"
            size="sm"
            aria-pressed={!nearby}
            onClick={() => cafes.setMode('viewport')}
          >
            지도 영역
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={nearby}
            onClick={() => cafes.setMode('nearby')}
          >
            선택 지점 주변
          </Button>
        </div>
        <h3 id="nearby-heading" className="text-sm font-semibold">
          {nearby ? '선택 지점 주변 카페' : '현재 지도 영역 카페'}
        </h3>
        {nearby && (
          <>
            <label className="flex min-w-0 flex-col gap-2 text-xs font-medium">
              탐색 반경
              <span className="relative block">
                <select
                  value={cafes.radiusM}
                  onChange={(event) =>
                    cafes.setRadiusM(event.target.value === '1000' ? 1000 : 500)
                  }
                  className="h-11 w-full appearance-none rounded-lg border bg-muted/50 pr-10 pl-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="500">500m</option>
                  <option value="1000">1km</option>
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
              </span>
            </label>
            <div className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-3 text-xs leading-5">
              <p className="font-medium">선택 지점</p>
              {cafes.center ? (
                <div
                  className="space-y-1 [overflow-wrap:anywhere]"
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
        className="flex flex-col gap-3 border-t pt-4"
      >
        <h3 id="cafe-list-heading" className="text-sm font-semibold">
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
            <p role="status" className="text-sm font-medium">
              {nearby ? '반경 내 ' : '지도 영역 '}
              {cafes.data.totalCount.toLocaleString('ko-KR')}곳
              {cafes.items.length !== cafes.data.totalCount &&
                ` · ${cafes.items.length.toLocaleString('ko-KR')}곳 표시`}
            </p>
            {cafes.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {nearby
                  ? '선택한 반경 내에 조회된 카페가 없습니다.'
                  : '현재 지도 영역에 조회된 카페가 없습니다.'}
              </p>
            )}
            {cafes.items.length > 0 && (
              <ul className="flex flex-col divide-y rounded-xl border px-3">
                {cafes.items.map((cafe) => (
                  <li key={cafe.bizesId} className="py-3">
                    <button
                      type="button"
                      onClick={() => cafes.selectCafe(cafe.bizesId)}
                      aria-pressed={cafes.selected?.bizesId === cafe.bizesId}
                      className="w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block text-sm font-medium text-primary">
                        {cafe.storeName}
                        {cafe.branchName ? ` · ${cafe.branchName}` : ''}
                      </span>
                      {nearby && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {cafe.semasIndustryName} ·{' '}
                          {cafe.distanceM !== undefined &&
                            formatCafeDistance(cafe.distanceM)}
                        </span>
                      )}
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {cafeAddress(cafe)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
