import type { DataSource } from '@/shared/lib/data-source';
import type {
  MetricCode,
  RegionStatTarget,
} from '@/entities/statistics/statistics';

const statisticsDatasets = {
  district: {
    stores: ['OA-22173', '점포-자치구'],
    sales: ['OA-22176', '추정매출-자치구'],
    'foot-traffic': ['OA-22179', '길단위인구-자치구'],
  },
  dong: {
    stores: ['OA-22172', '점포-행정동'],
    sales: ['OA-22175', '추정매출-행정동'],
    'foot-traffic': ['OA-22178', '길단위인구-행정동'],
  },
} as const satisfies Record<
  RegionStatTarget['kind'],
  Record<MetricCode, readonly [string, string]>
>;

export function statisticsSource(
  level: RegionStatTarget['kind'],
  metric: MetricCode,
): DataSource {
  const [id, name] = statisticsDatasets[level][metric];
  return {
    provider: '서울신용보증재단',
    portal: '서울 열린데이터광장',
    title: `서울시 상권분석서비스(${name})`,
    url: `https://data.seoul.go.kr/dataList/${id}/S/1/datasetView.do`,
  };
}
