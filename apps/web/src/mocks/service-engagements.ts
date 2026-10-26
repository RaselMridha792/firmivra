// Mock mode only (SH3): the Payroll and Bookkeeping mocks' clients and their engagements, so the
// documents, clients and engagements mocks answer for them (a request, an upload, Create Task's
// prefill). Those mocks ask here when they do not find a client.

export interface ServiceMockEngagement {
  id: string;
  clientId: string;
  clientName: string;
  kind: 'PAYROLL' | 'BOOKKEEPING';
  title: string;
  status: 'ACTIVE';
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

/** One service mock engagement by id. */
export const serviceMockEngagement = (id: string) => store().get(id);
