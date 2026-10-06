import path from 'node:path';
import type { NextConfig } from 'next';

const repoRoot = path.resolve(process.cwd(), '../..');

// Local development: the browser calls /api/v1 on its own host and Next forwards it to the API,
// so each app host keeps its own HttpOnly session cookie. In AWS, CloudFront routes /api/* instead.
const apiBase = process.env['API_BASE_URL'];

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
  rewrites: async () =>
    apiBase ? [{ source: '/api/v1/:path*', destination: `${apiBase}/api/v1/:path*` }] : [],
};

export default nextConfig;
