import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ENV } from '../config/env';
import * as schema from './schema';

const client = postgres(ENV.DATABASE_URL, {
  max: ENV.NODE_ENV === 'production' ? 20 : 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: true,
});

export const db = drizzle(client, { schema });
