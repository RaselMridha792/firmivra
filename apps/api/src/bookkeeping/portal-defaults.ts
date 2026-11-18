import type { Prisma, TxClient } from '@firmivra/db';
import type { PortalDefaults } from '@firmivra/types';

/**
 * Client Portal BK-CP4 (R55): a bookkeeping client's Portal Defaults (the workspace's Settings,
 * "Shown in the client portal": Reports, Tasks, Documents, Notes) decide what the portal shows of
 * that Bookkeeping service. The portal's readers apply them in their queries, so the page and a
 * direct API call agree:
 * - reports: the service's published reports (My Services), their files in My Documents, and the
 *   new-report notice (BK-CP2);
 * - documents: the firm's documents of the service in My Documents (the client's own uploads stay
 *   theirs and always show);
 * - notes: Share with Client (B32) of a note of the service is refused;
 * - tasks: the portal's task list (R56's, `hiddenInPortal(..., 'tasks')`).
 * A default never saved is shown, as before Portal Defaults existed; the Settings screen reads
 * the same values (`effectivePortalDefaults`).
 */
export const PORTAL_DEFAULT_KEYS = ['reports', 'tasks', 'documents', 'notes'] as const;
export type PortalDefaultKey = (typeof PORTAL_DEFAULT_KEYS)[number];

/** Each default as it applies: true unless the firm switched it off. */
export function effectivePortalDefaults(stored: unknown): Required<PortalDefaults> {
  const saved =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  return {
    reports: saved['reports'] !== false,
    tasks: saved['tasks'] !== false,
    documents: saved['documents'] !== false,
    notes: saved['notes'] !== false,
  };
}

/** The client's Bookkeeping services (engagement ids) whose default `key` is off. */
export async function hiddenInPortal(
  tx: TxClient,
  businessId: string,
  clientId: string,
  key: PortalDefaultKey,
): Promise<string[]> {
  const rows = await tx.bookkeepingProfile.findMany({
    where: { businessId, engagement: { clientId } },
    select: { engagementId: true, portalDefaults: true },
  });
  return rows
    .filter((r) => !effectivePortalDefaults(r.portalDefaults)[key])
    .map((r) => r.engagementId);
}

/** Whether the portal shows `key` of this engagement (any engagement that is not Bookkeeping: yes). */
export async function shownInPortal(
  tx: TxClient,
  businessId: string,
  engagementId: string,
  key: PortalDefaultKey,
): Promise<boolean> {
  const profile = await tx.bookkeepingProfile.findFirst({
    where: { businessId, engagementId },
    select: { portalDefaults: true },
  });
  return !profile || effectivePortalDefaults(profile.portalDefaults)[key];
}

/**
 * The firm's documents of a client the portal leaves out: those of a service with Documents off,
 * and the report files (a published report's, or a generated report version's) of a service with
 * Reports off. Null when nothing is left out.
 */
export async function hiddenFirmDocuments(
  tx: TxClient,
  businessId: string,
  clientId: string,
): Promise<Prisma.DocumentWhereInput | null> {
  const [documents, reports] = await Promise.all([
    hiddenInPortal(tx, businessId, clientId, 'documents'),
    hiddenInPortal(tx, businessId, clientId, 'reports'),
  ]);
  const out: Prisma.DocumentWhereInput[] = [];
  if (documents.length) out.push({ engagementId: { in: documents } });
  if (reports.length)
    out.push({
      engagementId: { in: reports },
      OR: [{ reports: { some: {} } }, { bookkeepingReportFiles: { some: {} } }],
    });
  return out.length ? { OR: out } : null;
}
