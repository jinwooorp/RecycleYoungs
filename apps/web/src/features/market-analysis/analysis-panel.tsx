import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { NativeSelect } from '@/shared/ui/native-select';
import { useStatisticsExplorer } from '@/entities/statistics/use-statistics-explorer';
import type { RequestResource } from '@/shared/hooks/use-request';
import type { District, Dong } from '@/entities/region/regions';
import {
  formatQuarter,
  formatStatistic,
  metricCodes,
  STATISTICS_INDUSTRY,
  type MetricCode,
} from '@/entities/statistics/statistics';
import { statisticsSource } from '@/entities/statistics/statistics-source';
import {
  DataSourceDetails,
  PublishedDate,
} from '@/shared/components/data-provenance';
import { StatisticBars } from './statistic-bars';
import type { AnalysisSelection } from './analysis-selection';

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
        <span className="ml-1 text-xs font-normal tracking-normal text-muted-foreground">
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
  resource: RequestResource<unknown>;
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
      <div role="alert" className="space-y-2 text-xs leading-5">
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
  if (resource.status === 'idle')
    return <p className="text-xs text-muted-foreground">통계 조회 대기 중</p>;
  return null;
}

interface AnalysisRegion {
  districtCodes: string[];
  districts: RequestResource<District[]>;
  analysisDongs: RequestResource<Dong[]>;
  placeRegion: RequestResource<unknown>;
  analysis: {
    districtCode: string;
    dongCode: string;
    districtName: string | undefined;
    dongName: string | undefined;
    fromSearch: boolean;
  };
  selectAnalysisDistrict: (code: string) => void;
  selectAnalysisDong: (code: string) => void;
}

