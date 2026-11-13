import { setTimeout as wait } from 'node:timers/promises';
import { z } from 'zod';
import {
  seoulOpenApiEndpoint,
  seoulOpenApiHttpOrigin,
  seoulOpenApiHttpsOrigins,
} from './config.js';

export const seoulStatPageSize = 1000;
export const seoulStatMaxRows = 1_000_000;
const statisticsServices = new Set([
  'VwsmAdstrdFlpopW',
  'VwsmSignguStorW',
  'VwsmSignguSelngW',
  'VwsmAdstrdStorW',
  'VwsmAdstrdSelngW',
]);
const maxResponseBytes = 4 * 1024 * 1024;
const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
const knownResultCodes = new Set([
  'INFO-100',
  'INFO-200',
  'ERROR-300',
  'ERROR-301',
  'ERROR-310',
  'ERROR-331',
  'ERROR-332',
  'ERROR-333',
  'ERROR-334',
  'ERROR-335',
  'ERROR-336',
  'ERROR-500',
  'ERROR-600',
  'ERROR-601',
]);

class SeoulOpenApiError extends Error {}

const objectSchema = z.record(z.string(), z.unknown());
const resultSchema = z.object({ RESULT: z.object({ CODE: z.string() }) });
function pageSchema(pageSize: number, maxRows: number) {
  return z.object({
    list_total_count: z
      .string()
      .regex(/^[1-9][0-9]*(?![\s\S])/)
      .transform(Number)
      .pipe(z.number().int().positive().max(maxRows)),
    row: z.array(objectSchema).max(pageSize),
  });
}

async function readBody(response: Response): Promise<string> {
  if (!response.body)
    throw new SeoulOpenApiError('서울시 Open API 응답 본문이 없습니다.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    // Content-Length가 없거나 압축된 응답에도 실제 읽은 바이트 제한을 적용합니다.
    if (bytes > maxResponseBytes) {
      void reader.cancel().catch(() => {});
      throw new SeoulOpenApiError(
        '서울시 Open API 응답 크기 제한을 초과했습니다.',
      );
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    throw new SeoulOpenApiError(
      '서울시 Open API 응답이 UTF-8 형식이 아닙니다.',
    );
  }
}

function parsePage(
  text: string,
  serviceName: string,
  schema: ReturnType<typeof pageSchema>,
) {
  let json: unknown;
  try {
    // Node 24의 숫자 토큰 원문을 사용해 안전한 정수 범위 밖 값과 소수 후행 0도 보존합니다.
    json = JSON.parse(
      text,
      (_key, value: unknown, context?: { source: string }) => {
        if (typeof value !== 'number') return value;
        if (!context?.source) throw new Error();
        return context.source;
      },
    );
  } catch {
    throw new SeoulOpenApiError(
      '서울시 Open API JSON 응답을 해석할 수 없습니다.',
    );
  }
  const root = objectSchema.safeParse(json);
  const service = root.data?.[serviceName];
  // 정상 응답은 서비스명으로 감싸고 오류는 최상위 RESULT로도 전달됩니다.
  const result = resultSchema.safeParse(service ?? root.data);
  if (!result.success)
    throw new SeoulOpenApiError(
      '서울시 Open API 응답 구조가 올바르지 않습니다.',
    );
  const code = result.data.RESULT.CODE;
  if (code !== 'INFO-000') {
    // 응답 MESSAGE와 미등록 코드는 요청 URL이나 민감정보를 포함할 수 있어 출력하지 않습니다.
    const detail = knownResultCodes.has(code) ? `(${code})` : '';
    throw new SeoulOpenApiError(`서울시 Open API 응답 오류${detail}입니다.`);
  }
  const page = schema.safeParse(service);
  if (!page.success)
    throw new SeoulOpenApiError(
      '서울시 Open API 전체 건수 또는 페이지 구조가 올바르지 않습니다.',
    );
  return page.data;
}

/** 페이지의 HTTP 요청과 본문 읽기에 같은 제한 시간을 적용하며 외부 예외 원문을 폐기합니다. */
async function requestPage(
  url: string,
  serviceName: string,
  schema: ReturnType<typeof pageSchema>,
) {
  for (let attempt = 0; ; attempt += 1) {
    let text: string;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        redirect: 'manual',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (attempt === 0 && retryableStatuses.has(response.status)) {
          const retryAfter = response.headers.get('retry-after');
          const delay =
            retryAfter === null
              ? 500
              : /^[0-9]+$/.test(retryAfter)
                ? Number(retryAfter) * 1000
                : Date.parse(retryAfter) - Date.now();
          if (!Number.isFinite(delay) || delay > 10_000)
            throw new SeoulOpenApiError(
              '서울시 Open API 재시도 대기 시간을 확인하세요.',
            );
          await wait(Math.max(500, delay));
          continue;
        }
        throw new SeoulOpenApiError(
          `서울시 Open API HTTP 오류(${response.status})입니다.`,
        );
      }
      text = await readBody(response);
    } catch (error) {
      if (error instanceof SeoulOpenApiError) throw error;
      if (attempt > 0)
        throw new SeoulOpenApiError(
          '서울시 Open API 연결 또는 제한 시간 초과로 수집에 실패했습니다.',
        );
      await wait(500);
      continue;
    }
    return parsePage(text, serviceName, schema);
  }
}

