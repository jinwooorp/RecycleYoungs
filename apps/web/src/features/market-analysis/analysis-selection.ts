import { metricCodes, type MetricCode } from '@/entities/statistics/statistics';

export type AnalysisSelection = MetricCode | 'all';

export function selectAnalysisMetric(
  selected: readonly MetricCode[],
  metric: AnalysisSelection,
): readonly MetricCode[] {
  if (metric === 'all') return metricCodes;
  if (selected.length === metricCodes.length) return [metric];
  if (!selected.includes(metric)) return [...selected, metric];
  if (selected.length === 1) return selected;
  return selected.filter((item) => item !== metric);
}
