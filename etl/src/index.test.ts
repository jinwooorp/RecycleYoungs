import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  parseBoundaryArguments,
  parseCafeArguments,
  parseFootTrafficArguments,
  parseIndustryArguments,
  parseSalesArguments,
  parseStoreArguments,
} from './index.js';
import { assertLocalDatabaseUrl } from './boundaries.js';

// 실제 진입점을 실행해 명령별 전용 옵션이 올바른 파서에 전달되는지 확인합니다.
describe('CLI dispatch', () => {
  it('자치구 점포 probe 도움말은 DB 없이 전용 명령을 안내한다', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/index.ts',
        'district-stores',
        '--probe',
        '--help',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: 'invalid-database-url' },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('district-stores [--probe]');
    expect(result.stderr).toBe('');
  });

  it.each([
    ['boundaries', '--expected-dongs', '1', '--expected-districts', '1'],
    ['industries', '--expected-industries', '1'],
    ['stores', '--expected-rows', '1'],
    ['sales', '--expected-rows', '1'],
    ['foot-traffic', '--expected-rows', '1'],
  ])(
    'dispatches %s before showing help without opening a DB connection',
    (...args) => {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'src/index.ts',
          ...args,
          '--source',
          'unused.csv',
          '--help',
        ],
        { encoding: 'utf8', env: { ...process.env, DATABASE_URL: undefined } },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('사용법:');
      expect(result.stderr).toBe('');
    },
  );
});

