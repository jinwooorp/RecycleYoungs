export const STATISTICS_QUARTER = '20262';
export const STATISTICS_INDUSTRY = 'CS100010';

export interface RegionStatTarget {
  kind: 'district' | 'dong';
  code: string;
}

export interface StatisticsSourceBatch {
  batchId: string;
  publishedAt: string;
}

export interface StoreStatistics {
  storeCount: string | null;
  generalStoreCount: string | null;
  franchiseStoreCount: string | null;
  openedStoreCount: string | null;
  closedStoreCount: string | null;
  openingRate: string | null;
  closureRate: string | null;
  sourceBatch: StatisticsSourceBatch;
}

export interface SalesStatistics {
  monthlySalesAmount: string | null;
  monthlySalesCount: string | null;
  weekdaySalesAmount: string | null;
  weekendSalesAmount: string | null;
  sourceBatch: StatisticsSourceBatch;
}

export interface FootTrafficStatistics {
  totalFootTraffic: string | null;
  maleFootTraffic: string | null;
  femaleFootTraffic: string | null;
  sourceBatch: StatisticsSourceBatch;
}

export interface StatisticsResponse<T> {
  districtCode?: string;
  dongCode?: string;
  quarterCode: typeof STATISTICS_QUARTER;
  industryCode?: typeof STATISTICS_INDUSTRY;
  data: T | null;
}

const storeIntegers = [
  'storeCount',
  'generalStoreCount',
  'franchiseStoreCount',
  'openedStoreCount',
  'closedStoreCount',
] as const;
const storeDecimals = ['openingRate', 'closureRate'] as const;
const salesIntegers = [
  'monthlySalesAmount',
  'monthlySalesCount',
  'weekdaySalesAmount',
  'weekendSalesAmount',
] as const;
const footDecimals = [
  'totalFootTraffic',
  'maleFootTraffic',
  'femaleFootTraffic',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new Error('통계 데이터 응답 형식을 확인할 수 없습니다.');
}

function numeric(value: unknown, decimal: boolean): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      (decimal ? /^-?\d+(?:\.\d+)?$/ : /^-?\d+$/).test(value))
  );
}

/** 원본 문자열을 변환하지 않아 큰 정수·긴 소수부·후행 0을 보존합니다. */
export function formatStatistic(value: string | null): string {
  if (value === null) return '자료 없음';
  if (!numeric(value, true)) return invalid();
  const [integer, fraction] = value.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function fetchStoreStatistics(
  target: RegionStatTarget,
  signal: AbortSignal,
): Promise<StatisticsResponse<StoreStatistics>> {
  return fetchStatistics(
    target,
    'stores',
    storeIntegers,
    storeDecimals,
    signal,
  );
}

export function fetchSalesStatistics(
  target: RegionStatTarget,
  signal: AbortSignal,
): Promise<StatisticsResponse<SalesStatistics>> {
  return fetchStatistics(target, 'sales', salesIntegers, [], signal);
}

export function fetchFootTrafficStatistics(
  target: RegionStatTarget,
  signal: AbortSignal,
): Promise<StatisticsResponse<FootTrafficStatistics>> {
  return fetchStatistics(target, 'foot-traffic', [], footDecimals, signal);
}

/** 요청 식별자·측정값·실제 통계 출처를 검증하며 유동인구에는 업종을 전달하지 않습니다. */
async function fetchStatistics<T>(
  target: RegionStatTarget,
  kind: 'stores' | 'sales' | 'foot-traffic',
  integers: readonly string[],
  decimals: readonly string[],
  signal: AbortSignal,
): Promise<StatisticsResponse<T>> {
  const district = target.kind === 'district';
  if (
    (target.kind !== 'district' && target.kind !== 'dong') ||
    !(district ? /^[0-9]{5}$/ : /^[0-9]{8}$/).test(target.code)
  )
    throw new Error('조회할 지역 코드를 확인해 주세요.');
  const footTraffic = kind === 'foot-traffic';
  const params = new URLSearchParams({ quarterCode: STATISTICS_QUARTER });
  if (!footTraffic) params.set('industryCode', STATISTICS_INDUSTRY);
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/${district ? 'districts' : 'dongs'}/${target.code}/stats/${kind}?${params}`,
      { signal },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('네트워크 연결을 확인한 뒤 다시 시도해 주세요.', {
      cause: error,
    });
  }
  if (!response.ok) {
    const problem: unknown = await response.json().catch(() => null);
    const code = record(problem) ? problem.code : null;
    throw new Error(
      response.status === 400
        ? '통계 조회 요청을 확인할 수 없습니다.'
        : response.status === 404
          ? '선택한 지역을 찾을 수 없습니다.'
          : response.status === 503 && code === 'DATA_NOT_READY'
            ? '통계 데이터가 아직 준비되지 않았습니다.'
            : response.status === 503
              ? '통계 서비스를 일시적으로 사용할 수 없습니다.'
              : '통계 정보를 불러오지 못했습니다.',
    );
  }
  const body: unknown = await response.json().catch(invalid);
  const codeField = district ? 'districtCode' : 'dongCode';
  if (
    !record(body) ||
    body[codeField] !== target.code ||
    body.quarterCode !== STATISTICS_QUARTER ||
    (footTraffic
      ? 'industryCode' in body
      : body.industryCode !== STATISTICS_INDUSTRY) ||
    !('data' in body)
  )
    return invalid();
  const identifiers: Omit<StatisticsResponse<T>, 'data'> = {
    [codeField]: target.code,
    quarterCode: STATISTICS_QUARTER,
    ...(footTraffic ? {} : { industryCode: STATISTICS_INDUSTRY }),
  };
  if (body.data === null) return { ...identifiers, data: null };
  const data = body.data;
  if (
    !record(data) ||
    !integers.every((field) => numeric(data[field], false)) ||
    !decimals.every((field) => numeric(data[field], true)) ||
    !record(data.sourceBatch) ||
    typeof data.sourceBatch.batchId !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      data.sourceBatch.batchId,
    ) ||
    typeof data.sourceBatch.publishedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      data.sourceBatch.publishedAt,
    ) ||
    !Number.isFinite(Date.parse(data.sourceBatch.publishedAt))
  )
    return invalid();
  return {
    ...identifiers,
    data: {
      ...Object.fromEntries(
        [...integers, ...decimals].map((field) => [field, data[field]]),
      ),
      sourceBatch: {
        batchId: data.sourceBatch.batchId,
        publishedAt: data.sourceBatch.publishedAt,
      },
    } as T,
  };
}
