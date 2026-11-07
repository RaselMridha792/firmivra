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

/** Adds an entry to a client's timeline (insert-only, as the table). */
export function addTimelineEntry(clientId: string, entry: ClientTimelineEntry): void {
  const list = store().get(clientId) ?? [];
  list.push(entry);
  store().set(clientId, list);
}
