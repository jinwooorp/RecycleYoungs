import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { importBoundaries, type BoundaryOptions } from './boundaries.js';
import { createDatabasePool } from './database.js';
import { importIndustries, type IndustryOptions } from './industries.js';
import { importStoreStats, type StoreOptions } from './stores.js';
import { importSalesStats, type SalesOptions } from './sales.js';
import { importCafes, type CafeOptions } from './cafes.js';
import { probeCafeSource } from './cafe-source.js';
import { probeDistrictStoreSource } from './district-store-source.js';
import {
  probeDistrictSalesSource,
  type DistrictSalesProbeOptions,
} from './district-sales-source.js';
import {
  importDistrictStoreStats,
  type DistrictStoreOptions,
} from './district-stores.js';
import {
  importFootTrafficStats,
  type FootTrafficOptions,
} from './foot-traffic.js';

// 원본 버전별 기대 건수는 양의 안전한 정수로 제한합니다. 업종 수와 원본 행 수를 혼동하지 않습니다.
const count = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

/** 자치구 추정매출은 명시적 probe만 허용하며 모든 인자를 DB 분기 전에 검증한다. */
export function parseDistrictSalesArguments(
  args: string[],
): DistrictSalesProbeOptions | null {
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
  if (values.probe !== true)
    throw new Error(
      '자치구 추정매출은 --probe가 필수이며 적재를 지원하지 않습니다.',
    );
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
      probe: z.literal(true),
    })
    .safeParse({
      source: values.source,
      expectedRows: values['expected-rows'],
      probe: values.probe,
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

// 다른 모듈이나 테스트에서 가져올 때는 실행하지 않고, CLI로 직접 호출했을 때만 명령을 실행합니다.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    let options:
      | FootTrafficOptions
      | SalesOptions
      | StoreOptions
      | IndustryOptions
      | BoundaryOptions
      | (CafeOptions & { probe?: boolean })
      | (DistrictStoreOptions & { probe: boolean })
      | DistrictSalesProbeOptions
      | null;
    if (args[0] === 'district-sales') {
      options = parseDistrictSalesArguments(args);
    } else if (args[0] === 'district-stores') {
      options = parseDistrictStoreArguments(args);
    } else if (args[0] === 'cafes') {
      options = parseCafeArguments(args);
    } else if (args[0] === 'foot-traffic') {
      options = parseFootTrafficArguments(args);
    } else if (args[0] === 'sales') {
      options = parseSalesArguments(args);
    } else if (args[0] === 'stores') {
      options = parseStoreArguments(args);
    } else if (args[0] === 'industries') {
      options = parseIndustryArguments(args);
    } else {
      options = parseBoundaryArguments(args);
    }
    if (!options) {
      console.log(
        '사용법:\n  npm run dev -- cafes [--probe] --industry-code <공식 카페 코드> --industry-name <공식 명칭> [--expected-rows <전체 건수>]\n  npm run dev -- boundaries --source /절대경로/경계.zip --expected-dongs 425 --expected-districts 25\n  npm run dev -- industries --source /절대경로/점포.csv --sales-source /절대경로/매출.csv --expected-industries 100\n  npm run dev -- stores --source /절대경로/점포.csv --expected-rows 211832\n  npm run dev -- sales --source /절대경로/매출.csv --expected-rows 100431\n  npm run dev -- foot-traffic --source /절대경로/유동인구.csv --expected-rows 9350\n.shp 입력은 같은 이름의 .dbf/.prj/.cpg가 필요합니다. 업종·점포·추정매출·유동인구 입력은 CSV 또는 CSV 한 개를 담은 ZIP이며 --sales-source는 업종 명령의 선택 인자입니다. 건수는 입력 버전에 맞게 지정하세요.',
      );
      console.log(
        '  npm run dev -- district-stores [--probe] --source /절대경로/자치구점포.csv --expected-rows <원본 전체 행 수>\n자치구 점포는 CSV/단일 CSV ZIP을 적재하며 --probe에서는 DB 설정·접속·배치 생성·적재를 하지 않습니다.',
      );
      console.log(
        '  npm run dev -- district-sales --probe --source /절대경로/자치구매출.csv --expected-rows <원본 전체 행 수>\n자치구 추정매출은 읽기 전용 검증만 지원하며 --probe 생략 시 거부합니다. DB·배치·적재·네트워크 요청은 사용하지 않습니다.',
      );
    } else if (
      args[0] === 'district-sales' &&
      'source' in options &&
      'probe' in options &&
      options.probe
    ) {
      // 자치구 매출은 기존 점포 probe나 모든 DB 적재 분기에 진입하지 않는다.
      console.log(
        JSON.stringify(
          await probeDistrictSalesSource({ ...options, probe: true }),
        ),
      );
    } else if ('probe' in options && 'source' in options && options.probe) {
      // probe는 DB 설정 검증·풀 생성 분기에 진입하지 않는다.
      console.log(
        JSON.stringify(
          await probeDistrictStoreSource({ ...options, probe: true }),
        ),
      );
    } else if ('industryCode' in options && options.probe) {
      // 확인 모드는 DB 설정·연결 풀 생성 자체를 건너뛰므로 배치 이력도 만들지 않습니다.
      console.log(JSON.stringify(await probeCafeSource(options)));
    } else {
      const pool = createDatabasePool();
      try {
        let result;
        if (
          args[0] === 'district-stores' &&
          'source' in options &&
          'expectedRows' in options
        ) {
          result = await importDistrictStoreStats(pool, options);
        } else if ('industryCode' in options) {
          result = await importCafes(pool, options);
        } else if (args[0] === 'foot-traffic' && 'expectedRows' in options) {
          result = await importFootTrafficStats(pool, options);
        } else if (args[0] === 'sales' && 'expectedRows' in options) {
          result = await importSalesStats(pool, options);
        } else if ('expectedRows' in options) {
          result = await importStoreStats(pool, options);
        } else if ('expectedIndustries' in options) {
          result = await importIndustries(pool, options);
        } else {
          result = await importBoundaries(pool, options);
        }
        console.log(JSON.stringify(result));
      } finally {
        // 실패해도 연결 풀을 닫아 CLI 프로세스가 연결을 붙잡고 남지 않게 합니다.
        await pool.end();
      }
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'ETL 적재에 실패했습니다.',
    );
    process.exitCode = 1;
  }
}
