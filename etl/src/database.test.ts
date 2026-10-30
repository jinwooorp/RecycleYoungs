import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  createDatabasePool,
  rollbackOrDiscard,
  safeMessage,
} from './database.js';

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

  it('masks connection strings and both encoded and decoded passwords in batch errors', () => {
    // 배치 실패 사유는 DB와 CLI에 남으므로 다른 ETL에서도 같은 비밀정보 보호를 적용합니다.
    const url = 'postgresql://user:secret%40value@localhost/db';
    const message = safeMessage(
      new Error(`connection ${url}: secret%40value secret@value`),
      url,
    );
    expect(message).not.toContain(url);
    expect(message).not.toContain('secret%40value');
    expect(message).not.toContain('secret@value');
    expect(safeMessage(new Error('x'.repeat(5000)))).toHaveLength(4000);
  });
});

describe('rollbackOrDiscard', () => {
  it.each([false, true])(
    'discards the connection only if rollback fails: %s',
    async (rollbackFails) => {
      // 연결 장애를 DB IO 경계에서 재현합니다. 반환값은 호출 측의 실패 이력 기록 경로를 결정합니다.
      let discarded = false;
      const client = {
        async query() {
          if (rollbackFails) throw new Error('connection lost during rollback');
        },
        release(destroy: boolean) {
          discarded = destroy;
        },
      } as unknown as PoolClient;
      expect(await rollbackOrDiscard(client)).toBe(rollbackFails);
      expect(discarded).toBe(rollbackFails);
    },
  );
});
