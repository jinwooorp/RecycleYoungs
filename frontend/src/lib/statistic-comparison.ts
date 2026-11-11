import {
  STATISTICS_QUARTER,
  PREVIOUS_STATISTICS_QUARTER,
  STATISTICS_INDUSTRY,
  type RegionStatTarget,
  type StatisticsResponse,
  type StoreStatistics,
  type SalesStatistics,
  type FootTrafficStatistics,
} from './statistics';

export type ComparisonMetric = 'stores' | 'sales' | 'footTraffic';
export interface ComparisonPolicy {
  status: 'verified' | 'unverified';
  reason: string;
}

/** 공개 근거는 docs/archive/quarter-comparison-verification.md에서 관리합니다. 존재 여부만으로 승인하지 않습니다. */
export const STATISTICS_COMPARABILITY: Record<
  ComparisonMetric,
  ComparisonPolicy
> = {
  stores: {
    status: 'unverified',
    reason: '두 분기의 지역 경계·코드 적용 기준을 확인하지 못했습니다.',
  },
  sales: {
    status: 'unverified',
    reason: '당월 추정매출액의 두 분기 기간·보정 기준이 확인되지 않았습니다.',
  },
  footTraffic: {
    status: 'unverified',
    reason: '유동인구의 두 분기 공간·시간 집계 기준이 확인되지 않았습니다.',
  },
};

export type StatisticChange =
  | { status: 'unavailable'; reason: string }
  | {
      status: 'available';
      direction: 'increase' | 'decrease' | 'unchanged';
      delta: string;
      rate: string | null;
    };

const unavailable = (reason: string): StatisticChange => ({
  status: 'unavailable',
  reason,
});

/** 원본은 수정하지 않고 정수와 소수 자릿수로 분리해 연산합니다. */
function decimal(value: string) {
  const [integer, fraction = ''] = value.split('.');
  return { integer: BigInt(integer + fraction), scale: fraction.length };
}

function scaledString(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
}

/** 증감량은 원본 자릿수를 유지하고 증감률만 소수 첫째 자리까지 반올림합니다. */
export function calculateStatisticChange(
  current: string | null,
  previous: string | null,
): StatisticChange {
  if (current === null || previous === null)
    return unavailable('한 분기의 측정값이 없습니다.');
  if (![current, previous].every((value) => /^\d+(?:\.\d+)?$/.test(value)))
    return unavailable('비교할 측정값의 형식을 확인할 수 없습니다.');
  const a = decimal(current);
  const b = decimal(previous);
  const scale = Math.max(a.scale, b.scale);
  const now = a.integer * 10n ** BigInt(scale - a.scale);
  const before = b.integer * 10n ** BigInt(scale - b.scale);
  const difference = now - before;
  const absolute = difference < 0n ? -difference : difference;
  // 증감률(%)의 소수 첫째 자리까지 정수로 계산하며 정확히 절반이면 0에서 먼 쪽으로 반올림합니다.
  const rounded =
    before === 0n ? 0n : (absolute * 1000n * 2n + before) / (before * 2n);
  return {
    status: 'available',
    direction:
      difference > 0n ? 'increase' : difference < 0n ? 'decrease' : 'unchanged',
    delta: scaledString(difference, scale),
    rate:
      before === 0n
        ? now === 0n
          ? '0.0'
          : null
        : scaledString(difference < 0n ? -rounded : rounded, 1),
  };
}

type MetricData = StoreStatistics | SalesStatistics | FootTrafficStatistics;

/** 공개 정책과 두 응답의 식별자를 확인한 경우에만 계산합니다. */
export function compareStatistic(
  metric: ComparisonMetric,
  target: RegionStatTarget,
  current: StatisticsResponse<MetricData> | null,
  previous: StatisticsResponse<MetricData> | null,
  policy: ComparisonPolicy = STATISTICS_COMPARABILITY[metric],
): StatisticChange {
  if (!current || !previous || !current.data || !previous.data)
    return unavailable('한 분기의 통계 자료가 없습니다.');
  const codeField = target.kind === 'district' ? 'districtCode' : 'dongCode';
  const otherField = target.kind === 'district' ? 'dongCode' : 'districtCode';
  if (
    current.quarterCode !== STATISTICS_QUARTER ||
    previous.quarterCode !== PREVIOUS_STATISTICS_QUARTER ||
    ![current, previous].every(
      (sample) =>
        sample[codeField] === target.code &&
        sample[otherField] === undefined &&
        (metric === 'footTraffic'
          ? sample.industryCode === undefined
          : sample.industryCode === STATISTICS_INDUSTRY),
    )
  )
    return unavailable('비교 대상의 지역·분기·업종·집계 단위가 다릅니다.');
  if (policy.status !== 'verified') return unavailable(policy.reason);
  const field = {
    stores: 'storeCount',
    sales: 'monthlySalesAmount',
    footTraffic: 'totalFootTraffic',
  }[metric];
  const value = (data: MetricData): string | null => {
    const raw = (data as unknown as Record<string, unknown>)[field];
    return typeof raw === 'string' ? raw : null;
  };
  return calculateStatisticChange(value(current.data), value(previous.data));
}
