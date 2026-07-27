import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ENV } from '../config/env';
import * as schema from './schema';

const client = postgres(ENV.DATABASE_URL, {
  max: ENV.DB_POOL_MAX,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: true,
});

export const pgClient = client;
export const db = drizzle(client, { schema });
