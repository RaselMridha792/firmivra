// Fix-phase push guard (Rasel, Nov 23): code that doesn't compile never leaves the laptop. It
// typechecks each workspace package this branch changed (against origin/main), one at a time.
import { execFileSync, spawnSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
let base;
try {
  base = git('merge-base', 'HEAD', 'origin/main');
} catch {
  process.exit(0); // No origin/main to compare with: CI still typechecks.
}
const changed = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
if (!changed.some((f) => /\.(ts|tsx|mts|cts)$/.test(f))) process.exit(0);

// A shared package changes the apps that use it.
const USERS = {
  'packages/types/': ['@firmivra/types', '@firmivra/web', '@firmivra/api'],
  'packages/ui/': ['@firmivra/ui', '@firmivra/web'],
  'packages/db/': ['@firmivra/db', '@firmivra/api'],
  'apps/web/': ['@firmivra/web'],
  'apps/api/': ['@firmivra/api'],
};
const packages = new Set();
for (const file of changed) {
  for (const [dir, names] of Object.entries(USERS)) {
    if (file.startsWith(dir)) names.forEach((n) => packages.add(n));
  }
}
if (packages.size === 0) process.exit(0);
// Through turbo, typecheck first builds the shared packages it uses (prisma generate,
// @firmivra/types, @firmivra/ui). So a stale local build after merging main no longer blocks the
// push with errors in files the branch never touched. Turbo caches the builds: an unchanged
// package costs nothing. One task at a time keeps the laptop usable.
const names = [...packages];
process.stderr.write(`[pre-push] typecheck ${names.join(', ')} ...\n`);
const run = spawnSync(
  'pnpm',
  ['exec', 'turbo', 'run', 'typecheck', '--concurrency=1', ...names.map((n) => `--filter=${n}`)],
  { stdio: 'inherit', shell: true },
);
if (run.status !== 0) {
  process.stderr.write(
    '\nPush blocked: the code does not typecheck. Fix the errors above, commit, and push again.\n' +
      'Never push with --no-verify: CI runs the same typecheck, and a red PR is not merged.\n\n',
  );
  process.exit(1);
}
