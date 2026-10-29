import { Pool } from 'pg';
import { loadDatabaseConfig } from './config.js';

/**
 * 검증한 환경변수로 연결 풀을 만듭니다. 생성만으로 DB에 접속하지는 않습니다.
 * 호출 측은 사용이 끝나면 pool.end()로 연결을 정리해야 합니다.
 */
export function createDatabasePool(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const config = loadDatabaseConfig(environment);

  return new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
  });
}
