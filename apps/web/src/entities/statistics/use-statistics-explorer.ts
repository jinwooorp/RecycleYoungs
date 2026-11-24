import { useCallback, useMemo } from 'react';
import {
  fetchStoreStatistics,
  fetchSalesStatistics,
  fetchFootTrafficStatistics,
  type RegionStatTarget,
} from './statistics';
import { useRequest } from '@/shared/hooks/use-request';

/** 세 통계를 독립적으로 조회하고 숨겨진 패널·이전 지역의 요청을 정리합니다. */
export function useStatisticsExplorer(
  districtCode: string,
  dongCode: string,
  active: boolean,
  quarter: string | null,
) {
  const code = dongCode || districtCode;
  const kind = dongCode ? 'dong' : 'district';
  const target = useMemo<RegionStatTarget | null>(
    () => (code ? { kind, code } : null),
    [kind, code],
  );
  const key =
    active && target && quarter
      ? `${target.kind}:${target.code}:${quarter}`
      : null;
  const stores = useRequest(
    key ? `${key}:stores` : null,
    useCallback(
      (signal) => fetchStoreStatistics(target!, signal, quarter!),
      [target, quarter],
    ),
  );
  const sales = useRequest(
    key ? `${key}:sales` : null,
    useCallback(
      (signal) => fetchSalesStatistics(target!, signal, quarter!),
      [target, quarter],
    ),
  );
  const footTraffic = useRequest(
    key ? `${key}:foot-traffic` : null,
    useCallback(
      (signal) => fetchFootTrafficStatistics(target!, signal, quarter!),
      [target, quarter],
    ),
  );
  return { target, stores, sales, footTraffic };
}
