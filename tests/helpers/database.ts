import { Pool } from 'pg'

/**
 * Starts the in-process Postgres that tests/setup.ts puts behind pg. Its cold start can take a second when many test
 * files run at once, so UI tests call this up front instead of letting it eat into their wait timeouts.
 */
export async function warmUpDatabase(): Promise<void> {
  await new Pool({ connectionString: 'postgres://test@localhost/warmup' }).query('SELECT 1')
}
