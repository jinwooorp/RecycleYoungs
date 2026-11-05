import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { RegionResource } from '@/hooks/use-region-explorer';
import type { Candidates } from '@/hooks/use-candidates';
import {
  useCandidateAnalysis,
  type CandidateAnalysis,
} from '@/hooks/use-candidate-analysis';
import {
  candidateNameLimit,
  type Candidate,
  type CandidateSlot,
} from '@/lib/candidates';
import { cafeAddress, formatCafeDistance } from '@/lib/cafes';
import {
  formatStatistic,
  type StatisticsResponse,
  type StatisticsSourceBatch,
} from '@/lib/statistics';

function Result<T>({
  resource,
  label,
  children,
}: {
  resource: RegionResource<T>;
  label: string;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === 'loading')
    return <span role="status">불러오는 중</span>;
  if (resource.status === 'error')
    return (
      <div className="space-y-2">
        <p role="alert">{resource.error}</p>
        <Button
          size="sm"
          variant="outline"
          aria-label={`${label} 다시 시도`}
          onClick={resource.retry}
        >
          다시 시도
        </Button>
      </div>
    );
  if (resource.status === 'idle')
    return <span className="text-muted-foreground">조회 대기 중</span>;
  return resource.data === null ? '자료 없음' : children(resource.data);
}

const publicationDate = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'long',
  timeStyle: 'medium',
  timeZone: 'Asia/Seoul',
});
function Publication({ publishedAt }: { publishedAt: string }) {
  return (
    <p className="mt-2 text-xs leading-5 text-muted-foreground">
      게시{' '}
      <time dateTime={publishedAt}>
        {publicationDate.format(new Date(publishedAt))}
      </time>{' '}
      (한국시간)
    </p>
  );
}

function CafeCount({ analysis }: { analysis: CandidateAnalysis }) {
  return analysis.regions.data?.districts.length ? (
    <Result resource={analysis.cafes} label={`${analysis.item.slot} 경쟁 카페`}>
      {(page) => (
        <span className="font-semibold tabular-nums">
          {formatStatistic(String(page.totalCount))}곳
        </span>
      )}
    </Result>
  ) : (
    <p className="text-xs text-muted-foreground">{analysis.unavailable}</p>
  );
}