/** 핵심 지표와 세부 분석이 동일한 지역·분기의 응답을 공유합니다. */
export function AnalysisPanel({
  region,
  active,
  quarter,
  quarterControl,
  selectedMetrics,
  onSelectMetric,
}: {
  region: AnalysisRegion;
  active: boolean;
  quarter: string | null;
  quarterControl?: ReactNode;
  selectedMetrics: readonly MetricCode[];
  onSelectMetric: (metric: AnalysisSelection) => void;
}) {
  const { districtCode, dongCode, districtName, dongName } = region.analysis;
  const { fromSearch } = region.analysis;
  const chooseDong =
    region.districtCodes.length > 1 && !fromSearch && !!districtCode;
  const chooseDistrict =
    region.districtCodes.length > 1 ||
    (fromSearch && region.districtCodes.length === 1);
  const statistics = useStatisticsExplorer(
    districtCode,
    dongCode,
    active,
    quarter,
  );
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
        { label: '개업률', value: storeData?.openingRate ?? null, unit: '%' },
        { label: '폐업률', value: storeData?.closureRate ?? null, unit: '%' },
      ],
      groups: [
        {
          title: '일반·프랜차이즈 점포',
          unit: '개',
          items: [
            {
              label: '일반 점포 수',
              value: storeData?.generalStoreCount ?? null,
            },
            {
              label: '프랜차이즈 점포 수',
              value: storeData?.franchiseStoreCount ?? null,
            },
          ],
        },
        {
          title: '개업·폐업 점포',
          unit: '개',
          items: [
            {
              label: '개업 점포 수',
              value: storeData?.openedStoreCount ?? null,
            },
            {
              label: '폐업 점포 수',
              value: storeData?.closedStoreCount ?? null,
            },
          ],
        },
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
      ],
      groups: [
        {
          title: '주중·주말 추정매출액',
          unit: '원',
          items: [
            {
              label: '주중 매출액',
              value: salesData?.weekdaySalesAmount ?? null,
            },
            {
              label: '주말 매출액',
              value: salesData?.weekendSalesAmount ?? null,
            },
          ],
        },
      ],
    },
    {
      id: 'foot-traffic',
      label: '유동인구',
      resource: statistics.footTraffic,
      metrics: [
        {
          label: '전체 유동인구',
          value: footData?.totalFootTraffic ?? null,
          unit: '명',
        },
      ],
      groups: [
        {
          title: '남성·여성 유동인구',
          unit: '명',
          items: [
            {
              label: '남성 유동인구',
              value: footData?.maleFootTraffic ?? null,
            },
            {
              label: '여성 유동인구',
              value: footData?.femaleFootTraffic ?? null,
            },
          ],
        },
      ],
    },
  ] as const;
  const allSelected = selectedMetrics.length === metricCodes.length;
  const selectedPanels = panels.filter(({ id }) =>
    selectedMetrics.includes(id),
  );
  const readyPanels = selectedPanels.filter(
    ({ resource }) => resource.status === 'ready' && resource.data?.data,
  );
  const details = readyPanels.flatMap(({ metrics }) => [...metrics]);
  const charts = readyPanels.flatMap(({ id, groups }) =>
    groups.map((group) => ({ id, group })),
  );
  const regionName = dongCode
    ? `${districtName ? `${districtName} · ` : ''}${dongName || '행정동 이름 확인 중'}`
    : districtName || '자치구 이름 확인 중';
  const regionScope = dongCode ? '행정동 전체' : '자치구 전체';
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
      id: 'foot-traffic',
      label: '지역 전체 유동인구',
      value: footData?.totalFootTraffic ?? null,
      unit: '명',
      resource: statistics.footTraffic,
    },
  ] as const;
  const sources = summaries.flatMap(({ id, resource }) =>
    resource.status === 'ready' && resource.data?.data
      ? [statisticsSource(dongCode ? 'dong' : 'district', id)]
      : [],
  );
  return (
    <section
      aria-label="행정구역 전체 통계"
      className="@container/analysis flex min-w-0 flex-col gap-3 p-4 break-keep text-pretty sm:p-5"
    >
      <header className="min-w-0 space-y-2 border-b pb-2">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 @min-[40rem]/analysis:grid-cols-[max-content_minmax(0,1fr)_max-content]">
          <div className="col-span-full min-w-0 empty:hidden @min-[40rem]/analysis:col-span-1">
            {quarterControl}
          </div>
          <div className="flex min-h-11 min-w-0 flex-wrap content-center items-center gap-x-2 gap-y-0.5">
            <h3 className="text-base leading-6 font-semibold [overflow-wrap:anywhere]">
              {statistics.target
                ? regionName
                : !fromSearch
                  ? '지역을 선택해 주세요'
                  : '검색 위치의 행정구역'}
            </h3>
            {statistics.target && (
              <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-primary">
                {regionScope}
              </span>
            )}
            {!quarterControl &&
              quarter &&
              (statistics.target || fromSearch) && (
                <span className="text-xs font-medium text-primary">
                  {formatQuarter(quarter)}
                </span>
              )}
            {fromSearch && (
              <span className="text-xs font-medium text-primary">
                검색 위치 기준
              </span>
            )}
          </div>
          <label className="flex min-h-11 min-w-0 items-center gap-2 text-xs font-medium">
            업종
            <NativeSelect
              defaultValue={STATISTICS_INDUSTRY}
              className="h-11"
              containerClassName="w-24"
            >
              <option value={STATISTICS_INDUSTRY}>카페</option>
            </NativeSelect>
          </label>
        </div>
        {(chooseDistrict || chooseDong) && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            {chooseDistrict && (
              <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium">
                분석할 자치구
                <NativeSelect
                  className="h-9"
                  containerClassName="w-40 max-w-full"
                  value={fromSearch ? 'place' : districtCode}
                  onChange={(event) =>
                    region.selectAnalysisDistrict(event.target.value)
                  }
                >
                  {fromSearch && (
                    <option value="place" disabled>
                      검색 위치 기준
                    </option>
                  )}
                  {region.districtCodes.length > 1 && (
                    <option value="">자치구를 선택하세요</option>
                  )}
                  {region.districts.data
                    ?.filter((item) =>
                      region.districtCodes.includes(item.districtCode),
                    )
                    .map((item) => (
                      <option key={item.districtCode} value={item.districtCode}>
                        {item.districtName}
                      </option>
                    ))}
                </NativeSelect>
              </label>
            )}
            {chooseDong && (
              <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium">
                분석할 행정동
                <NativeSelect
                  className="h-9"
                  containerClassName="w-40 max-w-full"
                  value={dongCode}
                  disabled={
                    region.analysisDongs.status !== 'ready' ||
                    !region.analysisDongs.data?.length
                  }
                  onChange={(event) =>
                    region.selectAnalysisDong(event.target.value)
                  }
                >
                  <option value="">자치구 전체</option>
                  {region.analysisDongs.data?.map((item) => (
                    <option key={item.dongCode} value={item.dongCode}>
                      {item.dongName}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
          </div>
        )}
        {chooseDong && (
          <StatisticsNotice
            resource={region.analysisDongs}
            label="분석 행정동 목록"
          />
        )}
        {!statistics.target &&
          (fromSearch && region.placeRegion.status === 'ready' ? (
            <p role="status" className="text-sm text-muted-foreground">
              서울 내 한 자치구로 확정할 수 없습니다. 지역 필터에서 분석할
              지역을 선택해 주세요.
            </p>
          ) : fromSearch ? (
            <StatisticsNotice
              resource={region.placeRegion}
              label="검색 위치의 행정구역"
            />
          ) : (
            <p
              role="status"
              className="rounded-xl bg-accent p-3 text-sm leading-6 text-primary"
            >
              {chooseDistrict
                ? '지도에서 탐색 중인 자치구 중 한 곳의 통계를 확인할 수 있습니다.'
                : '장소를 검색하거나 지역 필터에서 자치구·행정동을 선택해 주세요.'}
            </p>
          ))}
      </header>
      {statistics.target && quarter && (
        <section
          aria-labelledby="statistics-summary-heading"
          className="min-w-0 space-y-2"
        >
          <h4
            id="statistics-summary-heading"
            className="text-sm font-semibold text-primary"
          >
            핵심 지표
          </h4>
          <div className="grid min-w-0 gap-2 lg:grid-cols-3">
            {summaries.map((metric) => (
              <section
                key={metric.label}
                aria-label={`${metric.label} 요약`}
                aria-busy={metric.resource.status === 'loading'}
                className="min-w-0 rounded-xl border border-primary/20 bg-accent/55 px-3 py-2"
              >
                <dl className="min-w-0">
                  <dt className="text-xs font-medium text-primary">
                    {metric.label}
                  </dt>
                  <dd className="mt-1 flex min-h-9 min-w-0 flex-col justify-center text-xl leading-7 font-semibold tracking-tight text-primary tabular-nums [overflow-wrap:anywhere]">
                    {metric.resource.status === 'ready' ? (
                      metric.resource.data?.data ? (
                        <>
                          <span>
                            <StatisticValue
                              value={metric.value}
                              unit={metric.unit}
                            />
                          </span>
                          <PublishedDate
                            publishedAt={
                              metric.resource.data.data.sourceBatch.publishedAt
                            }
                          />
                        </>
                      ) : (
                        <span className="text-sm">
                          선택한 지역·분기의 자료 없음
                        </span>
                      )
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
        </section>
      )}
      {statistics.target && (
        <section
          aria-labelledby="statistics-details-heading"
          className="flex min-w-0 flex-col gap-2 border-t pt-3"
        >
          <h4 id="statistics-details-heading" className="text-sm font-semibold">
            세부 분석
          </h4>
          <div
            role="group"
            aria-label="통계 항목"
            aria-describedby="statistics-selection-help"
            className="analysis-detail-options grid min-w-0 grid-cols-2 gap-1 rounded-xl bg-muted/50 p-1 @min-[28rem]/analysis:grid-cols-4"
          >
            <p id="statistics-selection-help" className="sr-only">
              모두를 선택하면 세 항목을 함께 표시합니다. 최소 한 항목을
              표시합니다.
            </p>
            {([{ id: 'all', label: '모두' }, ...panels] as const).map(
              ({ id, label }) => {
                const pressed =
                  id === 'all'
                    ? allSelected
                    : !allSelected && selectedMetrics.includes(id);
                return (
                  <Button
                    key={id}
                    type="button"
                    aria-pressed={pressed}
                    aria-controls="statistics-details-content"
                    variant={pressed ? 'outline' : 'ghost'}
                    size="sm"
                    className="h-11 min-w-0"
                    onClick={() => onSelectMetric(id)}
                  >
                    {pressed && <Check aria-hidden="true" />}
                    {label}
                  </Button>
                );
              },
            )}
          </div>
          <section
            id="statistics-details-content"
            aria-label="선택한 세부 분석"
            tabIndex={0}
            className="flex min-w-0 flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {quarter &&
              selectedPanels.map(({ id, label, resource }) =>
                resource.status === 'ready' ? (
                  !resource.data?.data && (
                    <p
                      key={id}
                      role="status"
                      className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground"
                    >
                      {label}: 선택한 지역·조회 조건의 통계 자료가 없습니다.
                    </p>
                  )
                ) : (
                  <StatisticsNotice
                    key={id}
                    resource={resource}
                    label={label}
                  />
                ),
              )}
            {details.length > 0 && (
              <dl
                aria-label="세부 지표"
                className="analysis-detail-metrics grid min-w-0 gap-2"
              >
                {details.map(({ label, value, unit }) => (
                  <div
                    key={label}
                    className="min-w-0 rounded-xl border bg-card px-3 py-2 text-card-foreground"
                  >
                    <dt className="text-xs leading-5 text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="mt-1 text-base leading-6 font-semibold tabular-nums [overflow-wrap:anywhere]">
                      <StatisticValue value={value} unit={unit} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {quarter && charts.length > 0 && (
              <>
                <p className="text-xs leading-5 text-muted-foreground">
                  막대 길이는 같은 그래프 안에서 비교하세요. 지역이나 분기가
                  바뀌면 축의 상한도 달라질 수 있습니다.
                </p>
                <div className="analysis-detail-graphs grid min-w-0 gap-3 @min-[36rem]/analysis:grid-cols-2">
                  {charts.map(({ id, group }) => (
                    <StatisticBars
                      key={group.title}
                      {...group}
                      subject={
                        id === 'foot-traffic'
                          ? '길 단위 유동인구 추정 규모'
                          : '카페·음료 업종'
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        </section>
      )}
      {statistics.target && quarter && (
        <footer className="flex flex-wrap items-start justify-between gap-2 border-t pt-3">
          <DataSourceDetails sources={sources} />
          <p className="text-xs text-muted-foreground">전분기 비교 준비 중</p>
        </footer>
      )}
    </section>
  );
}
