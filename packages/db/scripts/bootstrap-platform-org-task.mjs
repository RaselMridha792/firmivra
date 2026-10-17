// One-off ECS task (R0 PART 1 follow-up, Oct 17): seeds the plan ladder and the department/role
// catalog, and maps every existing SUPER_ADMIN to a CEO-level platform_members row. R1 runs this
// on dev after #677's migrations (the normal seed, which does this, never runs there). Shares the
// demo-seed-task image (it needs tsx). Refuses to run unless APP_ENV=dev. Connection built the
// same way as seed-demo-task.mjs / migrate-deploy.mjs: DB_HOST, DB_PORT, DB_NAME, DB_OWNER_USER,
// DB_OWNER_PASSWORD, DB_SSLMODE (verify-full or disable).
import { execFileSync } from 'node:child_process';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

if (process.env['APP_ENV'] !== 'dev') {
  throw new Error('bootstrap-platform-org-task runs only where APP_ENV=dev');
}
const sslmode = process.env['DB_SSLMODE'] ?? 'verify-full';
if (sslmode !== 'verify-full' && sslmode !== 'disable') {
  throw new Error(`DB_SSLMODE must be verify-full or disable, not ${sslmode}`);
}
const url =
  `postgresql://${encodeURIComponent(required('DB_OWNER_USER'))}:${encodeURIComponent(required('DB_OWNER_PASSWORD'))}` +
  `@${required('DB_HOST')}:${process.env['DB_PORT'] ?? '5432'}/${required('DB_NAME')}` +
  `?sslmode=${sslmode === 'verify-full' ? 'require&sslaccept=strict' : 'disable'}`;

execFileSync('pnpm', ['exec', 'tsx', 'prisma/bootstrap-platform-org-cli.ts'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
