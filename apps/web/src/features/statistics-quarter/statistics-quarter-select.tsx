import { RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { NativeSelect } from '@/shared/ui/native-select';
import type { useStatisticsQuarters } from './use-statistics-quarters';
import {
  formatQuarter,
  metricCodes,
  type MetricCode,
} from '@/entities/statistics/statistics';

const metricLabels: Record<MetricCode, string> = {
  stores: '점포',
  sales: '추정매출',
  'foot-traffic': '유동인구',
};

function coverage(metrics: MetricCode[]) {
  const missing = metricCodes.filter((code) => !metrics.includes(code));
  return missing.length
    ? `${missing.map((code) => metricLabels[code]).join('·')} 미게시`
    : '세 지표 게시';
}

export function StatisticsQuarterSelect({
  catalog,
}: {
  catalog: ReturnType<typeof useStatisticsQuarters>;
}) {
  const loading = catalog.status === 'loading' || catalog.status === 'idle';
  const selected = catalog.options.find(
    ({ quarterCode }) => quarterCode === catalog.selected,
  );
  const partial =
    selected &&
    (selected.districtMetrics.length < metricCodes.length ||
      selected.dongMetrics.length < metricCodes.length);
  return (
    <div className="w-full min-w-0 space-y-1 text-sm sm:w-auto">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
        <label
          htmlFor="statistics-quarter"
          className="shrink-0 text-xs font-medium"
        >
          통계 기준 분기
        </label>
        <NativeSelect
          id="statistics-quarter"
          aria-describedby={partial ? 'statistics-quarter-coverage' : undefined}
          value={catalog.selected ?? ''}
          disabled={!catalog.options.length}
          onChange={(event) => catalog.selectQuarter(event.target.value)}
          className="h-11"
          containerClassName="w-full max-w-44 min-w-0 sm:w-44"
        >
          {!catalog.selected && (
            <option value="" disabled>
              분기 선택
            </option>
          )}
          {catalog.options.map(
            ({ quarterCode, districtMetrics, dongMetrics }) => (
              <option key={quarterCode} value={quarterCode}>
                {formatQuarter(quarterCode)}
                {(districtMetrics.length < metricCodes.length ||
                  dongMetrics.length < metricCodes.length) &&
                  ' · 일부 지표'}
              </option>
            ),
          )}
        </NativeSelect>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={
            catalog.status === 'error'
              ? '분기 목록 다시 시도'
              : '분기 목록 새로고침'
          }
          aria-disabled={loading}
          onClick={() => {
            if (!loading) catalog.retry();
          }}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      {partial && (
        <div
          id="statistics-quarter-coverage"
          className="space-y-1 text-xs leading-5 text-muted-foreground"
        >
          <p>서울 전체 게시 현황</p>
          <ul>
            <li>자치구 · {coverage(selected.districtMetrics)}</li>
            <li>행정동 · {coverage(selected.dongMetrics)}</li>
          </ul>
          <p>선택한 지역의 자료 유무는 조회 결과에서 확인할 수 있습니다.</p>
        </div>
      )}
      {loading && <p role="status">통계 분기 목록 불러오는 중…</p>}
      {catalog.status === 'error' && <p role="alert">{catalog.error}</p>}
      {catalog.status === 'ready' && !catalog.options.length && (
        <p role="status">조회 가능한 통계 분기가 없습니다.</p>
      )}
      {catalog.selectionUnavailable && catalog.options.length > 0 && (
        <p role="status">
          선택한 분기를 조회할 수 없습니다. 다른 분기를 선택해 주세요.
        </p>
      )}
    </div>
  );
}
