/**
 * Uploads a file from the browser. Not available yet: R5 (secure documents) fills this in,
 * with the upload URL from the API, the size and type checks, and progress. Screens can call it
 * now and show errorMessage(error) when it throws.
 */
export function uploadFile(file: File): Promise<{ id: string }> {
  void file;
  return Promise.reject(new Error('File upload is not available yet.'));
}
