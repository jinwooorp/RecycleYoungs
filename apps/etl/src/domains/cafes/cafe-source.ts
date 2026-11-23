import { createHash } from 'node:crypto';
import { z } from 'zod';

export type CafeOptions = {
  industryCode: string;
  industryName: string;
  expectedRows?: number;
};
export type CafeRow = {
  bizesId: string;
  storeName: string;
  branchName: string | null;
  semasIndustryCode: string;
  semasIndustryName: string;
  ksicCode: string | null;
  ksicName: string | null;
  sourceDongCode: string | null;
  sourceDistrictCode: string;
  roadAddress: string | null;
  lotAddress: string | null;
  longitude: number | null;
  latitude: number | null;
};
export type CafeSource = {
  checksum: string;
  fetchedRows: number;
  validRows: number;
  rejectedRows: number;
  reference: Record<string, unknown>;
};

/** 인증키를 포함하지 않는 수집 건수·출처만 실패 이력으로 전달합니다. */
export class CafeSourceError extends Error {
  readonly fetchedRows: number;
  readonly validRows: number;
  readonly rejectedRows: number;
  readonly checksum?: string;
  readonly reference: Record<string, unknown>;

  constructor(message: string, metadata: Partial<CafeSource> = {}) {
    super(message);
    this.name = 'CafeSourceError';
    this.fetchedRows = metadata.fetchedRows ?? 0;
    this.validRows = metadata.validRows ?? 0;
    this.rejectedRows = metadata.rejectedRows ?? 0;
    this.checksum = metadata.checksum;
    this.reference = metadata.reference ?? {};
  }
}

const endpoint = 'https://apis.data.go.kr/B553077/api/open/sdsc2';
const pageSize = 1000;
const maxPages = 10000;
const maxResponseBytes = 16 * 1024 * 1024;
const text = z
  .string()
  .min(1)
  .max(1000)
  .regex(/\S/)
  .refine((value) =>
    [...value].every(
      (character) =>
        character.codePointAt(0)! > 31 && character.codePointAt(0)! !== 127,
    ),
  );
const optionalText = z.preprocess(
  (value) => (value === '' || value == null ? null : value),
  text.nullable(),
);
const optionalCode = (max: number, expression: RegExp) =>
  z.preprocess(
    (value) => (value === '' || value == null ? null : value),
    z.string().min(1).max(max).regex(expression).nullable(),
  );
const coordinate = z.preprocess(
  (value) => (value === '' || value == null ? null : value),
  z
    .union([
      z.number(),
      z
        .string()
        .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/)
        .transform(Number),
    ])
    .pipe(z.number().finite())
    .nullable(),
);
const rawRow = z
  .object({
    bizesId: text.max(20).regex(/^\S+$/),
    bizesNm: text,
    brchNm: optionalText,
    indsSclsCd: z
      .string()
      .min(1)
      .max(8)
      .regex(/^[A-Z0-9]+$/),
    indsSclsNm: text,
    ksicCd: optionalCode(6, /^[A-Z0-9]+$/),
    ksicNm: optionalText,
    ctprvnCd: z.literal('11'),
    signguCd: z.string().regex(/^11[0-9]{3}$/),
    adongCd: optionalCode(20, /^[0-9]+$/),
    rdnmAdr: optionalText,
    lnoAdr: optionalText,
    lon: coordinate,
    lat: coordinate,
  })
  .superRefine((row, context) => {
    if ((row.lon === null) !== (row.lat === null))
      context.addIssue({
        code: 'custom',
        message: '경도·위도는 함께 제공되어야 합니다.',
      });
    if (
      (row.lon !== null && Math.abs(row.lon) > 180) ||
      (row.lat !== null && Math.abs(row.lat) > 90)
    )
      context.addIssue({ code: 'custom', message: '좌표 범위 오류' });
    if (
      row.adongCd &&
      row.adongCd.length >= 5 &&
      !row.adongCd.startsWith(row.signguCd)
    )
      context.addIssue({ code: 'custom', message: '행정동·시군구 불일치' });
  });
const natural = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^[0-9]+$/)
      .transform(Number),
  ])
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const envelope = z.object({
  header: z.object({
    resultCode: z.literal('00'),
    stdrYm: z
      .string()
      .regex(/^[0-9]{4}(0[1-9]|1[0-2])$/)
      .optional(),
  }),
  body: z.record(z.string(), z.unknown()),
});

