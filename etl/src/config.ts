import { z } from 'zod';

const databaseConfigSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, hostname: /.+/ }),
  // 환경변수는 문자열이므로 숫자로 바꾼 뒤 양의 정수인지 확인합니다.
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

/** 환경변수를 DB 연결 설정으로 검증합니다. 잘못된 값은 연결 전에 Zod 오류로 보고합니다. */
export function loadDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return databaseConfigSchema.parse(environment);
}
