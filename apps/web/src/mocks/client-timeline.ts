import type { ClientTimelineEntry } from '@firmivra/types';

// MSG-F16: the clients' timelines in mock mode, shared by the messages mock (New Message's Add to
// Client Timeline writes an entry on send) and the clients mock (the Activity tab reads them).
// Empty until something is sent; nothing is built on import.

let entries: Map<string, ClientTimelineEntry[]> | undefined;
const store = () => (entries ??= new Map());

/** A client's entries, newest first. */
export function timelineOf(clientId: string): ClientTimelineEntry[] {
  return [...(store().get(clientId) ?? [])].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );
}

/** Review 2 (E01a A01): a service's activity that a client's Activity page lists too. */
type ServiceSource = (clientId: string) => ClientTimelineEntry[];
let sources: Map<string, ServiceSource> | undefined;

/** The bookkeeping mock registers its Activity card's events here (the latest mock wins). */
export function setTimelineSource(service: string, source: ServiceSource): void {
  (sources ??= new Map()).set(service, source);
}

/** The services' events for a client, as the API's client Activity reads them. */
export function serviceEntriesOf(clientId: string): ClientTimelineEntry[] {
  return [...(sources?.values() ?? [])].flatMap((source) => source(clientId));
}

/** Adds an entry to a client's timeline (insert-only, as the table). */
export function addTimelineEntry(clientId: string, entry: ClientTimelineEntry): void {
  const list = store().get(clientId) ?? [];
  list.push(entry);
  store().set(clientId, list);
}
