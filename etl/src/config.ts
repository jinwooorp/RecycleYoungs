import { z } from 'zod';

const databaseConfigSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, hostname: /.+/ }),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export function loadDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return databaseConfigSchema.parse(environment);
}
