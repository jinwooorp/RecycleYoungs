import { useCallback, useMemo } from 'react';
import {
  fetchStoreStatistics,
  fetchSalesStatistics,
  fetchFootTrafficStatistics,
  STATISTICS_QUARTER,
  type RegionStatTarget,
} from '@/lib/statistics';
import { useRegionRequest } from './use-region-explorer';

/** 세 통계를 독립적으로 조회하고 숨겨진 패널·이전 지역의 요청을 정리합니다. */
export function useStatisticsExplorer(
  districtCode: string,
  dongCode: string,
  active: boolean,
  quarter: string = STATISTICS_QUARTER,
) {
  const code = dongCode || districtCode;
  const kind = dongCode ? 'dong' : 'district';
  const target = useMemo<RegionStatTarget | null>(
    () => (code ? { kind, code } : null),
    [kind, code],
  );
  const key =
    active && target ? `${target.kind}:${target.code}:${quarter}` : null;
  const stores = useRegionRequest(
    key ? `${key}:stores` : null,
    useCallback(
      (signal) => fetchStoreStatistics(target!, signal, quarter),
      [target, quarter],
    ),
  );
  const sales = useRegionRequest(
    key ? `${key}:sales` : null,
    useCallback(
      (signal) => fetchSalesStatistics(target!, signal, quarter),
      [target, quarter],
    ),
  );
  const footTraffic = useRegionRequest(
    key ? `${key}:foot-traffic` : null,
    useCallback(
      (signal) => fetchFootTrafficStatistics(target!, signal, quarter),
      [target, quarter],
    ),
  );
  return { target, stores, sales, footTraffic };
}
