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

/** 개발 DB를 실수로 공유·운영 DB에 연결하지 않도록 loopback 주소만 허용합니다. */
export function assertLocalDatabaseUrl(value: string | undefined): void {
  if (!value) throw new Error('DATABASE_URL이 필요합니다.');
  const url = new URL(value);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    // node-postgres는 URL 쿼리의 host 등으로 접속 대상을 덮어쓸 수 있으므로 함께 검사합니다.
    [...url.searchParams.keys()].some((key) =>
      ['host', 'hostaddr', 'service', 'servicefile'].includes(
        key.toLowerCase(),
      ),
    )
  )
    throw new Error(
      'ETL 적재는 loopback 주소의 로컬 개발 DB에서만 허용합니다.',
    );
}

// 배치 이력·CLI에 남길 메시지에서 접속 URI와 비밀번호를 가리고 길이를 제한합니다.
export function safeMessage(error: unknown, connectionString?: string): string {
  let message = error instanceof Error ? error.message : '알 수 없는 적재 오류';
  if (connectionString) {
    const password = new URL(connectionString).password;
    message = message.replaceAll(connectionString, '[DATABASE_URL]');
    if (password) {
      message = message.replaceAll(password, '[password]');
      message = message.replaceAll(decodeURIComponent(password), '[password]');
    }
  }
  return message.slice(0, 4000);
}
