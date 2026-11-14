// Mock mode only (SH3): the Payroll, Bookkeeping and Tax Returns mocks' clients and their engagements, so the
// documents, clients and engagements mocks answer for them (a request, an upload, Create Task's
// prefill). Those mocks ask here when they do not find a client.

export interface ServiceMockEngagement {
  id: string;
  clientId: string;
  clientName: string;
  kind: 'PAYROLL' | 'BOOKKEEPING' | 'ANNUAL_TAX';
  title: string;
  status: 'ACTIVE';
  /** The Bookkeeping or Payroll mock's workspace for it, so a task's Related To opens it. */
  workspaceId?: string;
}

let engagements: Map<string, ServiceMockEngagement> | undefined;
const store = () => (engagements ??= new Map());

/** Called by the Payroll and Bookkeeping mocks for each of their clients. */
export function registerServiceEngagement(e: ServiceMockEngagement): void {
  store().set(e.id, e);
}

/** The engagement `id` of `clientId`, when a service mock made it. */
export const serviceEngagement = (clientId: string, id: string) => {
  const e = store().get(id);
  return e?.clientId === clientId ? e : undefined;
};

/** True when a service mock has this client. */
export const serviceMockClient = (clientId: string) =>
  [...store().values()].some((e) => e.clientId === clientId);

/** A service mock client's engagements. */
export const serviceMockEngagements = (clientId: string) =>
  [...store().values()].filter((e) => e.clientId === clientId);

/** A task's Related To for an engagement: its title and, for a service mock, its workspace. */
export function taskEngagementRef(id: string): {
  id: string;
  title: string;
  workspace: { kind: 'BOOKKEEPING' | 'PAYROLL'; id: string } | null;
} {
  const e = store().get(id);
  const kind = e?.kind === 'BOOKKEEPING' || e?.kind === 'PAYROLL' ? e.kind : null;
  return {
    id,
    title: e?.title ?? 'Project',
    workspace: kind && e?.workspaceId ? { kind, id: e.workspaceId } : null,
  };
}

/** One service mock engagement by id. */
export const serviceMockEngagement = (id: string) => store().get(id);
