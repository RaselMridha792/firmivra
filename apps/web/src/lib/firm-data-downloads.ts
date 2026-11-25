import { ApiRequestError, createRequest } from '@firmivra/types';
import { z } from 'zod';
import { sessionFetch } from './session';

const baseUrl = '/api/v1';
const ownerPath = '/closed-firm-download';
const grantPath = (firmId: string) =>
  '/admin/firms/' + encodeURIComponent(firmId) + '/download-access';
const ownerRequest = (linkToken?: string, sessionToken?: string) =>
  createRequest({
    baseUrl,
    ...(sessionToken ? { token: sessionToken } : {}),
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (linkToken) headers.set('x-download-link', linkToken);
      return fetch(input, { ...init, headers, credentials: 'omit', cache: 'no-store' });
    },
  });

const grantKind = z.enum(['AUTOMATIC', 'REQUESTED']);
const grantList = z.array(
  z.object({
    id: z.uuid(),
    kind: grantKind,
    reason: z.string().nullable(),
    startsAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    revokeReason: z.string().nullable(),
    log: z.array(
      z.object({
        event: z.string(),
        occurredAt: z.iso.datetime(),
        fileCount: z.number().nullable(),
        bytes: z.string().nullable(),
      }),
    ),
  }),
);
const clientList = z.array(
  z.object({
    id: z.uuid(),
    clientNumber: z.number(),
    displayName: z.string(),
  }),
);
const fileList = z.array(
  z.object({
    id: z.uuid(),
    clientId: z.uuid(),
    clientName: z.string(),
    fileName: z.string(),
    sizeBytes: z.number(),
    folder: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  }),
);
export type DownloadGrant = z.infer<typeof grantList>[number];
export type DownloadFile = z.infer<typeof fileList>[number];

export const ownerDownloads = {
  requestCode: (token: string) =>
    ownerRequest(token)(z.object({ sent: z.literal(true) }), ownerPath + '/request-code', {
      method: 'POST',
    }),
  verify: (token: string, code: string) =>
    ownerRequest(token)(
      z.object({ sessionToken: z.string(), expiresAt: z.iso.datetime() }),
      ownerPath + '/verify-code',
      { method: 'POST', body: { code } },
    ),
  clients: (session: string) =>
    ownerRequest(undefined, session)(clientList, ownerPath + '/clients'),
  files: (session: string) => ownerRequest(undefined, session)(fileList, ownerPath + '/files'),
  fileLink: (session: string, id: string) =>
    ownerRequest(undefined, session)(
      z.object({ url: z.url({ protocol: /^https?$/ }) }),
      ownerPath + '/files/' + encodeURIComponent(id) + '/link',
      { method: 'POST' },
    ),
  csv: async (session: string) => {
    const response = await fetch(baseUrl + ownerPath + '/clients.csv', {
      headers: { authorization: 'Bearer ' + session },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok)
      throw new ApiRequestError(response.status, 'DOWNLOAD_FAILED', 'Download failed');
    return response.blob();
  },
};

const adminRequest = createRequest({ baseUrl, fetch: sessionFetch });
export const adminDownloadAccess = {
  list: (firmId: string) => adminRequest(grantList, grantPath(firmId)),
  issue: (firmId: string, reason: string) =>
    adminRequest(
      z.object({ id: z.uuid(), expiresAt: z.iso.datetime(), emailAccepted: z.boolean() }),
      grantPath(firmId),
      { method: 'POST', body: { reason } },
    ),
  revoke: (firmId: string, id: string, reason: string) =>
    adminRequest(
      z.object({ id: z.uuid(), revoked: z.literal(true) }),
      grantPath(firmId) + '/' + encodeURIComponent(id) + '/revoke',
      { method: 'POST', body: { reason } },
    ),
};
