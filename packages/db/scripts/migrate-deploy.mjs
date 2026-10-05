// Migration task (one-off ECS task, run by the deploy pipeline before the services update).
// 1. Applies Prisma migrations as the owner role.
// 2. Makes sure the app role (no BYPASSRLS) can log in with its password from Secrets Manager.
// Environment: DB_HOST, DB_PORT, DB_NAME, DB_OWNER_USER, DB_OWNER_PASSWORD, DB_APP_USER,
// DB_APP_PASSWORD, and DB_SSLMODE: verify-full (default; the image trusts the RDS CA bundle in
// NODE_EXTRA_CA_CERTS) or disable (local Postgres only).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
const say = (line) => process.stdout.write(`${line}\n`);

const host = required('DB_HOST');
const port = process.env['DB_PORT'] ?? '5432';
const database = required('DB_NAME');
const appUser = required('DB_APP_USER');
const sslmode = process.env['DB_SSLMODE'] ?? 'verify-full';
if (sslmode !== 'verify-full' && sslmode !== 'disable') {
  throw new Error(`DB_SSLMODE must be verify-full or disable, not ${sslmode}`);
}
const verify = sslmode === 'verify-full';
const caFile = verify ? required('NODE_EXTRA_CA_CERTS') : undefined;
const ownerBase =
  `postgresql://${encodeURIComponent(required('DB_OWNER_USER'))}:${encodeURIComponent(required('DB_OWNER_PASSWORD'))}` +
  `@${host}:${port}/${database}`;

// pg (Node) verifies against NODE_EXTRA_CA_CERTS with verify-full. Prisma's schema engine ignores
// both: without sslaccept=strict it accepts any certificate, and sslcert reads only the first
// certificate of a bundle. So Prisma gets sslaccept=strict, and OpenSSL loads the whole bundle from
// SSL_CERT_FILE; it checks the chain and the host name (tested against a local TLS Postgres, Oct 5).
const pgUrl = `${ownerBase}?sslmode=${sslmode}`;
const prismaUrl = `${ownerBase}?sslmode=${verify ? 'require&sslaccept=strict' : 'disable'}`;

say(`Applying migrations to ${host}/${database}`);
execFileSync(path.join(process.cwd(), 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: prismaUrl,
    CHECKPOINT_DISABLE: '1',
    ...(caFile ? { SSL_CERT_FILE: caFile } : {}),
  },
});

const client = new pg.Client({ connectionString: pgUrl });
await client.connect();
try {
  const role = client.escapeIdentifier(appUser);
  await client.query(
    `ALTER ROLE ${role} WITH LOGIN PASSWORD ${client.escapeLiteral(required('DB_APP_PASSWORD'))}`,
  );
  await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(database)} TO ${role}`);
} finally {
  await client.end();
}
say(`App role ${appUser} can log in`);
