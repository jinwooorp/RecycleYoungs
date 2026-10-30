import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { importBoundaries, type BoundaryOptions } from './boundaries.js';
import { createDatabasePool } from './database.js';
import { importIndustries, type IndustryOptions } from './industries.js';
import { importStoreStats, type StoreOptions } from './stores.js';

// 원본 버전별 기대 건수는 양의 안전한 정수로 제한합니다. 업종 수와 원본 행 수를 혼동하지 않습니다.
const count = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

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

// 다른 모듈이나 테스트에서 가져올 때는 실행하지 않고, CLI로 직접 호출했을 때만 적재합니다.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    let options: StoreOptions | IndustryOptions | BoundaryOptions | null;
    if (args[0] === 'stores') {
      options = parseStoreArguments(args);
    } else if (args[0] === 'industries') {
      options = parseIndustryArguments(args);
    } else {
      options = parseBoundaryArguments(args);
    }
    if (!options) {
      console.log(
        '사용법:\n  npm run dev -- boundaries --source /절대경로/경계.zip --expected-dongs 425 --expected-districts 25\n  npm run dev -- industries --source /절대경로/점포.csv --sales-source /절대경로/매출.csv --expected-industries 100\n  npm run dev -- stores --source /절대경로/점포.csv --expected-rows 211832\n.shp 입력은 같은 이름의 .dbf/.prj/.cpg가 필요합니다. 업종·점포 통계 입력은 CSV 또는 CSV 한 개를 담은 ZIP이며 --sales-source는 업종 명령의 선택 인자입니다. 건수는 입력 버전에 맞게 지정하세요.',
      );
    } else {
      const pool = createDatabasePool();
      try {
        let result;
        if ('expectedRows' in options) {
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
