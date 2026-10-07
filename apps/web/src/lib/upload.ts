import {
  ApiRequestError,
  UPLOAD_LIMITS,
  type UploadContentType,
  type UploadFileFacts,
  type UploadTicket,
} from '@firmivra/types';

export interface UploadSteps<T> {
  /**
   * Step 1, with the file's facts added: `api.documents.createUpload(clientId, { ...body, ...facts })`
   * or `api.myDocuments(slug).createUpload({ ...body, ...facts })`.
   */
  start: (facts: UploadFileFacts) => Promise<UploadTicket>;
  /** Step 3: the same client's `confirmUpload({ uploadToken })`. */
  finish: (uploadToken: string) => Promise<T>;
  /** 0 to 100 while the file goes up. */
  onProgress?: (percent: number) => void;
  /** Cancels the upload (it then rejects with an AbortError). */
  signal?: AbortSignal;
}

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const invalid = (message: string) => new ApiRequestError(400, 'VALIDATION_FAILED', message);
const isAllowed = (type: string): type is UploadContentType => type in UPLOAD_LIMITS.types;

/**
 * Uploads one file from the browser in the three steps of docs/api/documents.yaml: ask the API
 * for an upload ticket, PUT the file straight to storage, then confirm. Resolves with the saved
 * document. Checks the type (PDF, JPG, PNG) and size (10 MB) first, and rejects with
 * ApiRequestError like an API error, so `errorMessage(error)` shows every failure:
 *
 *   const saved = await uploadFile(file, {
 *     start: (facts) => api.myDocuments(slug).createUpload({ serviceId, requestId, ...facts }),
 *     finish: (uploadToken) => api.myDocuments(slug).confirmUpload({ uploadToken }),
 *     onProgress: setPercent,
 *   });
 */
export async function uploadFile<T>(file: File, steps: UploadSteps<T>): Promise<T> {
  const contentType = file.type;
  if (!isAllowed(contentType)) throw invalid('Upload a PDF, JPG or PNG file');
  if (file.size === 0) throw invalid('The file is empty');
  if (file.size > UPLOAD_LIMITS.maxBytes) throw invalid('The file is larger than 10 MB');

  const sha256 = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const ticket = await steps.start({
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
    sha256,
  });
  await put(file, ticket, steps);
  return steps.finish(ticket.uploadToken);
}

/** PUTs the file to the ticket's URL, reporting progress (fetch cannot report upload progress). */
function put(file: File, ticket: UploadTicket, steps: UploadSteps<unknown>): Promise<void> {
  const { onProgress, signal } = steps;
  if (signal?.aborted) return Promise.reject(new DOMException('Upload cancelled', 'AbortError'));
  // Mock mode: the mock's ticket has no storage behind it.
  if (ticket.url.startsWith('mock:')) {
    onProgress?.(100);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method, ticket.url);
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new ApiRequestError(502, 'UPLOAD_FAILED', 'The upload did not go through.'));
      }
    };
    xhr.onerror = () =>
      reject(new ApiRequestError(0, 'UPLOAD_FAILED', 'The upload did not go through.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
