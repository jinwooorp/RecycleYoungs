import { Pool } from 'pg';
import { loadDatabaseConfig } from './config.js';

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
