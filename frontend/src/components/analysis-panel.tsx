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
  type RegionStatTarget,
  type StatisticsResponse,
  type StoreStatistics,
  type SalesStatistics,
  type FootTrafficStatistics,
  type StatisticsSourceBatch,
} from '@/lib/statistics';
import {
  compareStatistic,
  type ComparisonMetric,
} from '@/lib/statistic-comparison';

const quarterLabel = `${STATISTICS_QUARTER.slice(0, 4)}년 ${STATISTICS_QUARTER.slice(4)}분기`;
const previousQuarterLabel = `${PREVIOUS_STATISTICS_QUARTER.slice(0, 4)}년 ${PREVIOUS_STATISTICS_QUARTER.slice(4)}분기`;
const publicationDate = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'long',
  timeStyle: 'medium',
  timeZone: 'Asia/Seoul',
});

/** 숫자는 Number로 변환하거나 축약하지 않아 원본 정밀도와 후행 0을 보존합니다. */
function StatisticValue({
  value,
  unit,
}: {
  value: string | null;
  unit: string;
}) {
  return (
    <>
      <span>{formatStatistic(value)}</span>
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

/** 지표마다 실제 출처의 게시 시각을 표시하고 원본 ISO 문자열은 time 속성에 보존합니다. */
function Publication({
  source,
  scope,
}: {
  source: StatisticsSourceBatch;
  scope: string;
}) {
  return (
    <div className="space-y-1 border-t pt-3 text-xs leading-5 text-muted-foreground">
      <p>출처: 서울시 상권분석서비스 · {scope}</p>
      <p>
        원천 게시 시각:{' '}
        <time dateTime={source.publishedAt}>
          {publicationDate.format(new Date(source.publishedAt))}
        </time>{' '}
        (한국시간)
      </p>
    </div>
  );
}

type StatisticsTab = 'stores' | 'sales' | 'footTraffic';

type ComparisonResource = RegionResource<
  StatisticsResponse<StoreStatistics | SalesStatistics | FootTrafficStatistics>
>;

/** 이전 분기 실패는 현재 요약·상세와 분리하며 검증 전에는 숫자를 공개하지 않습니다. */
function StatisticComparison({
  metric,
  target,
  current,
  previous,
  unit,
}: {
  metric: ComparisonMetric;
  target: RegionStatTarget;
  current: ComparisonResource;
  previous: ComparisonResource;
  unit: string;
}) {
  if (previous.status !== 'ready')
    return (
      <div className="mt-3 border-t pt-2">
        {previous.status === 'error' && (
          <p className="mb-1 text-xs text-muted-foreground">
            비교 불가: 이전 분기 통계 조회 오류
          </p>
        )}
        <StatisticsNotice resource={previous} label="이전 분기 통계" />
      </div>
    );
  if (current.status !== 'ready')
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {current.status === 'error'
          ? '비교 불가: 현재 분기 통계 조회 오류'
          : '비교 대기: 현재 분기 통계를 확인 중입니다.'}
      </p>
    );
  const result = compareStatistic(metric, target, current.data, previous.data);
  return (
    <div className="mt-3 space-y-1 border-t pt-2 text-xs leading-5 [overflow-wrap:anywhere]">
      {result.status === 'unavailable' ? (
        <p className="text-muted-foreground">비교 불가: {result.reason}</p>
      ) : (
        <>
          <p className="font-medium">
            {result.direction === 'increase'
              ? '↑ 증가'
              : result.direction === 'decrease'
                ? '↓ 감소'
                : '변동 없음'}
            {' · '}
            {formatStatistic(result.delta.replace(/^-/, ''))} {unit}
            {' · '}
            {result.rate === null
              ? '증감률 계산 불가 (이전 값 0)'
              : `${result.rate}%`}
          </p>
          <p className="text-muted-foreground">
            증감률은 소수 둘째 자리에서 반올림합니다. 증가·감소는 창업 유불리
            평가가 아닙니다.
          </p>
        </>
      )}
    </div>
  );
}

/** 같은 원천 응답을 핵심 요약과 상세 탭에서 공유하는 지역 전체 분석 패널입니다. */
export function AnalysisPanel({
  region,
  active,
}: {
  region: RegionExplorer;
  active: boolean;
}) {
  const statistics = useStatisticsExplorer(
    region.districtCode,
    region.dongCode,
    active,
  );
  const previousStatistics = useStatisticsExplorer(
    region.districtCode,
    region.dongCode,
    active,
    PREVIOUS_STATISTICS_QUARTER,
  );
  const [tab, setTab] = useState<StatisticsTab>('stores');
  const tabRefs = useRef<
    Partial<Record<StatisticsTab, HTMLButtonElement | null>>
  >({});
  const districtName = region.districts.data?.find(
    (item) => item.districtCode === region.districtCode,
  )?.districtName;
  const dongName = region.dongs.data?.find(
    (item) => item.dongCode === region.dongCode,
  )?.dongName;
  const storeData = statistics.stores.data?.data;
  const salesData = statistics.sales.data?.data;
  const footData = statistics.footTraffic.data?.data;
  const panels = [
    {
      id: 'stores',
      label: '점포 현황',
      resource: statistics.stores,
      note: '전체·세부 점포 수와 개업·폐업률은 원천 값을 그대로 표시합니다.',
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
      note: '원천의 당월 기준 값입니다. 분기 합계·월평균으로 환산하지 않습니다.',
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
      note: '지역 전체 유동인구이며 카페 업종 전용 통계가 아닙니다.',
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
  const regionName = region.dongCode
    ? `${districtName ? `${districtName} · ` : ''}${dongName || '행정동 이름 확인 중'}`
    : districtName || '자치구 이름 확인 중';
  const scope = region.dongCode ? '행정동 원천' : '자치구 공식 원천';
  const summaries = [
    {
      id: 'stores',
      label: '점포 수',
      value: storeData?.storeCount ?? null,
      unit: '개',
      note: '카페·음료 업종',
      resource: statistics.stores,
      previous: previousStatistics.stores,
    },
    {
      id: 'sales',
      label: '당월 추정매출액',
      value: salesData?.monthlySalesAmount ?? null,
      unit: '원',
      note: '카페·음료 업종 · 원천 당월 기준',
      resource: statistics.sales,
      previous: previousStatistics.sales,
    },
    {
      id: 'footTraffic',
      label: '지역 전체 유동인구',
      value: footData?.totalFootTraffic ?? null,
      unit: '명',
      note: '업종 구분 없음 · 추정 유동 규모',
      resource: statistics.footTraffic,
      previous: previousStatistics.footTraffic,
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
              ? `${region.dongCode ? '행정동' : '자치구'} 전체`
              : '지역 선택 필요'}
          </span>
          <span>{quarterLabel}</span>
        </div>
        <h3 className="text-xl leading-7 font-semibold [overflow-wrap:anywhere]">
          {statistics.target ? regionName : '지역을 선택해 주세요'}
        </h3>
        <p className="text-xs leading-5 text-muted-foreground">
          점포·매출: 카페·음료 업종 · 유동인구: 업종 구분 없음
        </p>
        {statistics.target ? (
          <p className="text-xs leading-5 text-muted-foreground">
            선택한 {region.dongCode ? '행정동' : '자치구'} 전체 통계입니다. 특정
            위치의 반경 내 수치와는 다릅니다.
            {!region.dongCode &&
              ' 자치구 공식 원천을 사용하며 행정동 값을 합산하지 않습니다.'}
          </p>
        ) : (
          <p
            role="status"
            className="rounded-xl bg-accent p-3 text-sm leading-6 text-primary"
          >
            상단 지역 필터에서 자치구 또는 행정동을 선택해 주세요.
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
          <p className="text-xs leading-5 text-muted-foreground">
            전분기 비교: {quarterLabel} · 이전 {previousQuarterLabel}. 비교
            기준이 검증된 지표만 증감을 공개합니다.
          </p>
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
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {metric.note}
                </p>
                <StatisticComparison
                  metric={metric.id}
                  target={statistics.target!}
                  current={metric.resource}
                  previous={metric.previous}
                  unit={metric.unit}
                />
              </section>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            출처: 서울시 상권분석서비스. 지표별 원천 게시 시각은 아래 세부
            분석에서 확인할 수 있습니다.
          </p>
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
              <p className="text-xs leading-5 text-muted-foreground">
                {current.note}
              </p>
              <StatisticsNotice
                resource={current.resource}
                label={current.label}
              />
              {current.resource.status === 'ready' &&
                (data ? (
                  <>
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
                    <p className="text-xs font-medium text-muted-foreground">
                      현재 {quarterLabel} 출처
                    </p>
                    <Publication source={data.sourceBatch} scope={scope} />
                    {previousStatistics[tab].data?.data && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          이전 {previousQuarterLabel} 출처
                        </p>
                        <Publication
                          source={previousStatistics[tab].data.data.sourceBatch}
                          scope={scope}
                        />
                      </div>
                    )}
                  </>
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
