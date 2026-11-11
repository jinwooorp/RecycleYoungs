import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { BoundaryOptions } from '../domains/boundaries/boundaries.js';
import type { CafeOptions } from '../domains/cafes/cafes.js';
import type { DistrictFootTrafficApiProbeOptions } from '../domains/foot-traffic/district-foot-traffic-api.js';
import type { DistrictFootTrafficOptions } from '../domains/foot-traffic/district-foot-traffic.js';
import type { FootTrafficOptions } from '../domains/foot-traffic/foot-traffic.js';
import type { IndustryOptions } from '../domains/industries/industries.js';
import type { DistrictSalesOptions } from '../domains/sales/district-sales.js';
import type { SalesOptions } from '../domains/sales/sales.js';
import type { DistrictStoreOptions } from '../domains/stores/district-stores.js';
import type { StoreOptions } from '../domains/stores/stores.js';

// 원본 버전별 기대 건수는 양의 안전한 정수로 제한합니다. 업종 수와 원본 행 수를 혼동하지 않습니다.
const count = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

/** 자치구 길단위인구의 적재·probe 인자를 파일·DB 처리 전에 검증합니다. */
export function parseDistrictFootTrafficArguments(
  args: string[],
):
  | (DistrictFootTrafficOptions & { probe: boolean })
  | DistrictFootTrafficApiProbeOptions
  | null {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      tokens: true,
      options: {
        source: { type: 'string' },
        'expected-rows': { type: 'string' },
        probe: { type: 'boolean' },
        api: { type: 'boolean' },
        'compare-csv': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch {
    // parseArgs 원문에는 알 수 없는 옵션 값이 포함될 수 있으므로 고정 메시지를 사용한다.
    throw new Error(
      '자치구 길단위인구 실행 인자가 올바르지 않습니다. --help를 확인하세요.',
    );
  }
  const { values, positionals, tokens } = parsed;
  if (values.help || args.length === 0) return null;
  if (positionals.length !== 1 || positionals[0] !== 'district-foot-traffic')
    throw new Error(
      '지원 명령은 district-foot-traffic입니다. --help를 확인하세요.',
    );
  for (const name of [
    'source',
    'expected-rows',
    'probe',
    'api',
    'compare-csv',
  ]) {
    if (
      tokens.filter((token) => token.kind === 'option' && token.name === name)
        .length > 1
    )
      throw new Error('자치구 길단위인구 옵션은 중복해서 전달할 수 없습니다.');
  }
  const sourcePath = z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0);
  const expectedRows = z
    .string()
    .regex(/^[1-9][0-9]*(?![\s\S])/)
    .pipe(count);
  if (values.api) {
    if (!values.probe || values.source !== undefined)
      throw new Error(
        '서울시 API는 --api --probe로만 검증하며 --source 대신 --compare-csv를 사용하세요.',
      );
    const apiOptions = z
      .object({
        expectedRows: expectedRows.optional(),
        compareCsv: sourcePath.optional(),
      })
      .safeParse({
        expectedRows: values['expected-rows'],
        compareCsv: values['compare-csv'],
      });
    if (!apiOptions.success)
      throw new Error(
        '자치구 길단위인구 API 예상 행 수 또는 비교 CSV 경로가 올바르지 않습니다.',
      );
    return { api: true, probe: true, ...apiOptions.data };
  }
  if (values['compare-csv'] !== undefined)
    throw new Error('--compare-csv는 --api --probe와 함께 사용하세요.');
  const options = z
    .object({
      source: sourcePath,
      expectedRows,
      probe: z.boolean(),
    })
    .safeParse({
      source: values.source,
      expectedRows: values['expected-rows'],
      probe: values.probe ?? false,
    });
  if (!options.success)
    throw new Error(
      '자치구 길단위인구 원본 경로와 양의 안전한 정수인 예상 행 수가 필요합니다.',
    );
  return options.data;
}

