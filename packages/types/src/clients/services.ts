import { z } from 'zod';
import { EngagementStatus, ServiceKind } from '../db-enums.js';
import { MemberRef } from './schemas.js';

// Octavia's E4 (Clients review, Oct 25): the client's services on the profile (the Services tab,
// Overview's Active Services and the service tabs). GET /business/clients/{id}/services, under
// Clients' VIEW; Staff reach their own clients (others 404).

/** The module a service is worked in and the record that opens it there. */
export const ClientServiceWorkspace = z.object({
  module: z.enum(['TAX_RETURNS', 'BOOKKEEPING', 'PAYROLL', 'TAX_PLANNING', 'BUSINESS_ADVISORY']),
  /**
   * The record to open: the engagement's newest tax return, its bookkeeping client, its payroll
   * client, the client's newest tax plan, or the client's advisory client. Null: the module has
   * no record for this client yet (its list opens instead).
   */
  id: z.uuid().nullable(),
});
export type ClientServiceWorkspace = z.infer<typeof ClientServiceWorkspace>;

export const ClientService = z.object({
  /** The engagement; an advisory enrollment without one: its workstream. */
  id: z.uuid(),
  service: z.object({ id: z.uuid(), name: z.string(), kind: ServiceKind }),
  title: z.string(),
  /** An advisory workstream reads as ACTIVE while enrolled (accepted, in progress, on hold). */
  status: EngagementStatus,
  since: z.iso.datetime({ offset: true }),
  assignedTo: MemberRef.nullable(),
  /** Null when the member's grid has no VIEW in that module, or the service has none. */
  workspace: ClientServiceWorkspace.nullable(),
});
export type ClientService = z.infer<typeof ClientService>;

/** Newest first; every status, so the Services tab shows the history too. */
export const ClientServiceList = z.object({ items: z.array(ClientService).max(200) });
export type ClientServiceList = z.infer<typeof ClientServiceList>;
