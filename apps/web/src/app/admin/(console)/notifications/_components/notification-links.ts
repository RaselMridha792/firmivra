import type { AdminNotification } from '@firmivra/types';

/** The console page of each source record type a producer names (`source.type`). */
const RECORD_PATHS: Record<string, (id: string) => string> = {
  firm_application: (id) => `/applications/${id}`,
  business: (id) => `/firms/${id}`,
  firm: (id) => `/firms/${id}`,
  support_ticket: (id) => `/support/tickets/${id}`,
  invoice: (id) => `/billing/invoices/${id}`,
  audit_event: (id) => `/audit-security/events/${id}`,
  security_event: (id) => `/audit-security/events/${id}`,
  platform_integration: (id) => `/integrations/platform/${id}`,
  integration_catalog: (id) => `/integrations/catalog/${id}`,
  integration_log: (id) => `/integrations/logs?log=${id}`,
};

/**
 * Where opening a notification goes (the notifications spec, §8 and §9: open the exact record
 * behind it, never only a module's home). The source record's page when the producer named one
 * with an id; otherwise the firm the item is about; null keeps the details panel (a platform
 * notice, or a record without a console page).
 */
export function recordHref(item: Pick<AdminNotification, 'source' | 'business'>): string | null {
  const path = RECORD_PATHS[item.source.type];
  if (path && item.source.id) return path(encodeURIComponent(item.source.id));
  return item.business ? `/firms/${encodeURIComponent(item.business.id)}` : null;
}
