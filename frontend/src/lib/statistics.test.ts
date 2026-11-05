import { afterEach, expect, test, vi } from 'vitest';
import {
  fetchFootTrafficStatistics,
  fetchSalesStatistics,
  fetchStoreStatistics,
  formatStatistic,
  type RegionStatTarget,
} from './statistics';

afterEach(() => vi.unstubAllGlobals());

const sourceBatch = {
  batchId: '00000000-0000-0000-0000-000000000002',
  publishedAt: '2026-10-02T00:00:00Z',
};
const stores = {
  storeCount: '9007199254740993',
  generalStoreCount: null,
  franchiseStoreCount: '0',
  openedStoreCount: '9223372036854775807',
  closedStoreCount: '1',
  openingRate: '123.456789012345678901234567890',
  closureRate: '200.0000',
  sourceBatch,
};
const sales = {
  monthlySalesAmount: '9007199254740993',
  monthlySalesCount: null,
  weekdaySalesAmount: '0',
  weekendSalesAmount: '9223372036854775807',
  sourceBatch,
};
const footTraffic = {
  totalFootTraffic: '9007199254740993.123456789012345678900',
  maleFootTraffic: '0.0000',
  femaleFootTraffic: null,
  sourceBatch,
};

function body(target: RegionStatTarget, data: unknown, foot = false) {
  return {
    [target.kind === 'district' ? 'districtCode' : 'dongCode']: target.code,
    quarterCode: '20262',
    ...(foot ? {} : { industryCode: 'CS100010' }),
    data,
  };
}

const cases = [
  ['stores', fetchStoreStatistics, stores],
  ['sales', fetchSalesStatistics, sales],
  ['foot-traffic', fetchFootTrafficStatistics, footTraffic],
] as const;

test.each(cases)(
  '%s는 구·동 경로와 고정 조건을 사용하고 실제 문자열·NULL·출처를 보존한다',
  async (kind, fetchStatistics, data) => {
    const targets: RegionStatTarget[] = [
      { kind: 'district', code: '00110' },
      { kind: 'dong', code: '00110001' },
    ];
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    for (const target of targets) {
      fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify(body(target, data, kind === 'foot-traffic')),
        ),
      );
      expect(await fetchStatistics(target, signal)).toEqual(
        body(target, data, kind === 'foot-traffic'),
      );
      const [url, options] = fetch.mock.calls.at(-1)!;
      const parsed = new URL(url, 'http://localhost');
      expect(parsed.pathname).toBe(
        `/api/v1/${target.kind === 'district' ? 'districts' : 'dongs'}/${target.code}/stats/${kind}`,
      );
      expect(Object.fromEntries(parsed.searchParams)).toEqual({
        quarterCode: '20262',
        ...(kind === 'foot-traffic' ? {} : { industryCode: 'CS100010' }),
      });
      expect(options).toEqual({ signal });
    }
  },
);

test.each(cases)(
  '%s의 data:null은 0과 다른 정상 미존재 응답이다',
  async (kind, fetchStatistics) => {
    const target = { kind: 'district', code: '11110' } as const;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(body(target, null, kind === 'foot-traffic')),
          ),
        ),
    );
    expect(
      (await fetchStatistics(target, new AbortController().signal)).data,
    ).toBeNull();
  },
);

test('모든 측정값이 NULL인 실제 통계 행은 객체와 게시 출처를 유지한다', async () => {
  const target = { kind: 'district', code: '11110' } as const;
  const data = {
    ...Object.fromEntries(
      Object.keys(stores)
        .filter((field) => field !== 'sourceBatch')
        .map((field) => [field, null]),
    ),
    sourceBatch,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body(target, data)))),
  );
  expect(
    (await fetchStoreStatistics(target, new AbortController().signal)).data,
  ).toEqual(data);
});

test.each([
  ['9007199254740993', '9,007,199,254,740,993'],
  ['9223372036854775807', '9,223,372,036,854,775,807'],
  [
    '9007199254740993.123456789012345678900',
    '9,007,199,254,740,993.123456789012345678900',
  ],
  ['0.00000000000000000000100', '0.00000000000000000000100'],
  ['200.0000', '200.0000'],
  ['-12345.6000', '-12,345.6000'],
  ['0', '0'],
  [null, '자료 없음'],
])(
  '숫자 문자열 %s의 정밀도·후행 0·NULL을 보존해 표시한다',
  (value, formatted) => {
    expect(formatStatistic(value)).toBe(formatted);
  },
);

test.each([
  { ...stores, storeCount: 9007199254740992 },
  { ...stores, generalStoreCount: 0 },
  { ...stores, openingRate: 123.4 },
  { ...stores, closedStoreCount: '1.5' },
  { ...stores, openingRate: '1e-10' },
  { ...stores, closureRate: undefined },
  { ...stores, sourceBatch: { ...sourceBatch, batchId: 'bad' } },
  { ...stores, sourceBatch: { ...sourceBatch, publishedAt: 'invalid' } },
])('잘못된 점포 측정값·출처 형식을 거부한다 %#', async (data) => {
  const target = { kind: 'district', code: '11110' } as const;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body(target, data)))),
  );
  await expect(
    fetchStoreStatistics(target, new AbortController().signal),
  ).rejects.toThrow('응답');
});

