import { parseArgs } from 'node:util';
import { seoulStatMaxRows } from '../common/seoul-open-api.js';
import type { SeoulStatApiOptions } from '../workflows/seoul-stat-api.js';

export function parseSeoulStatArguments(
  args: string[],
): (SeoulStatApiOptions & { publish: boolean }) | null {
  try {
    const { values, tokens } = parseArgs({
      args,
      tokens: true,
      options: {
        api: { type: 'boolean' },
        probe: { type: 'boolean' },
        publish: { type: 'boolean' },
        'allow-insecure-http': { type: 'boolean' },
        'expected-rows': { type: 'string' },
        'compare-csv': { type: 'string' },
        'csv-period': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) return null;
    const names = tokens.flatMap((token) =>
      token.kind === 'option' ? [token.name] : [],
    );
    const count = values['expected-rows'] ?? '';
    const expectedRows = Number(count);
    const compareCsv = values['compare-csv'];
    if (
      !values.api ||
      Boolean(values.probe) === Boolean(values.publish) ||
      names.length !== new Set(names).size ||
      !/^[1-9][0-9]*(?![\s\S])/.test(count) ||
      expectedRows > seoulStatMaxRows ||
      (compareCsv !== undefined && !compareCsv.trim()) ||
      ((values.publish || values['csv-period']) && !compareCsv)
    )
      throw new Error();
    return {
      publish: values.publish ?? false,
      expectedRows,
      compareCsv,
      csvPeriod: values['csv-period'],
      allowInsecureHttp: values['allow-insecure-http'],
    };
  } catch {
    // 인자 오류에 전달된 파일 경로와 원문을 남기지 않습니다.
    throw new Error(
      '서울시 통계 API에는 --api, --probe 또는 --publish 중 하나, --expected-rows(1~1000000)가 필요합니다. --publish와 --csv-period에는 --compare-csv를 함께 지정하세요.',
    );
  }
}
