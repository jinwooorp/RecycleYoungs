import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '@/shared/ui/button';
import { NativeSelect } from '@/shared/ui/native-select';
import { CandidateComparison } from './candidate-comparison';
import type { RequestResource } from '@/shared/hooks/use-request';
import type { Candidates } from './use-candidates';
import {
  useCandidateAnalysis,
  type CandidateAnalysis,
} from './use-candidate-analysis';
import {
  candidateNameLimit,
  candidateNoteLimit,
  type Candidate,
  type CandidateSlot,
} from '@/entities/candidate/candidates';
import { cafeAddress, formatCafeDistance } from '@/entities/cafe/cafes';
import {
  formatQuarter,
  formatStatistic,
  type StatisticsResponse,
  type StatisticsSourceBatch,
} from '@/entities/statistics/statistics';
import { formatReferenceMonth } from '@/shared/lib/data-source';
import { CafeProvenance } from '@/entities/cafe/cafe-provenance';
import { cafeSource } from '@/entities/cafe/cafe-source';
import { statisticsSource } from '@/entities/statistics/statistics-source';
import {
  DataSourceDetails,
  PublishedDate,
} from '@/shared/components/data-provenance';

function Result<T>({
  resource,
  label,
  children,
}: {
  resource: RequestResource<T>;
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

function CandidateRegion({ analysis }: { analysis: CandidateAnalysis }) {
  return (
    <div className="min-w-0 text-xs leading-5">
      <Result
        resource={analysis.regions}
        label={`${analysis.item.slot} 소속 지역`}
      >
        {({ districts, dongs }) =>
          districts.length ? (
            <p>
              {districts.map((area) => area.districtName).join(' · ')} ·{' '}
              {dongs.length
                ? dongs.map((area) => area.dongName).join(' · ')
                : '소속 행정동 없음'}
            </p>
          ) : (
            '서울 경계 밖'
          )
        }
      </Result>
    </div>
  );
}

function CafeDate({
  analysis,
  kind,
}: {
  analysis: CandidateAnalysis;
  kind: 'reference' | 'published';
}) {
  const page = analysis.cafes.status === 'ready' ? analysis.cafes.data : null;
  if (!page) return <span aria-label="게시 정보 없음">—</span>;
  if (kind === 'published')
    return (
      <PublishedDate
        publishedAt={page.sourceBatch.publishedAt}
        showLabel={false}
      />
    );
  const month = formatReferenceMonth(page.sourceBatch.referenceMonth);
  return month ? (
    <time dateTime={month.dateTime}>{month.label}</time>
  ) : (
    '확인 불가'
  );
}

function Competition({
  analysis,
  radius,
  detailsOnly = false,
}: {
  analysis: CandidateAnalysis;
  radius: Candidates['radius'];
  detailsOnly?: boolean;
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
      {!detailsOnly && <CafeCount analysis={analysis} />}
      {!!analysis.regions.data?.districts.length &&
        analysis.cafes.status === 'ready' && (
          <Result
            resource={analysis.cafes}
            label={`${analysis.item.slot} 경쟁 카페 목록`}
          >
            {(page) => (
              <>
                {detailsOnly ? (
                  <DataSourceDetails sources={[cafeSource]} />
                ) : (
                  <CafeProvenance sourceBatch={page.sourceBatch} />
                )}
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
              </>
            )}
          </Result>
        )}
    </section>
  );
}

const metricLabels = [
  '카페 업종 점포 수',
  '당월 추정매출액',
  '지역 전체 유동인구',
] as const;

function getDongMetrics(statistics: CandidateAnalysis['statistics']) {
  if (!statistics) return null;
  return [
    {
      id: 'stores',
      retry: '점포',
      resource: statistics.stores,
      value: statistics.stores.data?.data?.storeCount ?? null,
      unit: '개',
    },
    {
      id: 'sales',
      retry: '추정매출',
      resource: statistics.sales,
      value: statistics.sales.data?.data?.monthlySalesAmount ?? null,
      unit: '원',
    },
    {
      id: 'foot-traffic',
      retry: '유동인구',
      resource: statistics.footTraffic,
      value: statistics.footTraffic.data?.data?.totalFootTraffic ?? null,
      unit: '명',
    },
  ] as const;
}

type DongMetric = NonNullable<ReturnType<typeof getDongMetrics>>[number];

function MetricValue({
  metric,
  slot,
}: {
  metric: DongMetric;
  slot: CandidateSlot;
}) {
  return (
    <Result<StatisticsResponse<{ sourceBatch: StatisticsSourceBatch }>>
      resource={metric.resource}
      label={`${slot} ${metric.retry}`}
    >
      {({ data }) =>
        data ? (
          <>
            <p className="font-semibold tabular-nums">
              {formatStatistic(metric.value, { trimTrailingZeros: true })}
              {metric.value === null ? '' : metric.unit}
            </p>
            <PublishedDate publishedAt={data.sourceBatch.publishedAt} />
          </>
        ) : (
          '선택한 지역·분기의 자료 없음'
        )
      }
    </Result>
  );
}

function DongMetrics({
  analysis,
  metrics,
  quarter,
  detailsOnly = false,
}: {
  analysis: CandidateAnalysis;
  metrics: ReturnType<typeof getDongMetrics>;
  quarter: string;
  detailsOnly?: boolean;
}) {
  const { statistics, dong, item, unavailable } = analysis;
  const stores = statistics?.stores.data?.data;
  const sources =
    metrics?.flatMap(({ id, resource }) =>
      resource.status === 'ready' && resource.data?.data
        ? [statisticsSource('dong', id)]
        : [],
    ) ?? [];
  return (
    <section
      aria-label={`후보지 ${item.slot} 행정동 통계`}
      className="min-w-0 space-y-3 rounded-xl border p-4 text-sm [overflow-wrap:anywhere]"
    >
      <h4 className="font-semibold">
        {item.slot} · {item.name}
      </h4>
      {dong && metrics ? (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            {dong.dongName} 전체 · {formatQuarter(quarter)}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            점포·매출은 카페·음료 업종 · 유동인구는 지역 전체
          </p>
          {!detailsOnly && (
            <dl className="min-w-0 divide-y">
              {metrics.map((metric, index) => (
                <div key={metric.id} className="min-w-0 space-y-2 py-3">
                  <dt className="text-xs text-muted-foreground">
                    {metricLabels[index]}
                  </dt>
                  <dd className="min-w-0 leading-6">
                    <MetricValue metric={metric} slot={item.slot} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {stores && (
            <p className="text-xs text-muted-foreground">
              개업 {formatStatistic(stores.openedStoreCount)} · 폐업{' '}
              {formatStatistic(stores.closedStoreCount)}
            </p>
          )}
          <DataSourceDetails sources={sources} />
        </>
      ) : (
        <p className="text-muted-foreground">{unavailable}</p>
      )}
    </section>
  );
}

export function CandidatePanel({
  candidates,
  active,
  quarter,
  quarterControl,
  mapReady,
  onSelect,
  onStartPicking,
}: {
  candidates: Candidates;
  active: boolean;
  quarter: string | null;
  quarterControl?: ReactNode;
  mapReady: boolean;
  onSelect: (item: Candidate) => void;
  onStartPicking?: () => void;
}) {
  const { items, picking, pending, notice, radius } = candidates;
  const analyses = useCandidateAnalysis(items, radius, active, quarter);
  const reports = analyses.map((analysis) => ({
    analysis,
    metrics: getDongMetrics(analysis.statistics),
  }));
  const columns = analyses.map(({ item }) => item);
  const comparing = items.length > 1;
  const radiusLabel = radius === 500 ? '500m' : '1km';
  const detailsId = useId();
  const detailsRefs = useRef<
    Partial<Record<CandidateSlot, HTMLDetailsElement | null>>
  >({});
  const managementRefs = useRef<
    Partial<Record<CandidateSlot, HTMLButtonElement | null>>
  >({});
  const selectionRefs = useRef<
    Partial<Record<CandidateSlot, HTMLButtonElement | null>>
  >({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const afterRemoval = useRef<CandidateSlot | 'heading' | null>(null);
  const previousSelection = useRef(candidates.selected);
  useEffect(() => {
    const target = afterRemoval.current;
    if (!target) return;
    (target === 'heading'
      ? headingRef.current
      : managementRefs.current[target]
    )?.focus();
    afterRemoval.current = null;
  }, [items]);
  useEffect(() => {
    const changed = previousSelection.current !== candidates.selected;
    previousSelection.current = candidates.selected;
    if (active && changed && candidates.selected)
      selectionRefs.current[candidates.selected]?.scrollIntoView?.({
        block: 'nearest',
      });
  }, [active, candidates.selected]);
  function showDetails(slot: CandidateSlot) {
    const details = detailsRefs.current[slot];
    if (!details) return;
    details.open = true;
    details.querySelector('summary')?.focus();
  }

  function candidateManagement(item: Candidate) {
    const draft = candidates.drafts[item.slot];
    const note =
      draft?.note ??
      candidates.records.find(({ slot }) => slot === item.slot)?.note ??
      '';
    const noteId = `${detailsId}-${item.slot}-note`;
    const result = candidates.noteResults[item.slot];
    return (
      <>
        <details className="text-xs leading-5 text-muted-foreground">
          <summary className="cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
            위치 좌표
          </summary>
          <p>
            경도 {item.longitude.toFixed(6)} · 위도 {item.latitude.toFixed(6)}
          </p>
        </details>
        <form
          className="flex min-w-0 flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            candidates.rename(item, draft?.name ?? item.name);
          }}
        >
          <input
            name="name"
            aria-label={`후보지 ${item.slot} 이름`}
            value={draft?.name ?? item.name}
            onChange={(event) =>
              candidates.edit(item, 'name', event.target.value)
            }
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
              const rest = items.filter((other) => other.slot !== item.slot);
              afterRemoval.current =
                rest[index]?.slot ?? rest.at(-1)?.slot ?? 'heading';
              candidates.remove(item.slot);
            }}
          >
            삭제
          </Button>
        </form>
        <form
          className="min-w-0 space-y-2 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            candidates.saveNote(item, note);
          }}
        >
          <label htmlFor={noteId} className="block font-medium">
            후보지 {item.slot} 메모
          </label>
          <textarea
            id={noteId}
            rows={3}
            maxLength={candidateNoteLimit}
            aria-describedby={`${noteId}-length`}
            value={note}
            onChange={(event) =>
              candidates.edit(
                item,
                'note',
                event.target.value.slice(0, candidateNoteLimit),
              )
            }
            className="block w-full min-w-0 resize-y rounded-md border border-input bg-background p-2 text-base outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              id={`${noteId}-length`}
              className="text-xs text-muted-foreground"
            >
              {note.length} / {candidateNoteLimit}자 · 비워서 저장하면
              삭제됩니다.
            </p>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              aria-label={`후보지 ${item.slot} 메모 저장`}
            >
              메모 저장
            </Button>
          </div>
          {result && (
            <p role="status" className="text-xs">
              {result === 'saved'
                ? `후보지 ${item.slot} 메모를 저장했습니다.`
                : `후보지 ${item.slot} 메모를 지속 저장하지 못했습니다. 이 화면에 내용을 유지합니다.`}
            </p>
          )}
        </form>
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 break-keep text-pretty sm:p-5">
      <header className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
          <Button
            variant="outline"
            size="sm"
            aria-pressed={picking}
            disabled={!mapReady || pending || items.length >= 3}
            onClick={() => {
              if (!picking) onStartPicking?.();
              candidates.setPicking(!picking);
            }}
          >
            {picking ? '지도 추가 모드 끄기' : '지도에서 후보지 추가'}
          </Button>
        </div>
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium">
          공통 탐색 반경
          <NativeSelect
            value={radius}
            onChange={(event) =>
              candidates.setRadius(event.target.value === '1000' ? 1000 : 500)
            }
            className="h-9"
            containerClassName="w-24 max-w-full"
          >
            <option value="500">500m</option>
            <option value="1000">1km</option>
          </NativeSelect>
        </label>
        {quarterControl}
      </header>
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
      {candidates.storageIssue && (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p role="alert">
            {
              {
                'read-failed':
                  '이 브라우저의 후보지 저장소를 읽을 수 없습니다.',
                'write-failed':
                  '후보지 변경 사항을 브라우저에 저장하지 못했습니다.',
                invalid:
                  '저장된 후보지 데이터가 손상되었습니다. 기존 저장본을 보존합니다.',
                unsupported:
                  '저장된 후보지 데이터 버전을 지원하지 않습니다. 기존 저장본을 보존합니다.',
                conflict:
                  '다른 탭의 저장본이 변경되었습니다. 이 탭의 편집 내용을 유지하며 자동으로 덮어쓰지 않습니다.',
              }[candidates.storageIssue]
            }
          </p>
          <p className="text-xs text-muted-foreground">
            저장하지 못한 변경은 현재 화면에 남아 있으며 다시 열면 사라질 수
            있습니다.
          </p>
          {candidates.storageIssue === 'conflict' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                headingRef.current?.focus();
                candidates.loadLatest();
              }}
            >
              이 탭 변경을 버리고 최신 목록 불러오기
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={candidates.retryStorage}
            >
              저장소 다시 확인
            </Button>
          )}
        </div>
      )}
      {!items.length ? (
        <p className="rounded-xl bg-accent p-3 text-sm leading-5">
          등록된 후보지가 없습니다. 지도 또는 장소 검색에서 추가하세요.
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <div data-candidate-management className="min-w-0 space-y-3">
            <section aria-label="후보지 요약" className="min-w-0 space-y-3">
              <h3 className="text-sm font-semibold">후보지 요약</h3>
              <div className="grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
                {analyses.map((analysis) => {
                  const { item } = analysis;
                  const selected = candidates.selected === item.slot;
                  const savedNote = candidates.records.find(
                    ({ slot }) => slot === item.slot,
                  )?.note;
                  return (
                    <section
                      key={item.slot}
                      aria-label={`후보지 ${item.slot} 요약`}
                      data-selected={selected}
                      className="flex min-w-0 flex-col gap-2 rounded-xl border p-3 [overflow-wrap:anywhere] data-[selected=true]:border-primary data-[selected=true]:bg-primary/5"
                    >
                      <h4 className="text-sm font-semibold">
                        {item.slot} · {item.name}
                      </h4>
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <CandidateRegion analysis={analysis} />
                        {selected && (
                          <span className="text-xs font-medium text-primary">
                            지도 선택됨
                          </span>
                        )}
                      </div>
                      <div className="mt-auto flex min-w-0 flex-wrap gap-2">
                        <Button
                          ref={(node) => {
                            selectionRefs.current[item.slot] = node;
                          }}
                          size="sm"
                          variant="outline"
                          aria-label={`후보지 ${item.slot} 지도에서 위치 확인`}
                          aria-pressed={selected}
                          disabled={!mapReady}
                          onClick={() => onSelect(item)}
                        >
                          지도에서 확인
                        </Button>
                        <Button
                          ref={(node) => {
                            managementRefs.current[item.slot] = node;
                          }}
                          size="sm"
                          variant="outline"
                          aria-label={`후보지 ${item.slot} 상세 및 관리 열기`}
                          aria-controls={`${detailsId}-${item.slot}`}
                          onClick={() => showDetails(item.slot)}
                        >
                          상세 및 관리
                        </Button>
                      </div>
                      {!comparing && savedNote && (
                        <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                          {savedNote}
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            </section>
          </div>
          <div data-candidate-results className="min-w-0 space-y-4">
            {comparing ? (
              <>
                <CandidateComparison
                  title="주변 경쟁 환경"
                  scope={`각 후보지 중심 ${radiusLabel} 반경 · 통계 분기와 별도로 최신 적격 카페 게시본에서 조회합니다.`}
                  candidates={columns}
                  selected={candidates.selected}
                  rows={[
                    {
                      label: '전체 경쟁 카페',
                      cells: analyses.map((analysis) => (
                        <CafeCount analysis={analysis} />
                      )),
                    },
                    {
                      label: '카페 원천 기준년월',
                      cells: analyses.map((analysis) => (
                        <CafeDate analysis={analysis} kind="reference" />
                      )),
                    },
                    {
                      label: '서비스 DB 게시일',
                      cells: analyses.map((analysis) => (
                        <CafeDate analysis={analysis} kind="published" />
                      )),
                    },
                  ]}
                />
                {quarter && (
                  <CandidateComparison
                    title="소속 행정동 전체 통계"
                    scope={`${formatQuarter(quarter)} · 점포·매출은 카페·음료 업종 · 유동인구는 지역 전체 · 같은 행정동은 같은 통계를 사용합니다.`}
                    candidates={columns}
                    selected={candidates.selected}
                    rows={metricLabels.map((label, index) => ({
                      label,
                      cells: reports.map(({ analysis, metrics }) => {
                        const metric = metrics?.[index];
                        return metric ? (
                          <MetricValue
                            metric={metric}
                            slot={analysis.item.slot}
                          />
                        ) : (
                          analysis.unavailable
                        );
                      }),
                    }))}
                  />
                )}
              </>
            ) : (
              <>
                <section
                  aria-label="주변 경쟁 환경"
                  className="min-w-0 space-y-3 border-t pt-4"
                >
                  <h3 className="text-sm font-semibold">주변 경쟁 환경</h3>
                  <p className="text-xs leading-5 text-muted-foreground">
                    경쟁 카페는 통계 분기 선택과 별도로 최신 적격 카페
                    게시본에서 조회합니다.
                  </p>
                  {analyses.map((analysis) => (
                    <Competition
                      key={analysis.item.slot}
                      analysis={analysis}
                      radius={radius}
                    />
                  ))}
                </section>
                {quarter && (
                  <section
                    aria-label="소속 행정동 상권 특성"
                    className="min-w-0 space-y-3 border-t pt-4"
                  >
                    <h3 className="text-sm font-semibold">
                      소속 행정동 상권 특성
                    </h3>
                    {reports.map(({ analysis, metrics }) => (
                      <DongMetrics
                        key={analysis.item.slot}
                        analysis={analysis}
                        metrics={metrics}
                        quarter={quarter}
                      />
                    ))}
                  </section>
                )}
              </>
            )}
          </div>
          <section
            aria-label="후보지 상세 및 관리"
            className="min-w-0 space-y-2"
          >
            <h3 className="text-sm font-semibold">후보지 상세 및 관리</h3>
            {reports.map(({ analysis, metrics }) => {
              const { item } = analysis;
              return (
                <details
                  key={item.slot}
                  id={`${detailsId}-${item.slot}`}
                  ref={(node) => {
                    detailsRefs.current[item.slot] = node;
                  }}
                  className="min-w-0 rounded-xl border p-3 [overflow-wrap:anywhere]"
                >
                  <summary className="cursor-pointer rounded text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
                    {item.slot} · {item.name} 상세 및 관리
                  </summary>
                  <div className="mt-3 space-y-3">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`후보지 ${item.slot} 상세에서 지도 확인`}
                      aria-pressed={candidates.selected === item.slot}
                      disabled={!mapReady}
                      onClick={() => onSelect(item)}
                    >
                      지도에서 확인
                    </Button>
                    <CandidateRegion analysis={analysis} />
                    {candidateManagement(item)}
                    {comparing && (
                      <Competition
                        analysis={analysis}
                        radius={radius}
                        detailsOnly
                      />
                    )}
                    {comparing && quarter && (
                      <DongMetrics
                        analysis={analysis}
                        metrics={metrics}
                        quarter={quarter}
                        detailsOnly
                      />
                    )}
                  </div>
                </details>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
