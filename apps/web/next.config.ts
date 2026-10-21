import path from 'node:path';
import type { NextConfig } from 'next';

const repoRoot = path.resolve(process.cwd(), '../..');

// /api/v1 is forwarded to the API locally by a route handler (src/app/api/v1/[...path]/route.ts),
// not a rewrite: the rewrite's proxy turned a request the browser aborted into a 500.

const nextConfig: NextConfig = {
  output: 'standalone',
  // The mock-mode e2e server builds into its own folder so it can run next to `pnpm dev`.
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  transpilePackages: ['@firmivra/ui'],
  poweredByHeader: false,
  experimental: {
    // Off for `next dev` only: the on-disk dev cache kept stale routes after pages were added or
    // moved ("Page not found" for pages that exist, Oct 6-7). Builds keep their cache.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