describe('카페 수집 CLI', () => {
  it('확인 전용 probe를 명시적으로 선택한다', () => {
    expect(
      parseCafeArguments([
        'cafes',
        '--probe',
        '--industry-code',
        'I21201',
        '--industry-name',
        '카페',
      ]),
    ).toMatchObject({
      probe: true,
      industryCode: 'I21201',
      industryName: '카페',
    });
  });

  it('probe는 잘못된 DB 설정이 있어도 인증키 검사까지 DB 없이 진행한다', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/index.ts',
        'cafes',
        '--probe',
        '--industry-code',
        'I21201',
        '--industry-name',
        '카페',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: 'invalid-database-url',
          SEMAS_API_KEY: undefined,
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SEMAS_API_KEY');
    expect(result.stderr).not.toContain('DATABASE_URL');
  });

  it('probe CLI는 모의 인증 응답을 DB 없이 확인하고 첫 페이지에서 종료한다', () => {
    // 메모리 내 preload로 fetch만 대체합니다. DB 설정이 잘못되어도 성공해야 하며,
    // 두 번째 업소 페이지를 요청하면 실패하게 해 전체 수집으로 넘어가는 회귀를 잡습니다.
    const mock = `globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/smallUpjongList')) return Response.json({
        header: { resultCode: '00' }, body: { items: [{ indsSclsCd: 'I21201', indsSclsNm: '카페', stdrDt: '2026-10-01' }] }
      });
      if (url.searchParams.get('pageNo') !== '1' || url.searchParams.get('numOfRows') !== '5') throw new Error('unexpected page');
      return Response.json({ header: { resultCode: '00', stdrYm: '202610' }, body: {
        numOfRows: 5, pageNo: 1, totalCount: 1001,
        items: Array.from({ length: 5 }, (_, i) => ({ bizesId: String(i), bizesNm: '모의 카페', indsSclsCd: 'I21201', indsSclsNm: '카페', ctprvnCd: '11', signguCd: '11110' }))
      }});
    };`;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(mock)}`,
        '--import',
        'tsx',
        'src/index.ts',
        'cafes',
        '--probe',
        '--industry-code',
        'I21201',
        '--industry-name',
        '카페',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: 'invalid-database-url',
          SEMAS_API_KEY: 'synthetic-probe-key/+==',
        },
        timeout: 10000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: 'PROBE',
      databaseChecked: false,
      fetchedRows: 5,
      reference: { complete: false, pages: 1, totalCount: 1001 },
    });
    expect(result.stdout).not.toContain('synthetic-probe-key');
  });
  it('분류 검증 대상 코드와 명칭을 받으며 예상 전체 건수는 선택한다', () => {
    expect(
      parseCafeArguments([
        'cafes',
        '--industry-code',
        'I21201',
        '--industry-name',
        '커피전문점',
      ]),
    ).toEqual({ industryCode: 'I21201', industryName: '커피전문점' });
    expect(
      parseCafeArguments([
        'cafes',
        '--industry-code',
        'I21201',
        '--industry-name',
        '커피전문점',
        '--expected-rows',
        '2',
      ]),
    ).toMatchObject({ expectedRows: 2 });
  });

  it('인증키 CLI 인자와 분류 누락·잘못된 건수를 거부한다', () => {
    for (const args of [
      [],
      ['--expected-rows', '0'],
      ['--api-key', 'never-a-real-key'],
    ]) {
      expect(() => parseCafeArguments(['cafes', ...args])).toThrow();
    }
    expect(parseCafeArguments(['cafes', '--help'])).toBeNull();
  });

  it.each(['', '0', '-1', '1.5', '9007199254740992'])(
    '잘못된 예상 전체 건수 %s를 거부한다',
    (value) => {
      expect(() =>
        parseCafeArguments([
          'cafes',
          '--industry-code',
          'I21201',
          '--industry-name',
          '커피전문점',
          '--expected-rows',
          value,
        ]),
      ).toThrow();
    },
  );

  it('카페 도움말은 DB와 인증키 없이 표시한다', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/index.ts', 'cafes', '--help'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: undefined,
          SEMAS_API_KEY: undefined,
        },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('cafes [--probe]');
    expect(result.stderr).toBe('');
  });
});

// 명령 해석과 DB 주소 제한만 검사하며 실제 파일 적재나 DB 접속은 수행하지 않습니다.
describe('boundary CLI', () => {
  it('shows help without database configuration', () => {
    expect(parseBoundaryArguments([])).toBeNull();
    expect(parseBoundaryArguments(['--help'])).toBeNull();
  });

  it('requires the caller to supply the input version counts', () => {
    // 다른 버전의 행정동 수를 허용해야 하므로 425 외의 건수도 입력할 수 있어야 합니다.
    expect(() =>
      parseBoundaryArguments(['boundaries', '--source', 'a.zip']),
    ).toThrow();
    expect(
      parseBoundaryArguments([
        'boundaries',
        '--source',
        'a.zip',
        '--expected-dongs',
        '425',
        '--expected-districts',
        '25',
      ]),
    ).toEqual({ source: 'a.zip', expectedDongs: 425, expectedDistricts: 25 });
    expect(
      parseBoundaryArguments([
        'boundaries',
        '--source',
        'next.shp',
        '--expected-dongs',
        '426',
        '--expected-districts',
        '25',
      ]),
    ).toMatchObject({ expectedDongs: 426 });
  });

  it.each(['0', '-1', '1.5', 'not-a-count'])(
    'rejects invalid expected counts: %s',
    (count) => {
      expect(() =>
        parseBoundaryArguments([
          'boundaries',
          '--source',
          'a.zip',
          '--expected-dongs',
          count,
          '--expected-districts',
          '25',
        ]),
      ).toThrow();
    },
  );

  it.each([
    'postgresql://user:pass@127.0.0.1:5432/db',
    'postgresql://user:pass@localhost/db',
    'postgresql://user:pass@[::1]/db',
  ])('allows a loopback database: %s', (url) => {
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    'postgresql://user:pass@db.example.com/db',
    // hostname이 localhost여도 쿼리 매개변수로 실제 접속 호스트를 바꾸는 우회는 거부합니다.
    'postgresql://localhost/db?host=db.example.com',
    'postgresql://localhost/db?hostaddr=192.0.2.1',
    'postgresql://localhost/db?service=production',
  ])('rejects a nonlocal database or host override: %s', (url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow();
  });
});

// 고유 업종 수는 원본 행 수와 다르며, 입력 버전에 맞는 기준을 명시해야 합니다.
describe('industry CLI', () => {
  it('accepts stores and optional sales with a version-specific unique count', () => {
    expect(
      parseIndustryArguments([
        'industries',
        '--source',
        'stores.zip',
        '--sales-source',
        'sales.csv',
        '--expected-industries',
        '101',
      ]),
    ).toEqual({
      source: 'stores.zip',
      salesSource: 'sales.csv',
      expectedIndustries: 101,
    });
    expect(
      parseIndustryArguments([
        'industries',
        '--source',
        'stores.csv',
        '--expected-industries',
        '2',
      ]),
    ).toEqual({ source: 'stores.csv', expectedIndustries: 2 });
  });

  it.each([undefined, '0', '-1', '1.5', '9007199254740992'])(
    'rejects a missing or invalid unique count: %s',
    (count) => {
      const args = ['industries', '--source', 'stores.csv'];
      if (count !== undefined) args.push('--expected-industries', count);
      expect(() => parseIndustryArguments(args)).toThrow();
    },
  );

  it('does not accept boundary-specific or misspelled options', () => {
    expect(() =>
      parseIndustryArguments(['industries', '--expected-dongs', '425']),
    ).toThrow();
    expect(() =>
      parseIndustryArguments(['other', '--source', 'a.csv']),
    ).toThrow();
    expect(parseIndustryArguments(['--help'])).toBeNull();
  });
});

// 전체 행 수는 입력 버전에 맞춰 지정하며 업종 수나 행정동 수로 대신하지 않습니다.
describe('store statistics CLI', () => {
  it('requires the input path and a version-specific expected row count', () => {
    expect(
      parseStoreArguments([
        'stores',
        '--source',
        'stores.zip',
        '--expected-rows',
        '211832',
      ]),
    ).toEqual({ source: 'stores.zip', expectedRows: 211832 });
    expect(
      parseStoreArguments([
        'stores',
        '--source',
        'next.csv',
        '--expected-rows',
        '3',
      ]),
    ).toEqual({ source: 'next.csv', expectedRows: 3 });
    expect(() =>
      parseStoreArguments(['stores', '--expected-rows', '3']),
    ).toThrow();
    expect(() =>
      parseStoreArguments(['stores', '--source', 'a.csv']),
    ).toThrow();
  });

  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992'])(
    'rejects invalid expected rows: %s',
    (count) => {
      expect(() =>
        parseStoreArguments([
          'stores',
          '--source',
          'a.csv',
          '--expected-rows',
          count,
        ]),
      ).toThrow();
    },
  );

  it('rejects options belonging to other import commands and supports help', () => {
    expect(() =>
      parseStoreArguments(['stores', '--expected-industries', '100']),
    ).toThrow();
    expect(() => parseStoreArguments(['unknown'])).toThrow();
    expect(parseStoreArguments(['--help'])).toBeNull();
    expect(parseStoreArguments([])).toBeNull();
  });
});

describe('sales statistics CLI', () => {
  it('accepts version-specific source counts instead of fixing the current row count', () => {
    expect(
      parseSalesArguments([
        'sales',
        '--source',
        'sales.zip',
        '--expected-rows',
        '100431',
      ]),
    ).toEqual({ source: 'sales.zip', expectedRows: 100431 });
    expect(
      parseSalesArguments([
        'sales',
        '--source',
        'next.csv',
        '--expected-rows',
        '2',
      ]),
    ).toEqual({ source: 'next.csv', expectedRows: 2 });
    expect(() =>
      parseSalesArguments(['sales', '--source', 'sales.csv']),
    ).toThrow();
    expect(() =>
      parseSalesArguments(['sales', '--expected-rows', '2']),
    ).toThrow();
  });

  it.each(['0', '-1', '1.1', 'NaN', '9007199254740992'])(
    'rejects invalid expected rows: %s',
    (count) => {
      expect(() =>
        parseSalesArguments([
          'sales',
          '--source',
          'sales.csv',
          '--expected-rows',
          count,
        ]),
      ).toThrow();
    },
  );

  it('supports help and rejects foreign command options', () => {
    expect(parseSalesArguments([])).toBeNull();
    expect(parseSalesArguments(['--help'])).toBeNull();
    expect(() =>
      parseSalesArguments(['sales', '--expected-industries', '63']),
    ).toThrow();
    expect(() => parseSalesArguments(['unknown'])).toThrow();
  });
});

describe('유동인구 통계 CLI', () => {
  it('입력 버전별 경로와 전체 행 수를 받고 현재 원본 건수를 고정하지 않는다', () => {
    expect(
      parseFootTrafficArguments([
        'foot-traffic',
        '--source',
        'population.zip',
        '--expected-rows',
        '9350',
      ]),
    ).toEqual({ source: 'population.zip', expectedRows: 9350 });
    expect(
      parseFootTrafficArguments([
        'foot-traffic',
        '--source',
        'next.csv',
        '--expected-rows',
        '2',
      ]),
    ).toEqual({ source: 'next.csv', expectedRows: 2 });
    expect(() =>
      parseFootTrafficArguments(['foot-traffic', '--source', 'population.csv']),
    ).toThrow();
    expect(() =>
      parseFootTrafficArguments(['foot-traffic', '--expected-rows', '2']),
    ).toThrow();
  });

  it.each(['0', '-1', '1.1', 'NaN', '9007199254740992'])(
    '잘못된 예상 행 수 %s를 거부한다',
    (count) => {
      expect(() =>
        parseFootTrafficArguments([
          'foot-traffic',
          '--source',
          'population.csv',
          '--expected-rows',
          count,
        ]),
      ).toThrow();
    },
  );

  it('DB 설정 없이 도움말을 표시하고 다른 명령의 옵션은 거부한다', () => {
    expect(parseFootTrafficArguments([])).toBeNull();
    expect(parseFootTrafficArguments(['--help'])).toBeNull();
    expect(() =>
      parseFootTrafficArguments([
        'foot-traffic',
        '--expected-industries',
        '100',
      ]),
    ).toThrow();
    expect(() => parseFootTrafficArguments(['unknown'])).toThrow();
  });
});
