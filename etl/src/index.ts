import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { importBoundaries, type BoundaryOptions } from './boundaries.js';
import { createDatabasePool } from './database.js';

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
  const count = z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .transform(Number)
    .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const options = parseBoundaryArguments(process.argv.slice(2));
    if (!options) {
      console.log(
        '사용법: npm run dev -- boundaries --source /절대경로/경계.zip --expected-dongs 425 --expected-districts 25\n.shp 입력은 같은 이름의 .dbf/.prj/.cpg가 필요합니다. 건수는 입력 버전에 맞게 지정하세요.',
      );
    } else {
      const pool = createDatabasePool();
      try {
        console.log(JSON.stringify(await importBoundaries(pool, options)));
      } finally {
        await pool.end();
      }
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : '경계 적재에 실패했습니다.',
    );
    process.exitCode = 1;
  }
}
