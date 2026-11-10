import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeDistrictFootTrafficApi } from './district-foot-traffic-api.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

// 합성 응답은 테스트 모듈에서만 HTTPS 주소와 fetch를 대체해 공급합니다.
const testEndpoint = vi.hoisted(() => ({ url: 'https://seoul-api.test' }));
vi.mock('../../common/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../common/config.js')>()),
  get seoulOpenApiEndpoint() {
    return testEndpoint.url;
  },
}));

const fakeKey = 'test-key-never-send';
const privateUrl = `https://seoul-api.test/${fakeKey}/json/VwsmSignguFlpopW`;
const fetchPage = vi.fn<typeof fetch>();
const probe = (options: { expectedRows?: number; compareCsv?: string } = {}) =>
  probeDistrictFootTrafficApi({ api: true, probe: true, ...options });

const row = (district = 11110, quarter = 20262) =>
  JSON.stringify({
    STDR_YYQU_CD: quarter,
    SIGNGU_CD: district,
    TOT_FLPOP_CO: '10.0',
    ML_FLPOP_CO: null,
    FML_FLPOP_CO: 0,
  });

// 실제 JSON 숫자 토큰을 써야 Number 변환 시 정밀도가 사라지는 회귀를 잡을 수 있습니다.
const preciseRow =
  '{"STDR_YYQU_CD":20262,"SIGNGU_CD":"11110","TOT_FLPOP_CO":9007199254740993.12345678901234567890,"ML_FLPOP_CO":null,"FML_FLPOP_CO":0.000}';
const firstPageRows = Array.from({ length: 100 }, (_, index) =>
  row(11110 + index),
);
const page = (total: number, rows: string[]) =>
  new Response(
    `{"VwsmSignguFlpopW":{"list_total_count":${total},"RESULT":{"CODE":"INFO-000","MESSAGE":"정상"},"row":[${rows.join(',')}]}}`,
  );

