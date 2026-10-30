import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readCafeSource,
  probeCafeSource,
  type CafeRow,
  type CafeOptions,
} from './cafe-source.js';

const options = { industryCode: 'I21201', industryName: '커피 전문점' };
const row = (id = 'MA000000000000000001') => ({
  bizesId: id,
  bizesNm: '테스트 카페',
  brchNm: '',
  indsLclsCd: 'I2',
  indsLclsNm: '음식',
  indsMclsCd: 'I212',
  indsMclsNm: '비알코올 음료점업',
  indsSclsCd: 'I21201',
  indsSclsNm: '커피 전문점',
  ksicCd: '56221',
  ksicNm: '커피 전문점',
  ctprvnCd: '11',
  ctprvnNm: '서울특별시',
  signguCd: '11110',
  signguNm: '종로구',
  adongCd: '11110515',
  adongNm: '청운효자동',
  ldongCd: '1111010100',
  ldongNm: '청운동',
  lnoCd: '1111010100100010000',
  plotSctCd: '1',
  plotSctNm: '대지',
  lnoMnno: '1',
  lnoSlno: '0',
  lnoAdr: '서울특별시 종로구 테스트 1',
  rdnmCd: '111103100001',
  rdnm: '테스트로',
  bldMnno: '1',
  bldSlno: '0',
  bldMngNo: '1111010100100010000000001',
  bldNm: '',
  rdnmAdr: '서울특별시 종로구 테스트로 1',
  oldZipcd: '',
  newZipcd: '03000',
  dongNo: '',
  flrNo: '1',
  hoNo: '',
  lon: '126.97',
  lat: '37.58',
});
const classification = () => ({
  header: {
    description: '업종 소분류',
    columns: '',
    resultCode: '00',
    resultMsg: 'NORMAL SERVICE',
  },
  body: {
    items: [
      {
        indsLclsCd: 'I2',
        indsLclsNm: '음식',
        indsMclsCd: 'I212',
        indsMclsNm: '비알코올 음료점업',
        indsSclsCd: 'I21201',
        indsSclsNm: '커피 전문점',
        stdrDt: '20260301',
      },
    ],
  },
});
const page = (
  items: unknown[] = [row()],
  pageNo = 1,
  totalCount = items.length,
) => ({
  header: {
    description: '행정동 단위 상가업소',
    columns: '',
    stdrYm: '202603',
    resultCode: '00',
    resultMsg: 'NORMAL SERVICE',
  },
  body: { items, numOfRows: 1000, pageNo, totalCount },
});
let responses: Array<Response | Error>;
let requests: URL[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('SEMAS_API_KEY', 'unit-test-secret/+==');
  responses = [Response.json(classification()), Response.json(page())];
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL, init: RequestInit) => {
      requests.push(new URL(input));
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('unexpected request');
      return next;
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function collect(input: CafeOptions = options) {
  const rows: CafeRow[] = [];
  const resultPromise = readCafeSource(input, async (chunk) => {
    rows.push(...chunk);
  });
  const settled = resultPromise.then((result) => ({ result, rows }));
  // 재시도·요청 간격은 가상 시계로 진행하고 API·Zod 검증은 실제 구현을 실행합니다.
  const assertion = settled.catch((error) => {
    throw error;
  });
  void assertion.catch(() => {});
  await vi.runAllTimersAsync();
  return assertion;
}

describe('카페 API 원본', () => {
  it('probe는 분류와 첫 페이지 5행만 확인하고 전체 수집으로 표시하지 않는다', async () => {
    const first = page(
      Array.from({ length: 5 }, (_, index) => row(String(index))),
      1,
      1001,
    );
    first.body.numOfRows = 5;
    responses[1] = Response.json(first);
    const pending = probeCafeSource(options);
    const assertion = expect(pending).resolves.toMatchObject({
      mode: 'PROBE',
      databaseChecked: false,
      fetchedRows: 5,
      validRows: 5,
      reference: {
        collection_mode: 'PROBE',
        complete: false,
        classification_verified: true,
        pages: 1,
        totalCount: 1001,
      },
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(requests).toHaveLength(2);
    expect(requests[1]!.searchParams.get('numOfRows')).toBe('5');
    expect(JSON.stringify(await pending)).not.toContain('unit-test-secret');
  });

  it.each(['classification', 'page', 'row'])(
    'probe도 잘못된 분류·첫 페이지 %s를 거부한다',
    async (kind) => {
      const first = page();
      first.body.numOfRows = 5;
      if (kind === 'classification')
        responses[0] = Response.json({
          ...classification(),
          body: { items: [] },
        });
      if (kind === 'page') first.body.pageNo = 2;
      if (kind === 'row') first.body.items = [{ ...row(), bizesNm: '' }];
      responses[1] = Response.json(first);
      const pending = probeCafeSource(options);
      const assertion = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;
      expect(requests).toHaveLength(kind === 'classification' ? 1 : 2);
    },
  );

  it('공식 분류와 인증 응답을 교차 검증하고 서울 전체 수집 출처를 만든다', async () => {
    const { result, rows } = await collect();
    expect(rows[0]).toMatchObject({
      bizesId: 'MA000000000000000001',
      sourceDongCode: '11110515',
      sourceDistrictCode: '11110',
      branchName: null,
      longitude: 126.97,
      latitude: 37.58,
    });
    expect(result).toMatchObject({
      fetchedRows: 1,
      validRows: 1,
      rejectedRows: 0,
      reference: {
        collection_mode: 'FULL_SEOUL',
        complete: true,
        stdrYm: '202603',
        classification_verified: true,
      },
    });
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('unit-test-secret');
    expect(requests.map((url) => url.pathname.split('/').at(-1))).toEqual([
      'smallUpjongList',
      'storeListInDong',
    ]);
    expect(requests[1]!.searchParams.get('divId')).toBe('ctprvnCd');
    expect(requests[1]!.searchParams.get('key')).toBe('11');
    expect(requests[1]!.searchParams.get('indsSclsCd')).toBe('I21201');
  });
  it('각 오퍼레이션의 공식 Swagger에 명시된 인증 매개변수명을 사용한다', async () => {
    await collect();
    expect(requests[0]!.searchParams.get('servicekey')).toBe(
      'unit-test-secret/+==',
    );
    expect(requests[1]!.searchParams.get('ServiceKey')).toBe(
      'unit-test-secret/+==',
    );
  });
  it.each(['카페', '커피전문점'])(
    '공식 소진공 분류명이 %s이면 KSIC 명칭과 분리해 검증한다',
    async (industryName) => {
      const catalog = classification();
      catalog.body.items[0]!.indsSclsNm = industryName;
      responses = [
        Response.json(catalog),
        Response.json(
          page([{ ...row(), indsSclsNm: industryName, ksicNm: '커피 전문점' }]),
        ),
      ];
      const result = await collect({ ...options, industryName });
      expect(result.rows[0]).toMatchObject({
        semasIndustryName: industryName,
        ksicName: '커피 전문점',
      });
      expect(result.result.reference).toMatchObject({
        industry_name: industryName,
        classification_verified: true,
      });
    },
  );
  it('하이픈으로 표시한 실제 분류 기준일을 보존한다', async () => {
    const catalog = classification();
    catalog.body.items[0]!.stdrDt = '2026-03-01';
    responses[0] = Response.json(catalog);
    expect((await collect()).result.reference.classification_date).toBe(
      '2026-03-01',
    );
  });
  it.each(['2026-02-30', '2026-13-01', '2026-3-1', '2026/03/01'])(
    '유효하지 않은 분류 기준일 %s를 거부한다',
    async (stdrDt) => {
      const catalog = classification();
      catalog.body.items[0]!.stdrDt = stdrDt;
      responses[0] = Response.json(catalog);
      await expect(collect()).rejects.toThrow(/분류/);
    },
  );
  it('모든 페이지를 읽고 페이지당 최대 1000행을 전달한다', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => row(String(i)));
    responses = [
      Response.json(classification()),
      Response.json(page(first, 1, 1001)),
      Response.json(page([row('last')], 2, 1001)),
    ];
    const result = await collect();
    expect(result.rows).toHaveLength(1001);
    expect(result.result.reference).toMatchObject({
      pages: 2,
      totalCount: 1001,
    });
    expect(requests[2]!.searchParams.get('pageNo')).toBe('2');
  });
  it('빈 선택값·좌표는 NULL이고 원본 10자리 코드는 보존한다', async () => {
    responses[1] = Response.json(
      page([
        {
          ...row(),
          adongCd: '1111051500',
          lon: '',
          lat: null,
          ksicCd: '',
          ksicNm: null,
        },
      ]),
    );
    expect((await collect()).rows[0]).toMatchObject({
      sourceDongCode: '1111051500',
      longitude: null,
      latitude: null,
      ksicCode: null,
      ksicName: null,
    });
  });
  it('JSON response 및 items.item 래퍼를 안전하게 처리한다', async () => {
    const content = page();
    responses[1] = Response.json({
      response: {
        ...content,
        body: { ...content.body, items: { item: row() } },
      },
    });
    expect((await collect()).result.validRows).toBe(1);
  });
  it.each([
    ['bizesId', ''],
    ['bizesId', 'a b'],
    ['bizesNm', '  '],
    ['indsSclsCd', 'CS100010'],
    ['indsSclsNm', '음식점'],
    ['adongCd', '11x'],
    ['adongCd', '111101234567890123456'],
    ['ctprvnCd', '26'],
    ['signguCd', '26110'],
    ['lon', 'NaN'],
    ['lon', 'Infinity'],
    ['lon', '181'],
    ['lat', '91'],
    ['lon', ''],
    ['lat', ''],
    ['lon', ' 127'],
  ])('잘못된 필드 %s=%s가 전체 게시를 차단한다', async (key, value) => {
    responses[1] = Response.json(page([{ ...row(), [key]: value }]));
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 1,
      validRows: 0,
      rejectedRows: 1,
    });
  });
  it('행정동과 시군구 코드가 서로 다르면 실패한다', async () => {
    responses[1] = Response.json(page([{ ...row(), adongCd: '11680510' }]));
    await expect(collect()).rejects.toThrow(/행/);
  });
  it('동일 bizesId는 내용이 같아도 거부한다', async () => {
    responses[1] = Response.json(page([row(), row()]));
    await expect(collect()).rejects.toThrow(/중복/);
  });
  it.each(['catalog-name', 'catalog-code', 'catalog-duplicate', 'not-cafe'])(
    '미검증 분류 %s를 게시하지 않는다',
    async (kind) => {
      const content = classification();
      if (kind === 'catalog-name')
        content.body.items[0]!.indsSclsNm = '다른 이름';
      if (kind === 'catalog-code') content.body.items[0]!.indsSclsCd = 'I20101';
      if (kind === 'catalog-duplicate')
        content.body.items.push({ ...content.body.items[0]! });
      responses[0] = Response.json(content);
      await expect(
        collect(
          kind === 'not-cafe'
            ? { industryCode: 'I20101', industryName: '음식점' }
            : options,
        ),
      ).rejects.toThrow();
      expect(requests.length).toBeLessThanOrEqual(1);
    },
  );
  it.each(['total', 'page', 'empty', 'month', 'count', 'expected'])(
    '불완전한 수집 %s를 거부한다',
    async (kind) => {
      const content = page();
      if (kind === 'total') content.body.totalCount = 2;
      if (kind === 'page') content.body.pageNo = 2;
      if (kind === 'empty') {
        content.body.items = [];
        content.body.totalCount = 0;
      }
      if (kind === 'month') content.header.stdrYm = '202613';
      if (kind === 'count') content.body.numOfRows = 0;
      responses[1] = Response.json(content);
      await expect(
        collect(
          kind === 'expected' ? { ...options, expectedRows: 2 } : options,
        ),
      ).rejects.toThrow();
    },
  );
  it('페이지 간 기준년월 또는 전체 건수 변경을 거부한다', async () => {
    const next = page([row('last')], 2, 1001);
    next.header.stdrYm = '202604';
    responses = [
      Response.json(classification()),
      Response.json(
        page(
          Array.from({ length: 1000 }, (_, i) => row(String(i))),
          1,
          1001,
        ),
      ),
      Response.json(next),
    ];
    await expect(collect()).rejects.toThrow(/기준|변경/);
  });
  it('원본 순서가 바뀌어도 같은 체크섬을 만든다', async () => {
    responses[1] = Response.json(page([row('a'), row('b')]));
    const first = await collect();
    responses = [
      Response.json(classification()),
      Response.json(page([row('b'), row('a')])),
    ];
    expect((await collect()).result.checksum).toBe(first.result.checksum);
  });
  it('일시적 429·503 오류는 제한된 재시도 후 정상 수집한다', async () => {
    responses = [
      new Response('', { status: 429 }),
      new Response('', { status: 503 }),
      Response.json(classification()),
      Response.json(page()),
    ];
    expect((await collect()).result.validRows).toBe(1);
    expect(requests).toHaveLength(4);
  });
  it.each(['http', 'network', 'api', 'json'])(
    '오류 %s에 인증키·응답 본문·원본 URL을 노출하지 않는다',
    async (kind) => {
      const secret = 'unit-test-secret/+==';
      if (kind === 'http') responses = [new Response(secret, { status: 401 })];
      if (kind === 'network')
        responses = Array.from(
          { length: 3 },
          () => new Error('https://example?serviceKey=' + secret),
        );
      if (kind === 'api')
        responses = [
          Response.json({
            header: { resultCode: '30', resultMsg: secret },
            body: {},
          }),
        ];
      if (kind === 'json') responses = [new Response(secret)];
      const failure = await collect().catch((error) => error as Error);
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain(secret);
      expect((failure as Error).cause).toBeUndefined();
    },
  );
  it('인증키가 없으면 요청하지 않고 안전하게 실패한다', async () => {
    vi.stubEnv('SEMAS_API_KEY', '');
    await expect(collect()).rejects.toThrow(/SEMAS_API_KEY/);
    expect(requests).toHaveLength(0);
  });
  it('타임아웃은 요청을 중단하고 세 번까지만 재시도한다', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', (_input: URL, init: RequestInit) => {
      attempts++;
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () =>
          reject(new Error('secret URL')),
        );
      });
    });
    await expect(collect()).rejects.toThrow(/제한 시간/);
    expect(attempts).toBe(3);
  });
  it('인증 실패 HTTP 응답은 재시도하지 않는다', async () => {
    responses = [new Response('private response', { status: 403 })];
    await expect(collect()).rejects.toThrow(/403/);
    expect(requests).toHaveLength(1);
  });
  it('무제한 크기의 응답을 메모리에 읽지 않는다', async () => {
    responses = [new Response(new Uint8Array(16 * 1024 * 1024 + 1))];
    await expect(collect()).rejects.toThrow(/크기 제한/);
    expect(requests).toHaveLength(1);
  });
  it('API가 필드에 반사한 인증키를 staging이나 오류에 전달하지 않는다', async () => {
    responses[1] = Response.json(
      page([{ ...row(), bizesNm: 'unit-test-secret/+==' }]),
    );
    const delivered: CafeRow[] = [];
    const promise = readCafeSource(options, async (rows) => {
      delivered.push(...rows);
    });
    const failure = promise.catch((error) => error as Error);
    await vi.runAllTimersAsync();
    expect(String(await failure)).not.toContain('unit-test-secret');
    expect(delivered).toHaveLength(0);
  });
  it('staging 오류의 원본 메시지와 cause를 노출하지 않는다', async () => {
    const promise = readCafeSource(options, async () => {
      throw new Error('https://private?serviceKey=secret');
    });
    const failure = promise.catch((error) => error as Error);
    await vi.runAllTimersAsync();
    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('private');
    expect((error as Error).cause).toBeUndefined();
  });
  it('이미 받은 페이지와 중복된 업소는 다음 페이지에서도 거부한다', async () => {
    responses = [
      Response.json(classification()),
      Response.json(
        page(
          Array.from({ length: 1000 }, (_, i) => row(String(i))),
          1,
          1001,
        ),
      ),
      Response.json(page([row('0')], 2, 1001)),
    ];
    await expect(collect()).rejects.toMatchObject({
      fetchedRows: 1001,
      validRows: 1000,
      rejectedRows: 1,
    });
  });
  it('페이지 사이 전체 건수가 바뀌면 실패한다', async () => {
    responses = [
      Response.json(classification()),
      Response.json(
        page(
          Array.from({ length: 1000 }, (_, i) => row(String(i))),
          1,
          1001,
        ),
      ),
      Response.json(page([row('last')], 2, 1002)),
    ];
    await expect(collect()).rejects.toThrow(/전체 건수/);
  });
  it('필드 순서와 사용하지 않는 원본 속성은 체크섬에 영향을 주지 않는다', async () => {
    const first = await collect();
    const original = row();
    responses = [
      Response.json(classification()),
      Response.json(
        page([
          {
            ...Object.fromEntries(Object.entries(original).reverse()),
            hoNo: '2',
          },
        ]),
      ),
    ];
    expect((await collect()).result.checksum).toBe(first.result.checksum);
  });
  it('저장하는 값이 바뀌면 체크섬도 바뀐다', async () => {
    const first = await collect();
    responses = [
      Response.json(classification()),
      Response.json(page([{ ...row(), bizesNm: '변경 카페' }])),
    ];
    expect((await collect()).result.checksum).not.toBe(first.result.checksum);
  });
  it('429의 Retry-After 이전에는 다음 요청을 보내지 않는다', async () => {
    responses = [
      new Response('', { status: 429, headers: { 'Retry-After': '10' } }),
      Response.json(classification()),
      Response.json(page()),
    ];
    const result = readCafeSource(options, async () => {});
    await vi.advanceTimersByTimeAsync(500);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9999);
    expect(requests).toHaveLength(1);
    await vi.runAllTimersAsync();
    expect((await result).validRows).toBe(1);
  });
  it('허용 대기 시간보다 긴 Retry-After는 빠르게 재시도하지 않고 실패한다', async () => {
    responses = [
      new Response('', { status: 503, headers: { 'Retry-After': '600' } }),
    ];
    await expect(collect()).rejects.toThrow(/대기/);
    expect(requests).toHaveLength(1);
  });
  it('잘못된 UTF-8 문자열을 대체문자로 변환해 게시하지 않는다', async () => {
    const bytes = Buffer.from(JSON.stringify(page()));
    const offset = bytes.indexOf(Buffer.from('테스트 카페'));
    bytes[offset] = 0xff;
    responses[1] = new Response(bytes);
    await expect(collect()).rejects.toThrow(/UTF-8/);
  });
  it('URL 인코딩된 인증키가 응답 필드에 반사되어도 전달하지 않는다', async () => {
    responses[1] = Response.json(
      page([{ ...row(), bizesNm: encodeURIComponent('unit-test-secret/+==') }]),
    );
    await expect(collect()).rejects.toMatchObject({ rejectedRows: 1 });
  });
  it('소문자 percent 인코딩된 인증키 반사도 거부한다', async () => {
    const reflected = encodeURIComponent('unit-test-secret/+==').replace(
      /%[A-F0-9]{2}/g,
      (value) => value.toLowerCase(),
    );
    responses[1] = Response.json(page([{ ...row(), bizesNm: reflected }]));
    await expect(collect()).rejects.toMatchObject({ rejectedRows: 1 });
  });
  it('실제 달력에 없는 분류 기준일은 거부한다', async () => {
    const content = classification();
    content.body.items[0]!.stdrDt = '20260230';
    responses[0] = Response.json(content);
    await expect(collect()).rejects.toThrow(/분류/);
  });
});
