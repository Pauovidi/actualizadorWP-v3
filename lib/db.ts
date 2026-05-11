import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __awp_pool: Pool | undefined;
}

function getConnectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    ''
  );
}

export function dbPool(): Pool {
  const cs = getConnectionString();
  if (!cs) {
    throw new Error(
      'Missing DATABASE_URL / POSTGRES_URL env var. Connect a Postgres database in Vercel (Storage) or set DATABASE_URL locally.'
    );
  }
  if (!global.__awp_pool) {
    global.__awp_pool = new Pool({ connectionString: cs });
  }
  return global.__awp_pool;
}
