export type Area = 'admin' | 'firm' | 'portal';

/** Internal route folders under src/app; the proxy maps hosts onto them. */
export const INTERNAL_PREFIXES = ['/admin', '/firm', '/portal'] as const;

const HOST_PREFIX: Record<string, Area> = { admin: 'admin', app: 'firm', portal: 'portal' };

/** admin.localhost:3000 -> admin, app.dev.firmivra.com -> firm, portal.firmivra.com -> portal. */
export function areaForHost(host: string | null): Area | undefined {
  const name = (host ?? '').split(':')[0]?.toLowerCase() ?? '';
  const first = name.split('.')[0] ?? '';
  return name.includes('.') ? HOST_PREFIX[first] : undefined;
}
