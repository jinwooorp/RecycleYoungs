import type { MetricCode, RegionStatTarget } from './statistics';

export interface DataSource {
  provider: string;
  portal: string;
  title: string;
  url: string;
}

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

export const cafeSource: DataSource = {
  provider: '소상공인시장진흥공단',
  portal: '공공데이터포털',
  title: '소상공인시장진흥공단_상가(상권)정보_API',
  url: 'https://www.data.go.kr/data/15012005/openapi.do',
};

const publishedDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function formatPublishedDate(value: string): string | null {
  if (!/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? publishedDateFormatter.format(timestamp)
    : null;
}

export function parseReferenceMonth(value: unknown): string | null {
  return typeof value === 'string' &&
    /^(?!0000)[0-9]{4}(0[1-9]|1[0-2])$/.test(value)
    ? value
    : null;
}

export function formatReferenceMonth(value: string | null) {
  const valid = parseReferenceMonth(value);
  if (!valid) return null;
  const year = valid.slice(0, 4);
  const month = valid.slice(4);
  return {
    dateTime: `${year}-${month}`,
    label: `${year}년 ${Number(month)}월`,
  };
}
