import { describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from './config.js';

// 실제 DB 없이 URL·기본값·숫자 변환과 잘못된 환경변수 거부를 확인합니다.
describe('loadDatabaseConfig', () => {
  it('provides pool limits for a valid PostgreSQL URL', () => {
    expect(
      loadDatabaseConfig({
        DATABASE_URL: 'postgresql://localhost/recycleyoungs',
      }),
    ).toEqual({
      DATABASE_URL: 'postgresql://localhost/recycleyoungs',
      DB_POOL_MAX: 10,
      DB_CONNECTION_TIMEOUT_MS: 5000,
    });
  });

  it('accepts the postgres scheme and converts numeric environment values', () => {
    expect(
      loadDatabaseConfig({
        DATABASE_URL: 'postgres://localhost/recycleyoungs',
        DB_POOL_MAX: '3',
        DB_CONNECTION_TIMEOUT_MS: '1200',
      }),
    ).toEqual({
      DATABASE_URL: 'postgres://localhost/recycleyoungs',
      DB_POOL_MAX: 3,
      DB_CONNECTION_TIMEOUT_MS: 1200,
    });
  });

  it.each([
    undefined,
    '',
    'not-a-url',
    'https://localhost/db',
    'postgresql:///db',
  ])('rejects an absent or invalid DATABASE_URL: %s', (DATABASE_URL) => {
    expect(() => loadDatabaseConfig({ DATABASE_URL })).toThrow();
  });

  it.each(['DB_POOL_MAX', 'DB_CONNECTION_TIMEOUT_MS'] as const)(
    'rejects invalid positive integer values for %s',
    (key) => {
      for (const value of ['', '0', '-1', '1.5', 'many']) {
        expect(() =>
          loadDatabaseConfig({
            DATABASE_URL: 'postgresql://localhost/recycleyoungs',
            [key]: value,
          }),
        ).toThrow();
      }
    },
  );
});
