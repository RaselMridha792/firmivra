import { ServiceUnavailableException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';

/** Draft schema integrations fail closed until Rasel supplies tables with forced RLS. */
export async function requireTables(tx: TxClient, tables: readonly string[]) {
  const rows = await tx.$queryRaw<{ name: string; protected: boolean }[]>`
    SELECT c.relname AS name, (c.relrowsecurity AND c.relforcerowsecurity) AS protected
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname = ANY(${[...tables]}::text[])`;
  if (tables.some((name) => !rows.some((row) => row.name === name && row.protected)))
    throw new ServiceUnavailableException({
      code: 'SCHEMA_NOT_READY',
      message: 'Required module schema is not available',
    });
}
