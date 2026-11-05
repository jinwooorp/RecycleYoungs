import { expect, test } from 'vitest';
import {
  calculateStatisticChange,
  compareStatistic,
  STATISTICS_COMPARABILITY,
  type ComparisonMetric,
} from './statistic-comparison';
import type { StatisticsResponse, StoreStatistics } from './statistics';

test.each([
  ['110', '100', 'increase', '10', '10.0'],
  ['90', '100', 'decrease', '-10', '-10.0'],
  ['100.00', '100.0', 'unchanged', '0.00', '0.0'],
  ['0', '0', 'unchanged', '0', '0.0'],
  ['1', '0', 'increase', '1', null],
  ['0', '10', 'decrease', '-10', '-100.0'],
  ['9007199254740994', '9007199254740993', 'increase', '1', '0.0'],
  [
    '1.00000000000000000000100',
    '1.00000000000000000000000',
    'increase',
    '0.00000000000000000000100',
    '0.0',
  ],
  ['201', '200', 'increase', '1', '0.5'],
  ['2001', '2000', 'increase', '1', '0.1'],
  ['1999', '2000', 'decrease', '-1', '-0.1'],
  ['20009', '20000', 'increase', '9', '0.0'],
  [
    '999999999999999999999',
    '1',
    'increase',
    '999999999999999999998',
    '99999999999999999999800.0',
  ],
])(
  '정확한 문자열 연산 %s / %s',
  (current, previous, direction, delta, rate) => {
    expect(calculateStatisticChange(current, previous)).toEqual({
      status: 'available',
      direction,
      delta,
      rate,
    });
  },
);

test.each([
  [null, '0'],
  ['0', null],
  [null, null],
  ['NaN', '1'],
  ['1e3', '1'],
])('NULL·잘못된 값은 비교하지 않는다 %s / %s', (current, previous) => {
  expect(calculateStatisticChange(current, previous).status).toBe(
    'unavailable',
  );
});

const target = { kind: 'district', code: '11440' } as const;
const current: StatisticsResponse<StoreStatistics> = {
  districtCode: '11440',
  quarterCode: '20262',
  industryCode: 'CS100010',
  data: {
    storeCount: '2306',
    generalStoreCount: null,
    franchiseStoreCount: null,
    openedStoreCount: null,
    closedStoreCount: null,
    openingRate: null,
    closureRate: null,
    sourceBatch: {
      batchId: '00000000-0000-0000-0000-000000000001',
      publishedAt: '2026-10-31T09:50:24Z',
    },
  },
};
const previous = {
  ...current,
  quarterCode: '20261',
  data: { ...current.data!, storeCount: '2320' },
};
const verifiedFixture = {
  status: 'verified',
  reason: '테스트 전용으로 두 원천의 비교 기준이 확인된 조건',
} as const;

test.each(['stores', 'sales', 'footTraffic'] as ComparisonMetric[])(
  '%s의 실제 공개 정책은 미검증이며 기본값으로 숫자를 노출하지 않는다',
  (metric) => {
    expect(STATISTICS_COMPARABILITY[metric].status).toBe('unverified');
    const foot = metric === 'footTraffic';
    const a = {
      ...current,
      industryCode: foot ? undefined : current.industryCode,
    };
    const b = {
      ...previous,
      industryCode: foot ? undefined : previous.industryCode,
    };
    expect(compareStatistic(metric, target, a, b)).toEqual({
      status: 'unavailable',
      reason: STATISTICS_COMPARABILITY[metric].reason,
    });
  },
);

test('검증된 조건과 일치하는 응답만 계산하며 원본을 변경하지 않는다', () => {
  expect(
    compareStatistic('stores', target, current, previous, verifiedFixture),
  ).toEqual({
    status: 'available',
    direction: 'decrease',
    delta: '-14',
    rate: '-0.6',
  });
  expect(current.data?.storeCount).toBe('2306');
  expect(previous.data?.storeCount).toBe('2320');
});

test.each([
  { ...previous, districtCode: '11200' },
  { ...previous, districtCode: undefined, dongCode: '11440660' },
  { ...previous, quarterCode: '20262' },
  { ...previous, industryCode: 'CS100001' as 'CS100010' },
  { ...previous, data: null },
  null,
])(
  '지역·업종·분기·집계 단위 불일치 또는 누락은 검증 정책이 있어도 차단한다 %#',
  (response) => {
    expect(
      compareStatistic('stores', target, current, response, verifiedFixture)
        .status,
    ).toBe('unavailable');
  },
);
