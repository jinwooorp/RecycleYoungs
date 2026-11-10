import type { Candidate } from '../src/lib/candidates.ts';
import type { CafePage } from '../src/lib/cafes.ts';

// 실제 원천·승인 자료가 아닌 브라우저 회귀 테스트 전용 합성 값입니다.
export const sourceBatch = {
  batchId: '00000000-0000-4000-8000-000000000001',
  publishedAt: '2026-07-01T00:00:00Z',
};
export const districts = [
  { districtCode: '11440', districtName: '마포구' },
  { districtCode: '11200', districtName: '성동구' },
];
export const dongs = [
  { dongCode: '11440660', districtCode: '11440', dongName: '서교동' },
  { dongCode: '11200650', districtCode: '11200', dongName: '성수1가1동' },
];
export const candidates: Candidate[] = [
  { slot: 'A', name: '합성 홍대 후보지', longitude: 126.923, latitude: 37.556 },
  { slot: 'B', name: '합성 성수 후보지', longitude: 127.048, latitude: 37.546 },
  { slot: 'C', name: '합성 서교 후보지', longitude: 126.924, latitude: 37.555 },
];

export function cafePage(radius: number): CafePage {
  return {
    totalCount: radius === 1000 ? 7 : 3,
    limit: 200,
    offset: 0,
    hasMore: true,
    sourceBatch,
    items: [
      {
        bizesId: 'synthetic-cafe-1',
        storeName: '합성 경쟁 카페',
        branchName: '테스트점',
        semasIndustryCode: 'I21201',
        semasIndustryName: '커피 전문점',
        roadAddress: '서울특별시 합성 테스트로 1',
        lotAddress: null,
        longitude: 126.923,
        latitude: 37.556,
        distanceM: 120,
      },
    ],
  };
}

export function statistics(metric: string, code: string) {
  const storeCount = code === '11440' ? '120' : code === '11200' ? '240' : '30';
  if (metric === 'stores')
    return {
      storeCount,
      generalStoreCount:
        storeCount === '120' ? '110' : storeCount === '240' ? '230' : '20',
      franchiseStoreCount: '10',
      openedStoreCount: '2',
      closedStoreCount: '0',
      openingRate: '1.00',
      closureRate: '0.00',
      sourceBatch,
    };
  if (metric === 'sales')
    return {
      monthlySalesAmount: '9007199254740993',
      monthlySalesCount: '1234',
      weekdaySalesAmount: '6000000000000000',
      weekendSalesAmount: '3007199254740993',
      sourceBatch,
    };
  return {
    totalFootTraffic: '123456.7800',
    maleFootTraffic: '60000.0000',
    femaleFootTraffic: '63456.7800',
    sourceBatch,
  };
}
