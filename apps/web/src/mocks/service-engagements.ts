// Mock mode only (SH3): the Payroll and Bookkeeping mocks' clients and their engagements, so the
// documents mock files a request or an upload made in those workspaces. The clients mock does not
// know these clients; the documents mock asks here when it does not find one.

interface ServiceEngagement {
  id: string;
  clientId: string;
  title: string;
  status: 'ACTIVE';
}

let engagements: Map<string, ServiceEngagement> | undefined;
const store = () => (engagements ??= new Map());

/** Called by the Payroll and Bookkeeping mocks for each of their clients. */
export function registerServiceEngagement(e: ServiceEngagement): void {
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