/** 자치구 추정매출 적재·probe의 모든 인자를 DB 분기 전에 검증한다. */
export function parseDistrictSalesArguments(
  args: string[],
): (DistrictSalesOptions & { probe: boolean }) | null {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      tokens: true,
      options: {
        source: { type: 'string' },
        'expected-rows': { type: 'string' },
        probe: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch {
    // parseArgs 원문에는 알 수 없는 옵션 값이 포함될 수 있으므로 고정 메시지를 사용한다.
    throw new Error(
      '자치구 추정매출 실행 인자가 올바르지 않습니다. --help를 확인하세요.',
    );
  }
  const { values, positionals, tokens } = parsed;
  if (values.help || args.length === 0) return null;
  if (positionals.length !== 1 || positionals[0] !== 'district-sales')
    throw new Error('지원 명령은 district-sales입니다. --help를 확인하세요.');
  for (const name of ['source', 'expected-rows', 'probe']) {
    if (
      tokens.filter((token) => token.kind === 'option' && token.name === name)
        .length > 1
    )
      throw new Error('자치구 추정매출 옵션은 중복해서 전달할 수 없습니다.');
  }
  const options = z
    .object({
      source: z
        .string()
        .min(1)
        .refine((value) => value.trim().length > 0),
      expectedRows: z
        .string()
        .regex(/^[1-9][0-9]*(?![\s\S])/)
        .pipe(count),
      probe: z.boolean(),
    })
    .safeParse({
      source: values.source,
      expectedRows: values['expected-rows'],
      probe: values.probe ?? false,
    });
  if (!options.success)
    throw new Error(
      '자치구 추정매출 원본 경로와 양의 안전한 정수인 예상 행 수가 필요합니다.',
    );
  return options.data;
}

/** 같은 입력 계약으로 적재와 읽기 전용 probe를 명시적으로 구분합니다. */
export function parseDistrictStoreArguments(
  args: string[],
): (DistrictStoreOptions & { probe: boolean }) | null {
  const { values, positionals, tokens } = parseArgs({
    args,
    allowPositionals: true,
    tokens: true,
    options: {
      source: { type: 'string' },
      'expected-rows': { type: 'string' },
      probe: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || args.length === 0) return null;
  if (positionals.length !== 1 || positionals[0] !== 'district-stores')
    throw new Error('지원 명령은 district-stores입니다. --help를 확인하세요.');
  for (const name of ['source', 'expected-rows', 'probe']) {
    if (
      tokens.filter((token) => token.kind === 'option' && token.name === name)
        .length > 1
    )
      throw new Error('자치구 점포 옵션은 중복해서 전달할 수 없습니다.');
  }
  return z
    .object({
      source: z
        .string()
        .min(1)
        .refine((value) => value.trim().length > 0),
      expectedRows: z
        .string()
        .regex(/^[1-9][0-9]*(?![\s\S])/)
        .pipe(count),
      probe: z.boolean(),
    })
    .parse({
      source: values.source,
      expectedRows: values['expected-rows'],
      probe: values.probe ?? false,
    });
}

/** 인증정보는 CLI로 받지 않고 검증 대상 분류와 선택적인 전체 건수만 받습니다. */
export function parseCafeArguments(
  args: string[],
): (CafeOptions & { probe?: boolean }) | null {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'industry-code': { type: 'string' },
      'industry-name': { type: 'string' },
      probe: { type: 'boolean' },
      'expected-rows': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || args.length === 0) return null;
  if (positionals.length !== 1 || positionals[0] !== 'cafes')
    throw new Error('지원 명령은 cafes입니다. --help를 확인하세요.');
  return z
    .object({
      industryCode: z.string().regex(/^[A-Z0-9]{1,8}$/),
      industryName: z.string().trim().min(1),
      expectedRows: count.optional(),
      probe: z.boolean().optional(),
    })
    .parse({
      industryCode: values['industry-code'],
      industryName: values['industry-name'],
      expectedRows: values['expected-rows'],
      ...(values.probe ? { probe: true } : {}),
    });
}

/** CLI 인자를 적재 옵션으로 변환하며, 인자가 없거나 도움말을 요청하면 null을 반환합니다. */
export function parseBoundaryArguments(args: string[]): BoundaryOptions | null {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      source: { type: 'string' },
      'expected-dongs': { type: 'string' },
      'expected-districts': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || args.length === 0) return null;
  if (positionals.length !== 1 || positionals[0] !== 'boundaries') {
    throw new Error('지원 명령은 boundaries입니다. --help를 확인하세요.');
  }
  // 425·25를 고정하지 않고 입력 버전의 기대 건수를 받습니다. 소수·음수·정밀도 손실은 거부합니다.
  return z
    .object({
      source: z.string().min(1),
      expectedDongs: count,
      expectedDistricts: count,
    })
    .parse({
      source: values.source,
      expectedDongs: values['expected-dongs'],
      expectedDistricts: values['expected-districts'],
    });
}

/** 점포 통계는 입력 파일 버전의 전체 행 수를 필수 검증 기준으로 받습니다. */
export function parseStoreArguments(args: string[]): StoreOptions | null {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      source: { type: 'string' },
      'expected-rows': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || args.length === 0) return null;
  if (positionals.length !== 1 || positionals[0] !== 'stores')
    throw new Error('지원 명령은 stores입니다. --help를 확인하세요.');
  return z
    .object({ source: z.string().min(1), expectedRows: count })
    .parse({ source: values.source, expectedRows: values['expected-rows'] });
}

/** 추정매출 원본의 경로와 입력 버전별 전체 행 수를 검증합니다. */
export function parseSalesArguments(args: string[]): SalesOptions | null {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      source: { type: 'string' },
      'expected-rows': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || args.length === 0) return null;
  if (positionals.length !== 1 || positionals[0] !== 'sales')
    throw new Error('지원 명령은 sales입니다. --help를 확인하세요.');
  return z
    .object({ source: z.string().min(1), expectedRows: count })
    .parse({ source: values.source, expectedRows: values['expected-rows'] });
}

/** 유동인구 원본의 경로와 입력 버전별 전체 행 수를 검증합니다. */
export function parseFootTrafficArguments(
  args: string[],
): FootTrafficOptions | null {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      source: { type: 'string' },
      'expected-rows': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || args.length === 0) return null;
  if (positionals.length !== 1 || positionals[0] !== 'foot-traffic')
    throw new Error('지원 명령은 foot-traffic입니다. --help를 확인하세요.');
  return z
    .object({ source: z.string().min(1), expectedRows: count })
    .parse({ source: values.source, expectedRows: values['expected-rows'] });
}

/** 점포 CSV를 필수 원본으로 받고 매출 원본은 선택적으로 교차 검증합니다. */
export function parseIndustryArguments(args: string[]): IndustryOptions | null {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      source: { type: 'string' },
      'sales-source': { type: 'string' },
      'expected-industries': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || args.length === 0) return null;
  if (positionals.length !== 1 || positionals[0] !== 'industries') {
    throw new Error('지원 명령은 industries입니다. --help를 확인하세요.');
  }
  return z
    .object({
      source: z.string().min(1),
      salesSource: z.string().min(1).optional(),
      expectedIndustries: count,
    })
    .parse({
      source: values.source,
      salesSource: values['sales-source'],
      expectedIndustries: values['expected-industries'],
    });
}