test.each([
  { ...sales, monthlySalesAmount: 1 },
  { ...sales, monthlySalesCount: 'NaN' },
  { ...sales, weekdaySalesAmount: '' },
])('추정매출의 숫자형 JSON·잘못된 정수 문자열을 거부한다 %#', async (data) => {
  const target = { kind: 'dong', code: '11110515' } as const;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body(target, data)))),
  );
  await expect(
    fetchSalesStatistics(target, new AbortController().signal),
  ).rejects.toThrow('응답');
});

test.each([
  { ...footTraffic, totalFootTraffic: 0 },
  { ...footTraffic, maleFootTraffic: 'Infinity' },
  { ...footTraffic, femaleFootTraffic: ' 1.0' },
])('유동인구의 숫자형 JSON·잘못된 소수 문자열을 거부한다 %#', async (data) => {
  const target = { kind: 'dong', code: '11110515' } as const;
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(body(target, data, true))),
      ),
  );
  await expect(
    fetchFootTrafficStatistics(target, new AbortController().signal),
  ).rejects.toThrow('응답');
});

test.each([
  {
    districtCode: '11140',
    quarterCode: '20262',
    industryCode: 'CS100010',
    data: stores,
  },
  {
    districtCode: '11110',
    quarterCode: '20261',
    industryCode: 'CS100010',
    data: stores,
  },
  {
    districtCode: '11110',
    quarterCode: '20262',
    industryCode: 'CS100001',
    data: stores,
  },
  { districtCode: '11110', quarterCode: '20262', industryCode: 'CS100010' },
])('선택 지역·고정 조건과 다른 응답을 거부한다 %#', async (data) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(data))),
  );
  await expect(
    fetchStoreStatistics(
      { kind: 'district', code: '11110' },
      new AbortController().signal,
    ),
  ).rejects.toThrow('응답');
});

test.each([
  [400, 'INVALID_PARAMETER', '요청'],
  [404, 'REGION_NOT_FOUND', '지역'],
  [503, 'DATA_NOT_READY', '준비'],
  [503, 'DATABASE_UNAVAILABLE', '일시적으로'],
])('HTTP %s 오류를 구분한다', async (status, code, text) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code }), { status })),
  );
  await expect(
    fetchSalesStatistics(
      { kind: 'district', code: '11110' },
      new AbortController().signal,
    ),
  ).rejects.toThrow(text);
});

test('네트워크·취소·잘못된 지역 코드·잘못된 JSON을 구분한다', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('network'));
  vi.stubGlobal('fetch', fetch);
  const target = { kind: 'district', code: '11110' } as const;
  await expect(
    fetchStoreStatistics(target, new AbortController().signal),
  ).rejects.toThrow('네트워크');
  const abort = new AbortController();
  abort.abort();
  await expect(fetchStoreStatistics(target, abort.signal)).rejects.toThrow(
    'network',
  );
  await expect(
    fetchStoreStatistics(
      { ...target, code: '11110/other' },
      new AbortController().signal,
    ),
  ).rejects.toThrow('지역 코드');
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValue(new Response('not JSON'));
  await expect(
    fetchStoreStatistics(target, new AbortController().signal),
  ).rejects.toThrow('응답');
});

test.each(cases)(
  '%s는 이전 분기에도 구·동·업종 계약을 유지하고 다른 분기 응답을 거부한다',
  async (kind, load, data) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    for (const target of [
      { kind: 'district', code: '11440' },
      { kind: 'dong', code: '11440660' },
    ] as const) {
      const result = {
        ...body(target, data, kind === 'foot-traffic'),
        quarterCode: '20261',
      };
      fetch.mockResolvedValueOnce(new Response(JSON.stringify(result)));
      expect(await load(target, signal, '20261')).toEqual(result);
      const url = new URL(fetch.mock.calls.at(-1)![0], 'http://localhost');
      expect(url.searchParams.get('quarterCode')).toBe('20261');
      expect(url.searchParams.get('industryCode')).toBe(
        kind === 'foot-traffic' ? null : 'CS100010',
      );
      fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify(body(target, data, kind === 'foot-traffic')),
        ),
      );
      await expect(load(target, signal, '20261')).rejects.toThrow('응답');
    }
  },
);
test.each(['20260', '20265', '2026', '20261&industryCode=CS100001'])(
  '잘못된 분기 %s는 요청 전에 거부한다',
  async (quarter) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      fetchStoreStatistics(
        { kind: 'district', code: '11440' },
        new AbortController().signal,
        quarter,
      ),
    ).rejects.toThrow('분기');
    expect(fetch).not.toHaveBeenCalled();
  },
);

test.each(['20261', '20262'])(
  '분기 %s 응답의 구·동 식별자가 혼재하면 집계 단위를 거부한다',
  async (quarter) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const target = { kind: 'district', code: '11440' } as const;
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...body(target, stores),
          quarterCode: quarter,
          dongCode: '11440660',
        }),
      ),
    );
    await expect(
      fetchStoreStatistics(target, new AbortController().signal, quarter),
    ).rejects.toThrow('응답');
  },
);
