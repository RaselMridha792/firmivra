import { UPLOAD_LIMITS, type UploadTicket } from '@firmivra/types';

/**
 * A mock upload ticket shaped like the API's: one PUT for a file of at most
 * `UPLOAD_LIMITS.multipartThresholdBytes`, else a multipart upload with a part per
 * `UPLOAD_LIMITS.partSizeBytes` (an hour to send them). Every URL starts with `mock:`, so
 * `uploadFile()` sends nothing, but a large file still takes the multipart path.
 */
export function mockUploadTicket(ticket: {
  uploadToken: string;
  /** The PUT's URL; the parts' URLs are under it. Starts with `mock:`. */
  url: string;
  sizeBytes: number;
  /** The PUT's headers (a part has none). */
  headers: Record<string, string>;
  /** The PUT's expiry. */
  expiresAt: string;
}): UploadTicket {
  const { uploadToken, url, sizeBytes, headers, expiresAt } = ticket;
  if (sizeBytes <= UPLOAD_LIMITS.multipartThresholdBytes) {
    return { uploadToken, method: 'PUT', url, headers, expiresAt };
  }
  const partSizeBytes = UPLOAD_LIMITS.partSizeBytes;
  return {
    uploadToken,
    method: 'MULTIPART',
    partSizeBytes,
    parts: Array.from({ length: Math.ceil(sizeBytes / partSizeBytes) }, (_, i) => ({
      partNumber: i + 1,
      url: `${url}/part-${String(i + 1)}`,
      headers: {},
    })),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
}
