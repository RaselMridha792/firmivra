import path from 'node:path';
import type { NextConfig } from 'next';

const repoRoot = path.resolve(process.cwd(), '../..');

// Local development: the browser calls /api/v1 on its own host and Next forwards it to the API,
// so each app host keeps its own HttpOnly session cookie. In AWS, CloudFront routes /api/* instead.
const apiBase = process.env['API_BASE_URL'];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  transpilePackages: ['@firmivra/ui'],
  poweredByHeader: false,
  devIndicators: false,
  rewrites: async () =>
    apiBase ? [{ source: '/api/v1/:path*', destination: `${apiBase}/api/v1/:path*` }] : [],
};

export default nextConfig;
