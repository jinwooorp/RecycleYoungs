import { describe, expect, it } from 'vitest';
import { parseBoundaryArguments } from './index.js';
import { assertLocalDatabaseUrl } from './boundaries.js';

describe('boundary CLI', () => {
  it('shows help without database configuration', () => {
    expect(parseBoundaryArguments([])).toBeNull();
    expect(parseBoundaryArguments(['--help'])).toBeNull();
  });

  it('requires the caller to supply the input version counts', () => {
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
    'postgresql://localhost/db?host=db.example.com',
    'postgresql://localhost/db?hostaddr=192.0.2.1',
    'postgresql://localhost/db?service=production',
  ])('rejects a nonlocal database or host override: %s', (url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow();
  });
});
