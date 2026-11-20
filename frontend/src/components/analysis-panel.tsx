import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useStatisticsExplorer } from '@/hooks/use-statistics-explorer';
import type {
  RegionExplorer,
  RegionResource,
} from '@/hooks/use-region-explorer';
import {
  formatStatistic,
  STATISTICS_QUARTER,
  PREVIOUS_STATISTICS_QUARTER,
} from '@/lib/statistics';

const quarterLabel = `${STATISTICS_QUARTER.slice(0, 4)}년 ${STATISTICS_QUARTER.slice(4)}분기`;

/** 원본 문자열은 유지하고 표시에서만 의미 없는 소수 후행 0을 제거합니다. */
function StatisticValue({
  value,
  unit,
}: {
  value: string | null;
  unit: string;
}) {
  return (
    <>
      <span>{formatStatistic(value, { trimTrailingZeros: true })}</span>
      {value !== null && (
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          {unit}
        </span>
      )}
    </>
  );
}

/** 요약과 상세가 같은 독립 요청 상태·재시도를 사용합니다. */
function StatisticsNotice({
  resource,
  label,
}: {
  resource: RegionResource<unknown>;
  label: string;
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
        className="space-y-2 text-xs leading-5 text-muted-foreground"
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
  if (resource.status === 'idle')
    return <p className="text-xs text-muted-foreground">통계 조회 대기 중</p>;
  return null;
}

type StatisticsTab = 'stores' | 'sales' | 'footTraffic';

/** 같은 원천 응답을 핵심 요약과 상세 탭에서 공유하는 지역 전체 분석 패널입니다. */
export function AnalysisPanel({
  region,
  active,
}: {
  region: RegionExplorer;
  active: boolean;
}) {
  const { districtCode, dongCode, districtName, dongName } = region.analysis;
  const statistics = useStatisticsExplorer(districtCode, dongCode, active);
  const previousStatistics = useStatisticsExplorer(
    districtCode,
    dongCode,
    active,
    PREVIOUS_STATISTICS_QUARTER,
  );
  const previousErrors = [
    previousStatistics.stores,
    previousStatistics.sales,
    previousStatistics.footTraffic,
  ].filter((resource) => resource.status === 'error');
  const [tab, setTab] = useState<StatisticsTab>('stores');
  const tabRefs = useRef<
    Partial<Record<StatisticsTab, HTMLButtonElement | null>>
  >({});
  const storeData = statistics.stores.data?.data;
  const salesData = statistics.sales.data?.data;
  const footData = statistics.footTraffic.data?.data;
  const panels = [
    {
      id: 'stores',
      label: '점포 현황',
      resource: statistics.stores,
      metrics: [
        {
          label: '전체 점포 수',
          value: storeData?.storeCount ?? null,
          unit: '개',
        },
        {
          label: '일반 점포 수',
          value: storeData?.generalStoreCount ?? null,
          unit: '개',
        },
        {
          label: '프랜차이즈 점포 수',
          value: storeData?.franchiseStoreCount ?? null,
          unit: '개',
        },
        {
          label: '개업 점포 수',
          value: storeData?.openedStoreCount ?? null,
          unit: '개',
        },
        {
          label: '폐업 점포 수',
          value: storeData?.closedStoreCount ?? null,
          unit: '개',
        },
        { label: '개업률', value: storeData?.openingRate ?? null, unit: '%' },
        { label: '폐업률', value: storeData?.closureRate ?? null, unit: '%' },
      ],
    },
    {
      id: 'sales',
      label: '추정매출',
      resource: statistics.sales,
      metrics: [
        {
          label: '당월 추정매출액',
          value: salesData?.monthlySalesAmount ?? null,
          unit: '원',
        },
        {
          label: '당월 매출 건수',
          value: salesData?.monthlySalesCount ?? null,
          unit: '건',
        },
        {
          label: '주중 매출액',
          value: salesData?.weekdaySalesAmount ?? null,
          unit: '원',
        },
        {
          label: '주말 매출액',
          value: salesData?.weekendSalesAmount ?? null,
          unit: '원',
        },
      ],
    },
    {
      id: 'footTraffic',
      label: '유동인구',
      resource: statistics.footTraffic,
      metrics: [
        {
          label: '전체 유동인구',
          value: footData?.totalFootTraffic ?? null,
          unit: '명',
        },
        {
          label: '남성 유동인구',
          value: footData?.maleFootTraffic ?? null,
          unit: '명',
        },
        {
          label: '여성 유동인구',
          value: footData?.femaleFootTraffic ?? null,
          unit: '명',
        },
      ],
    },
  ] as const;
  const current = panels.find((panel) => panel.id === tab)!;
  const data = current.resource.data?.data;
  const regionName = dongCode
    ? `${districtName ? `${districtName} · ` : ''}${dongName || '행정동 이름 확인 중'}`
    : districtName || '자치구 이름 확인 중';
  const summaries = [
    {
      id: 'stores',
      label: '점포 수',
      value: storeData?.storeCount ?? null,
      unit: '개',
      resource: statistics.stores,
    },
    {
      id: 'sales',
      label: '당월 추정매출액',
      value: salesData?.monthlySalesAmount ?? null,
      unit: '원',
      resource: statistics.sales,
    },
    {
      id: 'footTraffic',
      label: '지역 전체 유동인구',
      value: footData?.totalFootTraffic ?? null,
      unit: '명',
      resource: statistics.footTraffic,
    },
  ] as const;
  return (
    <section
      aria-label="행정구역 전체 통계"
      className="flex min-w-0 flex-col gap-5 p-5 break-keep text-pretty"
    >
      <header className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-primary">
          <span className="rounded-md bg-accent px-2 py-1">
            {statistics.target
              ? `${dongCode ? '행정동' : '자치구'} 전체`
              : '지역 선택 필요'}
          </span>
          <span>{quarterLabel}</span>
        </div>
        <h3 className="text-xl leading-7 font-semibold [overflow-wrap:anywhere]">
          {statistics.target
            ? regionName
            : region.placeRegion.status === 'idle'
              ? '지역을 선택해 주세요'
              : '검색 위치의 행정구역'}
        </h3>
        {statistics.target ? (
          <p className="text-xs text-muted-foreground">
            점포·매출은 카페·음료 업종 · 유동인구는 지역 전체
          </p>
        ) : region.placeRegion.status === 'ready' ? (
          <p role="status" className="text-sm text-muted-foreground">
            서울 내 한 자치구로 확정할 수 없습니다. 지역 필터에서 분석할 지역을
            선택해 주세요.
          </p>
        ) : region.placeRegion.status !== 'idle' ? (
          <StatisticsNotice
            resource={region.placeRegion}
            label="검색 위치의 행정구역"
          />
        ) : (
          <p
            role="status"
            className="rounded-xl bg-accent p-3 text-sm leading-6 text-primary"
          >
            장소를 검색하거나 지역 필터에서 자치구·행정동을 선택해 주세요.
          </p>
        )}
      </header>
      {statistics.target && (
        <section
          aria-labelledby="statistics-summary-heading"
          className="min-w-0 space-y-3"
        >
          <h4 id="statistics-summary-heading" className="text-sm font-semibold">
            핵심 지표
          </h4>
          <div className="grid min-w-0 gap-2">
            {summaries.map((metric) => (
              <section
                key={metric.label}
                aria-label={`${metric.label} 요약`}
                aria-busy={metric.resource.status === 'loading'}
                className="min-w-0 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3"
              >
                <dl className="min-w-0">
                  <dt className="text-xs font-medium text-primary">
                    {metric.label}
                  </dt>
                  <dd className="mt-1 flex min-h-9 min-w-0 flex-col justify-center text-xl leading-7 font-semibold tabular-nums [overflow-wrap:anywhere]">
                    {metric.resource.status === 'ready' ? (
                      <span>
                        <StatisticValue
                          value={metric.value}
                          unit={metric.unit}
                        />
                      </span>
                    ) : (
                      <StatisticsNotice
                        resource={metric.resource}
                        label={metric.label}
                      />
                    )}
                  </dd>
                </dl>
              </section>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">전분기 비교 준비 중</p>
          {previousErrors.length > 0 && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 text-xs"
            >
              <p>이전 분기 통계를 불러오지 못했습니다.</p>
              <Button
                variant="outline"
                size="sm"
                aria-label="이전 분기 통계 다시 시도"
                onClick={() =>
                  previousErrors.forEach((resource) => resource.retry())
                }
              >
                다시 시도
              </Button>
            </div>
          )}
        </section>
      )}
      <section
        aria-labelledby="statistics-details-heading"
        className="flex min-w-0 flex-col gap-3 border-t pt-4"
      >
        <h4 id="statistics-details-heading" className="text-sm font-semibold">
          세부 분석
        </h4>
        <div
          role="tablist"
          aria-label="통계 항목"
          className="grid min-w-0 grid-cols-3 gap-1 rounded-xl bg-muted/50 p-1"
        >
          {panels.map((panel, index) => (
            <Button
              key={panel.id}
              ref={(node) => {
                tabRefs.current[panel.id] = node;
              }}
              id={`statistics-tab-${panel.id}`}
              role="tab"
              aria-selected={tab === panel.id}
              aria-controls={`statistics-panel-${panel.id}`}
              tabIndex={tab === panel.id ? 0 : -1}
              variant={tab === panel.id ? 'outline' : 'ghost'}
              size="sm"
              className="min-w-0"
              onClick={() => setTab(panel.id)}
              onKeyDown={(event) => {
                let next: number;
                if (event.key === 'ArrowRight')
                  next = (index + 1) % panels.length;
                else if (event.key === 'ArrowLeft')
                  next = (index + panels.length - 1) % panels.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = panels.length - 1;
                else return;
                event.preventDefault();
                setTab(panels[next].id);
                tabRefs.current[panels[next].id]?.focus();
              }}
            >
              {panel.label}
            </Button>
          ))}
        </div>
        <div
          id={`statistics-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`statistics-tab-${tab}`}
          tabIndex={0}
          className="flex min-w-0 flex-col gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {!statistics.target ? (
            <p className="text-sm leading-6 text-muted-foreground">
              지역을 선택하면 세부 통계를 확인할 수 있습니다.
            </p>
          ) : (
            <>
              <StatisticsNotice
                resource={current.resource}
                label={current.label}
              />
              {current.resource.status === 'ready' &&
                (data ? (
                  <dl className="grid min-w-0 gap-2">
                    {current.metrics.map((metric) => (
                      <div
                        key={metric.label}
                        className="min-w-0 rounded-xl border px-4 py-3"
                      >
                        <dt className="text-xs leading-5 text-muted-foreground">
                          {metric.label}
                        </dt>
                        <dd className="mt-1 text-base leading-6 font-semibold tabular-nums [overflow-wrap:anywhere]">
                          <StatisticValue
                            value={metric.value}
                            unit={metric.unit}
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p
                    role="status"
                    className="rounded-xl bg-muted/40 p-4 text-sm leading-6 text-muted-foreground"
                  >
                    선택한 지역·조회 조건의 통계 자료가 없습니다.
                  </p>
                ))}
            </>
          )}
        </div>
      </section>
    </section>
  );
}
