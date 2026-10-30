import { describe, expect, it } from 'vitest';
import {
  parseBoundaryArguments,
  parseIndustryArguments,
  parseStoreArguments,
} from './index.js';
import { assertLocalDatabaseUrl } from './boundaries.js';

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