/** 문서의 배열 및 XML 대응 item 래퍼만 허용하며 알 수 없는 구조는 실패시킵니다. */
function itemsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && 'item' in value) {
    const item = value.item;
    if (Array.isArray(item)) return item;
    if (item && typeof item === 'object') return [item];
  }
  throw new CafeSourceError('API items 구조를 확인할 수 없습니다.');
}

/**
 * 인증키는 요청 URL 생성에만 사용합니다. 응답·fetch 예외에는 URL이나 키가 섞일 수 있어
 * 본문·외부 오류를 전달하지 않고 내부에서 정한 오류만 반환합니다. 리다이렉트도 차단합니다.
 */
async function request(
  operation: string,
  parameters: Record<string, string>,
  key: string,
) {
  let retryAfter = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    // 연속 호출은 최대 초당 2회이며 재시도에는 지수 대기를 추가합니다.
    await new Promise<void>((resolve) =>
      globalThis.setTimeout(resolve, Math.max(retryAfter, 500 * 2 ** attempt)),
    );
    const url = new URL(`${endpoint}/${operation}`);
    // 공식 Swagger가 오퍼레이션별로 서로 다른 대소문자를 지정하므로 각각 그대로 사용합니다.
    const authenticationName =
      operation === 'smallUpjongList' ? 'servicekey' : 'ServiceKey';
    Object.entries({
      ...parameters,
      type: 'json',
      [authenticationName]: key,
    }).forEach(([name, value]) => url.searchParams.set(name, value));
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < 2
        ) {
          const header = response.headers.get('retry-after');
          retryAfter = 0;
          if (header) {
            retryAfter = /^[0-9]+$/.test(header)
              ? Number(header) * 1000
              : Date.parse(header) - Date.now();
            // 과도한 대기를 무시하고 빠르게 재시도하면 서버의 제한을 악화시키므로 실패시킵니다.
            if (!Number.isFinite(retryAfter) || retryAfter > 60000)
              throw new CafeSourceError(
                '소진공 API 재시도 대기 시간을 확인하세요.',
              );
          }
          continue;
        }
        throw new CafeSourceError(`소진공 API HTTP 오류(${response.status})`);
      }
      if (!response.body)
        throw new CafeSourceError('소진공 API 응답 본문이 없습니다.');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > maxResponseBytes) {
          await reader.cancel();
          throw new CafeSourceError(
            '소진공 API 응답 크기 제한을 초과했습니다.',
          );
        }
        chunks.push(chunk.value);
      }
      let content: unknown;
      let decoded: string;
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(chunks),
        );
      } catch {
        throw new CafeSourceError('소진공 API UTF-8 응답이 올바르지 않습니다.');
      }
      try {
        content = JSON.parse(decoded);
      } catch {
        throw new CafeSourceError('소진공 API JSON 형식이 올바르지 않습니다.');
      }
      if (content && typeof content === 'object' && 'response' in content)
        content = content.response;
      const parsed = envelope.safeParse(content);
      if (!parsed.success)
        throw new CafeSourceError(
          '소진공 API 오류 또는 응답 형식 불일치입니다.',
        );
      return parsed.data;
    } catch (error) {
      if (error instanceof CafeSourceError) throw error;
      if (attempt === 2)
        throw new CafeSourceError(
          '소진공 API 요청 또는 제한 시간 초과로 수집에 실패했습니다.',
        );
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
  throw new CafeSourceError('소진공 API 요청에 실패했습니다.');
}

/**
 * 공식 업종 분류와 실제 인증 업소 응답을 매 실행 검증한 후 서울 전체 페이지를 수집합니다.
 * 모든 페이지를 확인하기 전에는 complete가 false이며, 호출 측은 이를 서비스 데이터로 게시하면 안 됩니다.
 */
export async function readCafeSource(
  options: CafeOptions,
  onRows: (rows: CafeRow[]) => Promise<void>,
): Promise<CafeSource> {
  return collectCafeSource(options, onRows, false);
}

/**
 * DB 없이 공식 분류와 첫 페이지 최대 5행만 확인합니다. 전체 목록 검증이나 게시 결과가 아니며,
 * 원본 행·체크섬 대신 인증정보 없는 검증 요약만 반환합니다.
 */
export async function probeCafeSource(options: CafeOptions) {
  const source = await collectCafeSource(options, async () => {}, true);
  return {
    mode: 'PROBE' as const,
    databaseChecked: false,
    fetchedRows: source.fetchedRows,
    validRows: source.validRows,
    rejectedRows: source.rejectedRows,
    reference: source.reference,
  };
}

