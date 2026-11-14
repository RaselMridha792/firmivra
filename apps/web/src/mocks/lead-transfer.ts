import {
  ApiRequestError,
  CreateLeadRequest,
  ExportLeadsRequest,
  ImportLeadsRequest,
  LEAD_EXPORT_FIELD_LABELS,
  LEAD_IMPORT_FIELD_LABELS,
  type LeadImportResult,
  type LeadImportRowResult,
  LeadPriority,
  LeadSource,
  type LeadPipelineClient,
  type LeadTransferClient,
  parseInput,
  roleCan,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

const norm = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);

/**
 * `api.leadTransfer` on mock data (Leads R2 16). It reads and adds to the shared leads mock
 * (`api.leadPipeline`), so imported leads show on the Leads list, and
 * checks each row as the API does: the required fields, a known source and priority, a service by
 * name, and a duplicate email or phone of a lead or an earlier row.
 */
export function createLeadTransferMock(
  pipeline: LeadPipelineClient,
  role: 'OWNER' | 'ADMIN' | 'STAFF' = 'OWNER',
): LeadTransferClient {
  return {
    import: async (body) => {
      await mockDelay();
      const input = parseInput(ImportLeadsRequest, body);
      if (!roleCan(role, 'LEADS', 'CREATE'))
        throw fail(403, 'FORBIDDEN', 'You do not have access to this action');
      const client = pipeline;
      const { services } = await client.options();
      const existing = (await client.list({ page: 1, pageSize: 100 })).items;
      const seen = new Set<string>();
      const rows: LeadImportRowResult[] = [];
      for (const [index, raw] of input.rows.entries()) {
        const text = (k: keyof typeof raw) => (raw[k] ?? '').trim();
        const issues: string[] = [];
        const source = text('source')
          ? LeadSource.options.find((s) => norm(s) === norm(text('source')))
          : 'OTHER';
        if (!source) issues.push(`Lead source: "${text('source')}" is not one of the sources`);
        const priority = text('priority')
          ? LeadPriority.options.find((p) => norm(p) === norm(text('priority')))
          : 'WARM';
        if (!priority) issues.push('Priority: use Hot, Warm or Cold');
        const serviceId = text('service')
          ? services.find((s) => s.name.toLowerCase() === text('service').toLowerCase())?.id
          : input.defaultServiceId;
        if (!serviceId) issues.push(`Service: no service is named "${text('service')}"`);
        const parsed = CreateLeadRequest.safeParse({
          firstName: text('firstName'),
          lastName: text('lastName'),
          email: text('email'),
          phone: text('phone'),
          businessName: text('businessName'),
          source: source ?? 'OTHER',
          sourceDetail: text('sourceDetail'),
          priority: priority ?? 'WARM',
          serviceIds: [serviceId ?? input.defaultServiceId],
          allowDuplicate: true,
        });
        if (!parsed.success)
          for (const issue of parsed.error.issues) {
            const field = String(issue.path[0] ?? '');
            const label = (LEAD_IMPORT_FIELD_LABELS as Record<string, string>)[field] ?? field;
            issues.push(`${label}: ${issue.message}`);
          }
        const row: LeadImportRowResult = {
          row: index + 1,
          status: 'CREATE',
          issues,
          duplicateOf: null,
          leadId: null,
        };
        if (issues.length || !parsed.success) {
          rows.push({ ...row, status: 'INVALID' });
          continue;
        }
        const email = parsed.data.email.toLowerCase();
        const match = existing.find((l) => l.email.toLowerCase() === email);
        const duplicate = !!match || seen.has(email) || email === 'taken@example.test';
        if (duplicate) {
          row.status = 'DUPLICATE';
          row.duplicateOf = match
            ? { id: match.id, name: `${match.firstName} ${match.lastName}` }
            : null;
        }
        seen.add(email);
        // A possible duplicate is added only when asked, for Review Duplicates.
        if (!input.dryRun && (!duplicate || input.duplicates === 'REVIEW')) {
          const lead = await client.create({ ...parsed.data, stage: 'SUBMITTED' });
          row.leadId = lead.id;
        }
        rows.push(row);
      }
      const count = (s: LeadImportRowResult['status']) => rows.filter((r) => r.status === s).length;
      const result: LeadImportResult = {
        dryRun: input.dryRun,
        created: rows.filter((r) => r.leadId !== null).length,
        duplicates: count('DUPLICATE'),
        invalid: count('INVALID'),
        rows,
      };
      return result;
    },
    export: async (body) => {
      await mockDelay();
      const input = parseInput(ExportLeadsRequest, body);
      if (!roleCan(role, 'LEADS', 'EXPORT'))
        throw fail(403, 'FORBIDDEN', 'You do not have access to this action');
      const listed = await pipeline.list({
        ...(input.scope === 'FILTERED' ? input.filters : {}),
        page: 1,
        pageSize: 100,
      });
      const items =
        input.scope === 'SELECTED'
          ? listed.items.filter((l) => input.ids?.includes(l.id))
          : listed.items;
      const csv = [
        input.fields.map((f) => LEAD_EXPORT_FIELD_LABELS[f]).join(','),
        ...items.map((l) => `${l.number},${l.firstName} ${l.lastName},${l.email}`),
      ].join('\n');
      return {
        url: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        fileName: 'leads.csv',
        rowCount: input.scope === 'SELECTED' ? items.length : listed.total,
      };
    },
  };
}
