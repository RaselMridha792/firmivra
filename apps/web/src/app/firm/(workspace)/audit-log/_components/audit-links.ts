import type { AuditEntry } from '@firmivra/types';

/**
 * Audit Log Review 2, M01b: where an entry's record opens in the firm workspace. The record's own
 * page and its API check the viewer's access, so a link never opens more than the viewer may see;
 * a gone record, a type without a page, or an id that is not a UUID has no link.
 */
const PAGES: Record<string, (id: string) => string> = {
  client: (id) => `/clients/${id}`,
  lead: (id) => `/leads/${id}`,
  intake: (id) => `/intake-forms/${id}`,
  task: (id) => `/tasks/${id}`,
  appointment: (id) => `/calendar/${id}`,
  invoice: (id) => `/invoices/${id}`,
  engagement: (id) => `/workspaces/${id}`,
  document: (id) => `/documents/${id}`,
  document_request: (id) => `/documents/requests/${id}`,
  tax_return: (id) => `/tax-returns/${id}`,
  compliance_deadline: (id) => `/compliance/${id}`,
  membership: (id) => `/team/${id}`,
  firm_office: (id) => `/settings/locations/${id}`,
  automation_rule: (id) => `/automations/${id}`,
  communication: (id) => `/communications/${id}`,
  payroll_run: (id) => `/payroll/runs/${id}`,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recordHref(entity: AuditEntry['entity']): string | null {
  const page = PAGES[entity.type];
  if (!page || !entity.id || entity.deleted || !UUID.test(entity.id)) return null;
  return page(entity.id.toLowerCase());
}
