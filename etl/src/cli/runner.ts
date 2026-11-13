import {
  importBoundaries,
  type BoundaryOptions,
} from '../domains/boundaries/boundaries.js';
import { createDatabasePool } from '../common/database.js';
import {
  importIndustries,
  type IndustryOptions,
} from '../domains/industries/industries.js';
import {
  importStoreStats,
  type StoreOptions,
} from '../domains/stores/stores.js';
import { importSalesStats, type SalesOptions } from '../domains/sales/sales.js';
import { importCafes, type CafeOptions } from '../domains/cafes/cafes.js';
import { probeCafeSource } from '../domains/cafes/cafe-source.js';
import { probeDistrictStoreSource } from '../domains/stores/district-store-source.js';
import { probeDistrictSalesSource } from '../domains/sales/district-sales-source.js';
import { probeDistrictFootTrafficSource } from '../domains/foot-traffic/district-foot-traffic-source.js';
import { compareDistrictFootTrafficDatabase } from '../domains/foot-traffic/district-foot-traffic-db-comparison.js';
import {
  parseOfficialSourcesArguments,
  probeOfficialSources,
  type OfficialSourcesProbeOptions,
} from '../workflows/official-sources.js';
import {
  probeDistrictFootTrafficApi,
  type DistrictFootTrafficApiProbeOptions,
  type DistrictFootTrafficApiPublishOptions,
} from '../domains/foot-traffic/district-foot-traffic-api.js';
import {
  importDistrictFootTrafficApi,
  importDistrictFootTrafficStats,
  type DistrictFootTrafficOptions,
} from '../domains/foot-traffic/district-foot-traffic.js';
import {
  importDistrictSalesStats,
  type DistrictSalesOptions,
} from '../domains/sales/district-sales.js';
import {
  importDistrictStoreStats,
  type DistrictStoreOptions,
} from '../domains/stores/district-stores.js';
import {
  importFootTrafficStats,
  type FootTrafficOptions,
} from '../domains/foot-traffic/foot-traffic.js';
import {
  parseDistrictFootTrafficArguments,
  parseDistrictSalesArguments,
  parseDistrictStoreArguments,
  parseCafeArguments,
  parseBoundaryArguments,
  parseStoreArguments,
  parseSalesArguments,
  parseFootTrafficArguments,
  parseIndustryArguments,
} from './arguments.js';
import { printHelp } from './help.js';

/** CLI 인자를 검증한 뒤 선택된 도움말·probe·적재를 실행합니다. */
export async function runCli(args: string[]): Promise<void> {
  try {
    let options:
      | (DistrictFootTrafficOptions & { probe: boolean; compareDb?: boolean })
      | OfficialSourcesProbeOptions
      | DistrictFootTrafficApiProbeOptions
      | DistrictFootTrafficApiPublishOptions
      | FootTrafficOptions
      | SalesOptions
      | StoreOptions
      | IndustryOptions
      | BoundaryOptions
      | (CafeOptions & { probe?: boolean })
      | (DistrictStoreOptions & { probe: boolean })
      | (DistrictSalesOptions & { probe: boolean })
      | null;
    if (args[0] === 'official-sources') {
      options = parseOfficialSourcesArguments(args.slice(1));
    } else if (args[0] === 'district-foot-traffic') {
      options = parseDistrictFootTrafficArguments(args);
    } else if (args[0] === 'district-sales') {
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
      printHelp();
    } else if ('manifest' in options) {
      const result = await probeOfficialSources(options.manifest);
      console.log(JSON.stringify(result));
      if (result.status === 'FAIL') process.exitCode = 1;
    } else if ('api' in options && 'probe' in options) {
      const result = await probeDistrictFootTrafficApi(options);
      const dbComparison =
        options.compareDb && options.compareCsv && result.csvComparison
          ? await compareDistrictFootTrafficDatabase(
              options.compareCsv,
              result.csvComparison.csvSha256,
            )
          : undefined;
      console.log(
        JSON.stringify(
          dbComparison
            ? { ...result, databaseChecked: true, dbComparison }
            : result,
        ),
      );
    } else if (
      args[0] === 'district-foot-traffic' &&
      'source' in options &&
      'probe' in options &&
      options.probe
    ) {
      const result = await probeDistrictFootTrafficSource({
        ...options,
        probe: true,
      });
      const dbComparison =
        'compareDb' in options && options.compareDb
          ? await compareDistrictFootTrafficDatabase(
              options.source,
              result.checksum,
            )
          : undefined;
      console.log(
        JSON.stringify(
          dbComparison
            ? { ...result, databaseChecked: true, dbComparison }
            : result,
        ),
      );
    } else if (
      args[0] === 'district-sales' &&
      'source' in options &&
      'probe' in options &&
      options.probe
    ) {
      // 자치구 매출 probe는 기존 점포 probe와 DB 적재 분기에 진입하지 않는다.
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
        if ('publish' in options) {
          result = await importDistrictFootTrafficApi(pool, options);
        } else if (
          args[0] === 'district-foot-traffic' &&
          'source' in options &&
          'expectedRows' in options
        ) {
          result = await importDistrictFootTrafficStats(pool, options);
        } else if (
          args[0] === 'district-sales' &&
          'source' in options &&
          'expectedRows' in options
        ) {
          result = await importDistrictSalesStats(pool, options);
        } else if (
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