/** 확인 모드와 게시 모드가 동일한 인증·응답·행 검증을 사용하도록 수집 범위만 구분합니다. */
async function collectCafeSource(
  options: CafeOptions,
  onRows: (rows: CafeRow[]) => Promise<void>,
  probe: boolean,
): Promise<CafeSource> {
  const requestedPageSize = probe ? 5 : pageSize;
  let fetchedRows = 0,
    validRows = 0,
    rejectedRows = 0;
  let reference: Record<string, unknown> = {
    endpoint: `${endpoint}/storeListInDong`,
    collection_mode: probe ? 'PROBE' : 'FULL_SEOUL',
    complete: false,
  };
  try {
    const validated = z
      .object({
        industryCode: z.string().regex(/^[A-Z0-9]{1,8}$/),
        // 소진공 소분류명과 KSIC 명칭은 별개입니다. 아래 명칭도 실제 분류·업소 응답과
        // 완전히 일치해야 하며, 후보 코드만으로 카페 업종을 확정하지 않습니다.
        industryName: z.string().regex(/^(?:카페|커피 ?전문점)$/),
        expectedRows: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
      })
      .safeParse(options);
    if (!validated.success)
      throw new CafeSourceError(
        '카페 소분류 코드와 카페·커피 전문점 명칭을 확인하세요.',
      );
    const key = process.env.SEMAS_API_KEY;
    if (!key || /\s/.test(key))
      throw new CafeSourceError(
        '환경변수 SEMAS_API_KEY에 Decoding 인증키를 설정하세요.',
      );
    const catalog = await request('smallUpjongList', {}, key);
    const classes = itemsOf(catalog.body.items);
    const classSchema = z.object({
      indsSclsCd: z.string().regex(/^[A-Z0-9]{1,8}$/),
      indsSclsNm: text,
      stdrDt: z
        .string()
        .regex(/^(?:[0-9]{8}|[0-9]{4}-[0-9]{2}-[0-9]{2})$/)
        .refine((value) => {
          const date = value.includes('-')
            ? value
            : `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
          const parsed = new Date(date);
          return (
            Number.isFinite(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === date
          );
        }),
    });
    const parsedClasses = classes.map((item) => classSchema.safeParse(item));
    if (parsedClasses.some((item) => !item.success))
      throw new CafeSourceError('공식 업종 분류 응답이 올바르지 않습니다.');
    const matches = parsedClasses.filter(
      (item) => item.success && item.data.indsSclsCd === options.industryCode,
    );
    if (
      matches.length !== 1 ||
      !matches[0]!.success ||
      matches[0]!.data.indsSclsNm !== options.industryName
    )
      throw new CafeSourceError(
        '공식 카페 업종 코드·명칭을 확인하지 못했습니다.',
      );
    const classificationDate = matches[0]!.data.stdrDt;
    const parameters = {
      divId: 'ctprvnCd',
      key: '11',
      indsSclsCd: options.industryCode,
      numOfRows: String(requestedPageSize),
    };
    reference = {
      ...reference,
      parameters,
      industry_code: options.industryCode,
      industry_name: options.industryName,
      classification_date: classificationDate,
      classification_verified: true,
    };
    const ids = new Set<string>();
    const hashes: Array<[string, string]> = [];
    let totalCount: number | undefined;
    let stdrYm: string | undefined;
    let pages = 0;
    do {
      const pageNo = pages + 1;
      if (pageNo > maxPages)
        throw new CafeSourceError('서울 전체 수집 페이지 제한을 초과했습니다.');
      const response = await request(
        'storeListInDong',
        { ...parameters, pageNo: String(pageNo) },
        key,
      );
      const metadata = z
        .object({ numOfRows: natural, pageNo: natural, totalCount: natural })
        .safeParse(response.body);
      if (
        !metadata.success ||
        metadata.data.pageNo !== pageNo ||
        metadata.data.numOfRows !== requestedPageSize ||
        !response.header.stdrYm
      )
        throw new CafeSourceError(
          'API 페이지 번호·건수·기준년월 검증에 실패했습니다.',
        );
      const currentTotal = metadata.data.totalCount;
      if (
        totalCount !== undefined &&
        (currentTotal !== totalCount || response.header.stdrYm !== stdrYm)
      )
        throw new CafeSourceError(
          '페이지 간 전체 건수 또는 기준년월이 변경되었습니다.',
        );
      totalCount = currentTotal;
      stdrYm = response.header.stdrYm;
      const items = itemsOf(response.body.items);
      fetchedRows += items.length;
      reference = { ...reference, pages: pageNo, totalCount, stdrYm };
      if (totalCount === 0 || totalCount > maxPages * pageSize)
        throw new CafeSourceError(
          '서울 전체 수집 건수가 비어 있거나 제한을 초과했습니다.',
        );
      if (
        options.expectedRows !== undefined &&
        options.expectedRows !== totalCount
      )
        throw new CafeSourceError('전체 건수가 --expected-rows와 다릅니다.');
      const expected = Math.min(
        requestedPageSize,
        totalCount - (pageNo - 1) * requestedPageSize,
      );
      if (items.length !== expected)
        throw new CafeSourceError(
          '페이지의 실제 행 수가 전체 건수와 다릅니다.',
        );
      const rows: CafeRow[] = [];
      for (const item of items) {
        const parsed = rawRow.safeParse(item);
        // 인증키가 서버의 값에 반사되어도 DB·오류에 저장하지 않습니다.
        const serialized = JSON.stringify(parsed.data);
        const normalizedPercent = serialized?.replace(
          /%[a-f0-9]{2}/gi,
          (value) => value.toUpperCase(),
        );
        const reflected =
          parsed.success &&
          [
            key,
            encodeURI(key),
            encodeURIComponent(key),
            new URLSearchParams({ key }).toString().slice(4),
          ].some((secret) => normalizedPercent.includes(secret));
        if (!parsed.success || reflected) {
          rejectedRows++;
          continue;
        }
        const raw = parsed.data;
        if (
          raw.indsSclsCd !== options.industryCode ||
          raw.indsSclsNm !== options.industryName
        ) {
          rejectedRows++;
          continue;
        }
        if (ids.has(raw.bizesId)) {
          rejectedRows++;
          throw new CafeSourceError('bizesId 중복이 발견되었습니다.');
        }
        ids.add(raw.bizesId);
        const row: CafeRow = {
          bizesId: raw.bizesId,
          storeName: raw.bizesNm,
          branchName: raw.brchNm,
          semasIndustryCode: raw.indsSclsCd,
          semasIndustryName: raw.indsSclsNm,
          ksicCode: raw.ksicCd,
          ksicName: raw.ksicNm,
          sourceDongCode: raw.adongCd,
          sourceDistrictCode: raw.signguCd,
          roadAddress: raw.rdnmAdr,
          lotAddress: raw.lnoAdr,
          longitude: raw.lon,
          latitude: raw.lat,
        };
        hashes.push([
          row.bizesId,
          createHash('sha256').update(JSON.stringify(row)).digest('hex'),
        ]);
        rows.push(row);
        validRows++;
      }
      if (rejectedRows)
        throw new CafeSourceError(
          '카페 필수값·업종·서울 범위·행정동·좌표 검증에 실패한 행이 있습니다.',
        );
      await onRows(rows);
      pages = pageNo;
      reference = { ...reference, pages, totalCount, stdrYm };
      if (probe) break;
    } while (fetchedRows < totalCount);
    if (!probe && (fetchedRows !== totalCount || validRows !== totalCount))
      throw new CafeSourceError('전체 수집 건수가 일치하지 않습니다.');
    // 행 순서와 JSON 필드 순서가 달라도 같은 의미의 원본은 같은 체크섬을 가집니다.
    hashes.sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const checksum = createHash('sha256')
      .update(
        JSON.stringify({
          stdrYm,
          classificationDate,
          industryCode: options.industryCode,
          industryName: options.industryName,
          hashes,
        }),
      )
      .digest('hex');
    reference = {
      ...reference,
      complete: !probe,
      fetched_rows: fetchedRows,
      valid_rows: validRows,
      rejected_rows: rejectedRows,
    };
    return { checksum, fetchedRows, validRows, rejectedRows, reference };
  } catch (error) {
    // 외부 응답·Zod 입력 전체는 절대 오류 이력에 넣지 않습니다. 콜백 오류도 DB 처리 실패로 요약합니다.
    const message =
      error instanceof CafeSourceError
        ? error.message
        : '카페 원본 수집 또는 스테이징에 실패했습니다.';
    throw new CafeSourceError(message, {
      fetchedRows,
      validRows,
      rejectedRows,
      reference,
    });
  }
}
