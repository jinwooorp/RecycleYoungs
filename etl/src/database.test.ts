import { describe, expect, it } from 'vitest';
import { createDatabasePool } from './database.js';

// 접속할 수 없는 포트를 사용해 풀 생성 단계에서는 네트워크 연결을 열지 않는지 확인합니다.
describe('createDatabasePool', () => {
  it('configures an empty pool without connecting to the database', async () => {
    const pool = createDatabasePool({
      DATABASE_URL: 'postgresql://localhost:1/no_database',
      DB_POOL_MAX: '3',
      DB_CONNECTION_TIMEOUT_MS: '1200',
    });

    try {
      expect(pool.options.connectionString).toBe(
        'postgresql://localhost:1/no_database',
      );
      expect(pool.options.max).toBe(3);
      expect(pool.options.connectionTimeoutMillis).toBe(1200);
      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);
      expect(pool.waitingCount).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('rejects missing connection settings before creating a pool', () => {
    expect(() => createDatabasePool({})).toThrow();
  });
});