function Competition({
  analysis,
  radius,
}: {
  analysis: CandidateAnalysis;
  radius: Candidates['radius'];
}) {
  return (
    <section
      aria-label={`후보지 ${analysis.item.slot} 주변 경쟁 환경`}
      className="min-w-0 space-y-3 rounded-xl border p-4 text-sm [overflow-wrap:anywhere]"
    >
      <h4 className="font-semibold">
        {analysis.item.slot} · {analysis.item.name}
      </h4>
      <p className="text-xs text-muted-foreground">
        공통 반경 {radius === 500 ? '500m' : '1km'} 내 전체 경쟁 카페
      </p>
      <CafeCount analysis={analysis} />
      {!!analysis.regions.data?.districts.length &&
        analysis.cafes.status === 'ready' && (
          <Result
            resource={analysis.cafes}
            label={`${analysis.item.slot} 경쟁 카페 목록`}
          >
            {(page) => (
              <>
                <p className="text-xs leading-5 text-muted-foreground">
                  서버가 반환한 {page.items.length}곳 중 가까운 최대 3곳을
                  표시합니다. 조회 상한은 200곳입니다.
                  {page.hasMore && ' 전체 건수 중 일부만 반환되었습니다.'}
                </p>
                {page.items.length ? (
                  <ol className="divide-y">
                    {page.items.slice(0, 3).map((cafe) => (
                      <li key={cafe.bizesId} className="space-y-1 py-3">
                        <p className="font-medium">
                          {cafe.storeName}
                          {cafe.branchName ? ` · ${cafe.branchName}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          중심점에서{' '}
                          {cafe.distanceM === undefined
                            ? '거리 자료 없음'
                            : formatCafeDistance(cafe.distanceM)}
                        </p>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {cafeAddress(cafe)}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="rounded-lg bg-muted/40 p-3">
                    {page.totalCount === 0
                      ? '선택한 반경 내에 카페가 없습니다.'
                      : '반환된 카페 목록이 없습니다.'}
                  </p>
                )}
                <Publication publishedAt={page.sourceBatch.publishedAt} />
              </>
            )}
          </Result>
        )}
    </section>
  );
}

function DongMetrics({ analysis }: { analysis: CandidateAnalysis }) {
  const { statistics, dong, item, unavailable } = analysis;
  if (!dong || !statistics)
    return (
      <section
        aria-label={`후보지 ${item.slot} 행정동 통계`}
        className="min-w-0 space-y-2 rounded-xl border p-4 text-sm [overflow-wrap:anywhere]"
      >
        <h4 className="font-semibold">
          {item.slot} · {item.name}
        </h4>
        <p className="text-muted-foreground">비교 불가: {unavailable}</p>
      </section>
    );
  const metrics = [
    {
      label: '카페 업종 점포 수',
      retry: '점포',
      resource: statistics.stores,
      value: statistics.stores.data?.data?.storeCount ?? null,
      unit: '개',
    },
    {
      label: '당월 추정매출액',
      retry: '추정매출',
      resource: statistics.sales,
      value: statistics.sales.data?.data?.monthlySalesAmount ?? null,
      unit: '원',
    },
    {
      label: '지역 전체 유동인구',
      retry: '유동인구',
      resource: statistics.footTraffic,
      value: statistics.footTraffic.data?.data?.totalFootTraffic ?? null,
      unit: '명',
    },
  ];
  return (
    <section
      aria-label={`후보지 ${item.slot} 행정동 통계`}
      className="min-w-0 space-y-3 rounded-xl border p-4 text-sm [overflow-wrap:anywhere]"
    >
      <h4 className="font-semibold">
        {item.slot} · {item.name}
      </h4>
      <p className="text-xs leading-5 text-muted-foreground">
        {dong.dongName} 전체 · 2026년 2분기
      </p>
      <dl className="min-w-0 divide-y">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 space-y-2 py-3">
            <dt className="text-xs text-muted-foreground">{metric.label}</dt>
            <dd className="min-w-0 leading-6 tabular-nums [overflow-wrap:anywhere]">
              <Result<
                StatisticsResponse<{ sourceBatch: StatisticsSourceBatch }>
              >
                resource={metric.resource}
                label={`${item.slot} ${metric.retry}`}
              >
                {({ data }) =>
                  data ? (
                    <>
                      <p className="font-semibold">
                        {formatStatistic(metric.value)}
                        {metric.value === null ? '' : metric.unit}
                      </p>
                      {metric.retry === '점포' &&
                        statistics.stores.data?.data && (
                          <p className="text-xs text-muted-foreground">
                            개업{' '}
                            {formatStatistic(
                              statistics.stores.data.data.openedStoreCount,
                            )}{' '}
                            · 폐업{' '}
                            {formatStatistic(
                              statistics.stores.data.data.closedStoreCount,
                            )}
                          </p>
                        )}
                      <Publication publishedAt={data.sourceBatch.publishedAt} />
                    </>
                  ) : (
                    '자료 없음'
                  )
                }
              </Result>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** 후보지 저장 형식은 유지하고 반경 경쟁 환경과 행정동 전체 통계를 분리합니다. */
export function CandidatePanel({
  candidates,
  active,
  mapReady,
  onSelect,
}: {
  candidates: Candidates;
  active: boolean;
  mapReady: boolean;
  onSelect: (item: Candidate) => void;
}) {
  const { items, picking, pending, notice, radius } = candidates;
  const analyses = useCandidateAnalysis(items, radius, active);
  const selectionRefs = useRef<
    Partial<Record<CandidateSlot, HTMLButtonElement | null>>
  >({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const afterRemoval = useRef<CandidateSlot | 'heading' | null>(null);
  useEffect(() => {
    const target = afterRemoval.current;
    if (!target) return;
    (target === 'heading'
      ? headingRef.current
      : selectionRefs.current[target]
    )?.focus();
    afterRemoval.current = null;
  }, [items]);
  useEffect(() => {
    if (active && candidates.selected)
      selectionRefs.current[candidates.selected]?.scrollIntoView?.({
        block: 'nearest',
      });
  }, [active, candidates.selected]);
  return (
    <div className="flex min-w-0 flex-col gap-5 p-5 break-keep text-pretty">
      <header className="space-y-2">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {items.length > 1
            ? `${items.length}개 후보지 분석`
            : items.length === 1
              ? '후보지 상세 분석'
              : '후보지 등록'}
        </h3>
        <p className="text-xs leading-5 text-muted-foreground">
          후보지를 최대 3곳까지 등록할 수 있습니다. 목록은 이 브라우저 탭에 임시
          저장됩니다.
        </p>
      </header>
      <Button
        variant="outline"
        aria-pressed={picking}
        disabled={!mapReady || pending || items.length >= 3}
        onClick={() => candidates.setPicking(!picking)}
      >
        {picking ? '지도 추가 모드 끄기' : '지도에서 후보지 추가'}
      </Button>
      {picking && (
        <p role="status" className="text-sm">
          지도에서 등록할 위치를 클릭하세요.
        </p>
      )}
      {pending && (
        <p role="status" className="text-sm">
          후보지가 서울 경계에 속하는지 확인 중입니다.
        </p>
      )}
      {notice && (
        <div role={notice.error ? 'alert' : 'status'} className="text-sm">
          <p>{notice.message}</p>
          {notice.retry && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void candidates.add(notice.retry!)}
            >
              등록 다시 시도
            </Button>
          )}
        </div>
      )}
      {candidates.storageUnavailable && (
        <p role="alert" className="text-sm">
          탭 저장소를 사용할 수 없어 새로고침하면 목록이 사라집니다.
        </p>
      )}
      <label className="flex flex-wrap items-center justify-between gap-2 text-sm">
        공통 탐색 반경
        <select
          value={radius}
          onChange={(event) =>
            candidates.setRadius(event.target.value === '1000' ? 1000 : 500)
          }
          className="h-9 rounded-md border bg-background px-2"
        >
          <option value="500">500m</option>
          <option value="1000">1km</option>
        </select>
      </label>
      {!items.length ? (
        <p className="rounded-xl bg-accent p-4 text-sm leading-6">
          등록된 후보지가 없습니다. 지도 또는 장소 검색에서 추가하세요.
        </p>
      ) : (
        <>
          <section aria-label="후보지 요약" className="min-w-0 space-y-3">
            <h3 className="text-sm font-semibold">후보지 요약</h3>
            {analyses.map((analysis) => {
              const { item, regions } = analysis;
              const selected = candidates.selected === item.slot;
              return (
                <section
                  key={item.slot}
                  aria-label={`후보지 ${item.slot} 요약`}
                  data-selected={selected}
                  className={`min-w-0 space-y-3 rounded-xl border p-4 [overflow-wrap:anywhere] ${selected ? 'border-primary bg-primary/5' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-primary">
                      후보지 {item.slot}
                    </span>
                    {selected && (
                      <span className="text-xs font-medium text-primary">
                        선택됨
                      </span>
                    )}
                  </div>
                  <Button
                    ref={(node) => {
                      selectionRefs.current[item.slot] = node;
                    }}
                    variant="outline"
                    className="h-auto w-full justify-start whitespace-normal [overflow-wrap:anywhere]"
                    aria-label={`후보지 ${item.slot} 지도에서 위치 확인`}
                    aria-pressed={selected}
                    disabled={!mapReady}
                    onClick={() => onSelect(item)}
                  >
                    {item.name}
                  </Button>
                  <div className="text-xs leading-5">
                    <Result resource={regions} label={`${item.slot} 소속 지역`}>
                      {({ districts, dongs }) =>
                        districts.length ? (
                          <>
                            <p>
                              {districts
                                .map((area) => area.districtName)
                                .join(' · ')}{' '}
                              ·{' '}
                              {dongs.length
                                ? dongs.map((area) => area.dongName).join(' · ')
                                : '소속 행정동 없음'}
                            </p>
                            {!analysis.dong && (
                              <p className="text-muted-foreground">
                                {analysis.unavailable}
                              </p>
                            )}
                          </>
                        ) : (
                          '서울 경계 밖'
                        )
                      }
                    </Result>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="text-xs text-muted-foreground">
                      반경 {radius === 500 ? '500m' : '1km'} 내 전체 경쟁 카페
                    </p>
                    <CafeCount analysis={analysis} />
                  </div>
                  <details className="text-xs leading-5 text-muted-foreground">
                    <summary className="cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      위치 좌표
                    </summary>
                    <p>
                      경도 {item.longitude.toFixed(6)} · 위도{' '}
                      {item.latitude.toFixed(6)}
                    </p>
                  </details>
                  <form
                    className="flex min-w-0 flex-wrap gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const input = event.currentTarget.elements.namedItem(
                        'name',
                      ) as HTMLInputElement;
                      candidates.rename(item.slot, input.value);
                      input.value = input.value.trim() || item.name;
                    }}
                  >
                    <input
                      name="name"
                      aria-label={`후보지 ${item.slot} 이름`}
                      defaultValue={item.name}
                      required
                      maxLength={candidateNameLimit}
                      className="h-8 min-w-0 flex-1 rounded-md border px-2 text-sm"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      aria-label={`후보지 ${item.slot} 이름 저장`}
                    >
                      저장
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`후보지 ${item.slot} 삭제`}
                      onClick={() => {
                        const index = items.findIndex(
                          (other) => other.slot === item.slot,
                        );
                        const rest = items.filter(
                          (other) => other.slot !== item.slot,
                        );
                        afterRemoval.current =
                          rest[index]?.slot ?? rest.at(-1)?.slot ?? 'heading';
                        candidates.remove(item.slot);
                      }}
                    >
                      삭제
                    </Button>
                  </form>
                </section>
              );
            })}
          </section>
          <section
            aria-label="주변 경쟁 환경"
            className="min-w-0 space-y-3 border-t pt-4"
          >
            <h3 className="text-sm font-semibold">주변 경쟁 환경</h3>
            <p className="text-xs leading-5 text-muted-foreground">
              모든 후보지에 같은 반경 {radius === 500 ? '500m' : '1km'}를
              적용합니다. 경쟁 카페는 반경 내 전체 건수이며, 많고 적음이 창업
              유불리를 뜻하지 않습니다. 출처: 소상공인시장진흥공단
              상가(상권)정보.
            </p>
            {analyses.map((analysis) => (
              <Competition
                key={analysis.item.slot}
                analysis={analysis}
                radius={radius}
              />
            ))}
          </section>
          <section
            aria-label="소속 행정동 상권 특성"
            className="min-w-0 space-y-3 border-t pt-4"
          >
            <h3 className="text-sm font-semibold">소속 행정동 상권 특성</h3>
            <p className="text-xs leading-5 text-muted-foreground">
              2026년 2분기 행정동 전체 통계입니다. 점포·당월 추정매출은 카페
              업종, 유동인구는 업종 구분 없이 집계합니다. 반경 내 통계가 아니며
              합산·환산하지 않습니다. 당월 추정매출은 분기 합계나 월평균이
              아닙니다. 같은 행정동의 후보지는 동일한 행정동 통계와 조회 응답을
              공유합니다. 출처: 서울시 상권분석서비스.
            </p>
            {analyses.map((analysis) => (
              <DongMetrics key={analysis.item.slot} analysis={analysis} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
