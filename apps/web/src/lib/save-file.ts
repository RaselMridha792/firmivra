import { ApiRequestError, type ApiFile } from '@firmivra/types';
import { errorMessage } from './errors';

/**
 * Saves an export the API sent (api.<module>.export) on the viewer's computer under the name the
 * API gave it. A CSV gets its byte order mark back (reading the response as text drops it), so
 * spreadsheets read names right.
 */
export function saveFile(file: ApiFile): void {
  const mark = /csv/i.test(file.type) && !file.text.startsWith('﻿') ? '﻿' : '';
  const url = URL.createObjectURL(new Blob([`${mark}${file.text}`], { type: file.type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Why an export failed, in words, with the request id support can look up when the API sent one
 * (Audit Log Review 2, R02a: a failure is never a raw error body or a false success).
 */
export function exportFailure(error: unknown, overrides: Record<string, string> = {}): string {
  const text = `The export did not download. ${errorMessage(error, overrides)}`;
  return error instanceof ApiRequestError && error.requestId
    ? `${text} Request id: ${error.requestId}.`
    : text;
}
