import { ApiRequestError } from '@firmivra/types';

/**
 * Uploads a file from the browser. Not available yet: R5 (secure documents) fills this in,
 * with the upload URL from the API, the size and type checks, and progress. Screens can call it
 * now: it rejects like an API error (501 NOT_IMPLEMENTED), so errorMessage(error) shows it.
 */
export function uploadFile(file: File): Promise<{ id: string }> {
  void file;
  return Promise.reject(
    new ApiRequestError(501, 'NOT_IMPLEMENTED', 'File upload is not available yet.'),
  );
}
