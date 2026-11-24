import { expect, test } from 'vitest';
import {
  formatPublishedDate,
  formatReferenceMonth,
} from '@/shared/lib/data-source';
import { cafeSource } from '@/entities/cafe/cafe-source';
import { statisticsSource } from '@/entities/statistics/statistics-source';
import type {
  MetricCode,
  RegionStatTarget,
} from '@/entities/statistics/statistics';

test.each([
  ['district', 'stores', 'OA-22173', '점포-자치구'],
  ['dong', 'stores', 'OA-22172', '점포-행정동'],
  ['district', 'sales', 'OA-22176', '추정매출-자치구'],
  ['dong', 'sales', 'OA-22175', '추정매출-행정동'],
  ['district', 'foot-traffic', 'OA-22179', '길단위인구-자치구'],
  ['dong', 'foot-traffic', 'OA-22178', '길단위인구-행정동'],
] satisfies [RegionStatTarget['kind'], MetricCode, string, string][])(
  '%s %s를 해당 공식 자료에 연결한다',
  (level, metric, id, dataset) => {
    expect(statisticsSource(level, metric)).toEqual({
      provider: '서울신용보증재단',
      portal: '서울 열린데이터광장',
      title: `서울시 상권분석서비스(${dataset})`,
      url: `https://data.seoul.go.kr/dataList/${id}/S/1/datasetView.do`,
    });
  },
);

test('카페 제공기관과 공식 자료 링크는 통계 출처와 별도로 갖는다', () => {
  expect(cafeSource.provider).toBe('소상공인시장진흥공단');
  expect(cafeSource.url).toBe(
    'https://www.data.go.kr/data/15012005/openapi.do',
  );
});

test('게시 시각은 한국 날짜 경계를 적용하고 시차 없는 값을 추정하지 않는다', () => {
  expect(formatPublishedDate('2026-11-16T14:59:59Z')).toBe('2026년 11월 16일');
  expect(formatPublishedDate('2026-11-16T15:00:00Z')).toBe('2026년 11월 17일');
  expect(formatPublishedDate('2026-11-16T10:00:00-05:00')).toBe(
    '2026년 11월 17일',
  );
  expect(formatPublishedDate('2026-11-16T15:00:00')).toBeNull();
  expect(formatPublishedDate('invalid')).toBeNull();
});

test('기준년월은 해당 월만 표시하며 결측이나 잘못된 월은 표시용 날짜가 없다', () => {
  expect(formatReferenceMonth('202610')).toEqual({
    dateTime: '2026-10',
    label: '2026년 10월',
  });
  for (const month of [null, '000010', '202600', '202613'])
    expect(formatReferenceMonth(month)).toBeNull();
});
