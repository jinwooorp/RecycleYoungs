import { useCallback, useState } from 'react';
import { fetchStatisticsQuarters } from '@/entities/statistics/statistics';
import { useRequest } from '@/shared/hooks/use-request';

export function useStatisticsQuarters() {
  const [preferredQuarter, selectQuarter] = useState<string | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    const catalog = await fetchStatisticsQuarters(signal);
    if (!signal.aborted)
      selectQuarter((current) => current ?? catalog.defaultQuarterCode);
    return catalog;
  }, []);
  const resource = useRequest('statistics-quarters', load);
  const options = resource.data?.quarters ?? [];
  const selected =
    preferredQuarter &&
    options.some(({ quarterCode }) => quarterCode === preferredQuarter)
      ? preferredQuarter
      : null;
  const selectionUnavailable =
    resource.status === 'ready' &&
    preferredQuarter !== null &&
    selected === null;
  return {
    ...resource,
    options,
    selected,
    selectionUnavailable,
    selectQuarter,
  };
}