beforeEach(() => {
  testEndpoint.url = 'https://seoul-api.test';
  vi.stubEnv('SEOUL_OPEN_API_KEY', fakeKey);
  fetchPage.mockReset();
  vi.stubGlobal('fetch', fetchPage);
  vi.mocked(readFile).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('자치구 길단위인구 서울시 API probe', () => {
  it.each(['http://openapi.seoul.go.kr:8088', 'invalid-endpoint'])(
    'HTTPS가 아닌 주소는 설정된 키가 있어도 fetch 전에 차단한다 (%#)',
    async (endpoint) => {
      testEndpoint.url = endpoint;
      const error: unknown = await probe().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('BLOCKED:');
      expect(String(error)).toContain('HTTPS');
      expect(String(error)).not.toContain(fakeKey);
      expect(String(error)).not.toContain(endpoint);
      expect(error).not.toHaveProperty('cause');
      expect(fetchPage).not.toHaveBeenCalled();
    },
  );

  it('페이지 전체를 수집하고 원문 숫자 정밀도·NULL·실제 0을 보존한다', async () => {
    fetchPage
      .mockResolvedValueOnce(page(101, [preciseRow, ...firstPageRows.slice(1)]))
      .mockResolvedValueOnce(page(101, [row(11110, 20261)]));

    const result = await probe({ expectedRows: 101 });
    expect(result).toMatchObject({
      mode: 'PROBE',
      datasetId: 'OA-22179',
      serviceName: 'VwsmSignguFlpopW',
      validationScope: 'OPEN_API_FULL_COLLECTION',
      databaseChecked: false,
      batchCreated: false,
      loadedRows: 0,
      expectedRows: 101,
      reportedRows: 101,
      fetchedRows: 101,
      validRows: 101,
      rejectedRows: 0,
      pages: 2,
      periodFrom: '20261',
      periodTo: '20262',
    });
    expect(result.sample).toHaveLength(5);
    expect(result.sample[0]).toEqual({
      districtCode: '11110',
      quarterCode: '20262',
      totalFootTraffic: '9007199254740993.12345678901234567890',
      maleFootTraffic: null,
      femaleFootTraffic: '0.000',
    });
    expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([
      `${privateUrl}/1/100/`,
      `${privateUrl}/101/101/`,
    ]);
    expect(fetchPage.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    });
    expect(readFile).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(fakeKey);
  });

  it.each([
    [101, [], '구간의 행 수'],
    [102, [row(11210)], '전체 건수가 수집 중 변경'],
    [101, [row()], '복합키가 중복'],
    [101, [row(11210, 20265)], '필수 코드 또는 수치'],
    [
      101,
      [
        '{"STDR_YYQU_CD":"20262","SIGNGU_CD":"11210","TOT_FLPOP_CO":1,"ML_FLPOP_CO":null}',
      ],
      '필수 코드 또는 수치',
    ],
  ] as const)(
    '두 번째 페이지 오류를 전체 실패로 처리한다 (%#)',
    async (total, rows, error) => {
      fetchPage
        .mockResolvedValueOnce(page(101, firstPageRows))
        .mockResolvedValueOnce(page(total, [...rows]));
      await expect(probe()).rejects.toThrow(error);
      expect(fetchPage).toHaveBeenCalledTimes(2);
    },
  );

  it('첫 페이지 누락과 독립 기대 건수 불일치를 거부한다', async () => {
    fetchPage
      .mockResolvedValueOnce(page(2, [row()]))
      .mockResolvedValueOnce(page(1, [row()]));
    await expect(probe()).rejects.toThrow('구간의 행 수');
    await expect(probe({ expectedRows: 2 })).rejects.toThrow('예상 행 수');
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, '', 'sample'])(
    '전체 조회 키가 없으면 요청 전에 차단한다 (%#)',
    async (key) => {
      vi.stubEnv('SEOUL_OPEN_API_KEY', key);
      await expect(probe()).rejects.toThrow('BLOCKED');
      expect(fetchPage).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ RESULT: { CODE: 'INFO-200', MESSAGE: privateUrl } }, 'INFO-200'],
    [
      {
        VwsmSignguFlpopW: {
          RESULT: { CODE: 'ERROR-300', MESSAGE: privateUrl },
        },
      },
      'ERROR-300',
    ],
    [{ RESULT: { CODE: privateUrl, MESSAGE: privateUrl } }, '응답 오류'],
  ] as const)(
    '서울시 오류는 안전한 코드만 노출하고 재시도하지 않는다 (%#)',
    async (body, code) => {
      fetchPage.mockResolvedValueOnce(Response.json(body));
      const error: unknown = await probe().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain(code);
      expect(String(error)).not.toContain(fakeKey);
      expect(fetchPage).toHaveBeenCalledOnce();
    },
  );

  it.each([302, 403])(
    'HTTP %s 응답은 본문·리다이렉트를 사용하지 않고 실패한다',
    async (status) => {
      fetchPage.mockResolvedValueOnce(
        new Response(privateUrl, {
          status,
          headers: { location: privateUrl },
        }),
      );
      await expect(probe()).rejects.toThrow(`HTTP 오류(${status})`);
      expect(fetchPage).toHaveBeenCalledTimes(1);
    },
  );

  it('일시적 HTTP 오류에만 같은 페이지를 한 번 더 요청한다', async () => {
    fetchPage
      .mockResolvedValueOnce(new Response(privateUrl, { status: 503 }))
      .mockResolvedValueOnce(page(1, [row()]));
    await expect(probe()).resolves.toMatchObject({ fetchedRows: 1 });
    expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([
      `${privateUrl}/1/100/`,
      `${privateUrl}/1/100/`,
    ]);
  });

  it('제한 시간과 재시도 상한을 적용하고 fetch 예외의 원문을 폐기한다', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => AbortSignal.abort());
    fetchPage.mockImplementation(async (_url, options) => {
      expect(options?.signal?.aborted).toBe(true);
      throw new Error(privateUrl);
    });
    const error: unknown = await probe().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('제한 시간 초과');
    expect(String(error)).not.toContain(fakeKey);
    expect(error).not.toHaveProperty('cause');
    expect(timeout.mock.calls).toEqual([[10_000], [10_000]]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('크기 초과 응답의 읽기를 취소하고 재시도하지 않는다', async () => {
    const cancel = vi.fn();
    fetchPage.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(4 * 1024 * 1024));
            controller.enqueue(new Uint8Array(1));
          },
          cancel,
        }),
      ),
    );
    await expect(probe()).rejects.toThrow('응답 크기 제한');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('잘못된 JSON과 원문 음수 0을 거부한다', async () => {
    fetchPage
      .mockResolvedValueOnce(new Response(privateUrl))
      .mockResolvedValueOnce(page(1, [preciseRow.replace('0.000', '-0')]));
    await expect(probe()).rejects.toThrow('JSON 응답');
    await expect(probe()).rejects.toThrow('필수 코드 또는 수치');
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('CSV를 선택하면 키 순서와 표현 자릿수에 관계없이 정확한 값 전체를 대조한다', async () => {
    fetchPage.mockResolvedValueOnce(page(2, [preciseRow, row(11120)]));
    vi.mocked(readFile).mockResolvedValueOnce(
      Buffer.from(
        'STDR_YYQU_CD,SIGNGU_CD,TOT_FLPOP_CO,ML_FLPOP_CO,FML_FLPOP_CO\n' +
          '20262,11120,1e1,,0.00\n' +
          '20262,11110,9007199254740993.1234567890123456789,,0\n',
      ),
    );
    await expect(
      probe({ compareCsv: '/private/source.csv' }),
    ).resolves.toMatchObject({
      csvComparison: { matchedRows: 2, comparedValues: 6 },
    });
  });

  it('CSV와 API의 키 누락, NULL과 0 또는 정밀 수치 불일치를 전체 실패로 보고한다', async () => {
    fetchPage.mockResolvedValueOnce(
      page(3, [preciseRow, row(11120), row(11130)]),
    );
    vi.mocked(readFile).mockResolvedValueOnce(
      Buffer.from(
        'STDR_YYQU_CD,SIGNGU_CD,TOT_FLPOP_CO,ML_FLPOP_CO,FML_FLPOP_CO\n' +
          '20262,11110,9007199254740993.12345678901234567891,,0\n' +
          '20262,11120,10,0,0\n' +
          '20262,11140,10,,0\n',
      ),
    );
    await expect(probe({ compareCsv: '/private/source.csv' })).rejects.toThrow(
      'API 전용 1행, CSV 전용 1행, 수치 불일치 2행',
    );
  });
});
