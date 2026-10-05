export type Area = 'admin' | 'firm' | 'portal';

/** Internal route folders under src/app; the proxy maps hosts onto them. */
export const INTERNAL_PREFIXES = ['/admin', '/firm', '/portal'] as const;

/** Host name without port, lower case: "App.Localhost:3000" -> "app.localhost". */
function hostname(host: string | null | undefined): string {
  return (host ?? '').split(':')[0]?.trim().toLowerCase() ?? '';
}

/**
 * Which site a host serves, from configuration (read on every request, never baked into the build):
 * ADMIN_HOST, APP_HOST, PORTAL_HOST. Locally admin.localhost, app.localhost, portal.localhost;
 * in AWS the CloudFront domains, later admin./app./portal.dev.firmivra.com.
 */
export function areaForHost(
  host: string | null,
  env: Record<string, string | undefined> = process.env,
): Area | undefined {
  const name = hostname(host);
  if (!name) return undefined;
  const map: [string | undefined, Area][] = [
    [env['ADMIN_HOST'] ?? 'admin.localhost', 'admin'],
    [env['APP_HOST'] ?? 'app.localhost', 'firm'],
    [env['PORTAL_HOST'] ?? 'portal.localhost', 'portal'],
  ];
  return map.find(([configured]) => hostname(configured) === name)?.[1];
}