type CollectionOptions<Row> = {
  serviceName: string;
  allowInsecureHttp?: boolean;
  expectedRows?: number;
  parseRow: (value: Record<string, unknown>, rowNumber: number) => Row;
  rowKey: (row: Row) => string;
};

async function collectPages<Row>(
  options: CollectionOptions<Row>,
  statistics: boolean,
  onPage: (rows: Row[]) => Promise<void>,
) {
  const pageSize = statistics ? seoulStatPageSize : 100;
  const maxRows = statistics ? seoulStatMaxRows : 100_000;
  const schema = pageSchema(pageSize, maxRows);
  if (statistics && !statisticsServices.has(options.serviceName))
    throw new SeoulOpenApiError('지원하지 않는 서울시 통계 서비스입니다.');
  const apiKey = process.env.SEOUL_OPEN_API_KEY?.trim();
  if (!apiKey || apiKey.toLowerCase() === 'sample')
    throw new SeoulOpenApiError(
      'BLOCKED: 전체 수집용 SEOUL_OPEN_API_KEY가 필요합니다.',
    );
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(apiKey))
    throw new SeoulOpenApiError('SEOUL_OPEN_API_KEY 형식이 올바르지 않습니다.');
  const { serviceName, expectedRows, parseRow, rowKey } = options;
  const endpoint = seoulOpenApiEndpoint;
  const url = URL.parse(endpoint);
  // 원문 origin을 정확히 대조해 인증 URL을 만들기 전에 경로·쿼리·다른 목적지를 거부합니다.
  if (
    endpoint === seoulOpenApiHttpOrigin &&
    (statistics || serviceName === 'VwsmSignguFlpopW')
  ) {
    if (options.allowInsecureHttp !== true)
      throw new SeoulOpenApiError(
        'BLOCKED: 공식 HTTP 주소의 인증 요청에는 --allow-insecure-http가 필요합니다.',
      );
  } else if (
    url?.protocol !== 'https:' ||
    url.origin !== endpoint ||
    !seoulOpenApiHttpsOrigins.includes(endpoint)
  ) {
    throw new SeoulOpenApiError(
      'BLOCKED: 허용된 서울시 Open API 주소가 아닙니다.',
    );
  }
  const pageUrl = (start: number, end: number) =>
    `${endpoint}/${encodeURIComponent(apiKey)}/json/${encodeURIComponent(serviceName)}/${start}/${end}/`;
  let page = await requestPage(pageUrl(1, pageSize), serviceName, schema);
  const totalRows = page.list_total_count;
  if (expectedRows !== undefined && expectedRows !== totalRows)
    throw new SeoulOpenApiError(
      '예상 행 수와 서울시 Open API 전체 건수가 일치하지 않습니다.',
    );

  const keys = new Set<string>();
  for (let start = 1; start <= totalRows; start += pageSize) {
    const end = Math.min(totalRows, start + pageSize - 1);
    if (start > 1)
      page = await requestPage(pageUrl(start, end), serviceName, schema);
    if (page.list_total_count !== totalRows)
      throw new SeoulOpenApiError(
        '서울시 Open API 전체 건수가 수집 중 변경되었습니다.',
      );
    if (page.row.length !== end - start + 1)
      throw new SeoulOpenApiError(
        `서울시 Open API ${start}~${end} 구간의 행 수가 일치하지 않습니다.`,
      );
    const rows: Row[] = [];
    let normalizedBytes = 0;
    for (const [offset, value] of page.row.entries()) {
      const row = parseRow(value, start + offset);
      // 변조된 응답이 인증키를 정상 형식의 수치로 되돌려도 probe 표본에 노출하지 않습니다.
      const serialized = JSON.stringify(row);
      if (serialized?.includes(apiKey))
        throw new SeoulOpenApiError(
          '서울시 Open API 응답에 인증정보가 포함되어 있습니다.',
        );
      // 지수 정규화로 요청 본문보다 커질 수 있는 페이지에도 별도 상한을 둡니다.
      normalizedBytes += Buffer.byteLength(serialized ?? '');
      if (statistics && normalizedBytes > 16 * 1024 * 1024)
        throw new SeoulOpenApiError(
          '서울시 API 정규화 페이지 크기 제한을 초과했습니다.',
        );
      const key = rowKey(row);
      if (keys.has(key))
        throw new SeoulOpenApiError(
          `서울시 Open API ${start + offset}번째 행의 복합키가 중복되었습니다.`,
        );
      keys.add(key);
      rows.push(row);
    }
    await onPage(rows);
  }
  return { totalRows, pages: Math.ceil(totalRows / pageSize) };
}

/** OA-22179의 기존 전체 수집과 결과 계약을 유지합니다. */
export async function collectSeoulOpenApiRows<Row>(
  options: CollectionOptions<Row>,
) {
  const rows = new Map<string, Row>();
  const summary = await collectPages(options, false, async (page) => {
    for (const row of page) rows.set(options.rowKey(row), row);
  });
  return { rows, ...summary };
}

/** 5종 통계는 페이지 처리가 끝난 뒤 다음 요청을 보내고 전체 복합키만 메모리에 유지합니다. */
export function streamSeoulStatApiRows<Row>(
  options: CollectionOptions<Row>,
  onPage: (rows: Row[]) => Promise<void>,
) {
  return collectPages(options, true, onPage);
}
