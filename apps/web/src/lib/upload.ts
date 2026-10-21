import {
  ApiRequestError,
  type CreateLogoUploadRequest,
  DOCUMENT_ERRORS,
  fileNameFitsType,
  LOGO_ERRORS,
  logoContentTypeFor,
  logoFileProblem,
  retryWhenUnavailable,
  UPLOAD_LIMITS,
  uploadBatchProblem,
  uploadContentTypeFor,
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
/** A file refused before anything is sent, with a code the screen can name (DOCUMENT_ERRORS). */
const refused = (
  code:
    | 'FILE_TYPE_NOT_ALLOWED'
    | 'FILE_EMPTY'
    | 'FILE_TOO_LARGE'
    | 'TOO_MANY_FILES'
    | 'BATCH_TOO_LARGE',
) => new ApiRequestError(400, code, DOCUMENT_ERRORS[code]);
const failed = (status: number) =>
  new ApiRequestError(status, 'UPLOAD_FAILED', DOCUMENT_ERRORS.UPLOAD_FAILED);
/** Stops before the next step once the caller has cancelled. */
const checkAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
};
/** A PUT that takes longer than this is given up (UPLOAD_FAILED). */
const PUT_TIMEOUT_MS = 10 * 60_000;

/**
 * Uploads one file from the browser in the three steps of docs/api/documents.yaml: ask the API
 * for an upload ticket, PUT the file straight to storage, then confirm. Resolves with the saved
 * document. Checks the type (PDF, JPG, PNG, Excel .xlsx or Word .docx), the name's ending and
 * the size (10 MB) first. A browser may give an .xlsx or .docx no type: the name's ending then
 * decides (`uploadContentTypeFor`). Rejects with ApiRequestError like an API error: show it with
 * `errorMessage(error, DOCUMENT_ERRORS)`, since errorMessage() alone knows only the generic codes.
 * Its own refusals are FILE_TYPE_NOT_ALLOWED, FILE_EMPTY and FILE_TOO_LARGE (400, nothing sent),
 * and UPLOAD_FAILED when the PUT to storage fails; a cancel via `signal` rejects with an
 * AbortError. When confirm answers 503 (storage busy), it confirms again with the same token
 * after the API's Retry-After, up to 3 times. It sends no credentials to storage, only the
 * ticket's URL and headers:
 *
 *   const saved = await uploadFile(file, {
 *     start: (facts) => api.myDocuments(slug).createUpload({ serviceId, requestId, ...facts }),
 *     finish: (uploadToken) => api.myDocuments(slug).confirmUpload({ uploadToken }),
 *     onProgress: setPercent,
 *   });
 */
export async function uploadFile<T>(file: File, steps: UploadSteps<T>): Promise<T> {
  const contentType = uploadContentTypeFor(file.name, file.type);
  if (!contentType || !fileNameFitsType(file.name, contentType)) {
    throw refused('FILE_TYPE_NOT_ALLOWED');
  }
  if (file.size === 0) throw refused('FILE_EMPTY');
  if (file.size > UPLOAD_LIMITS.maxBytes) throw refused('FILE_TOO_LARGE');

  checkAborted(steps.signal);
  const sha256 = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  checkAborted(steps.signal);
  const ticket = await steps.start({
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
    sha256,
  });
  checkAborted(steps.signal);
  await put(file, ticket, steps);
  checkAborted(steps.signal);
  // A 503 deletes nothing, and the token lasts 15 minutes: the same token confirms again.
  return retryWhenUnavailable(() => steps.finish(ticket.uploadToken), { signal: steps.signal });
}

/**
 * Refuses files chosen together that one batch can't take: more than 20 files (TOO_MANY_FILES)
 * or more than 500 MB in all (BATCH_TOO_LARGE), as ApiRequestError 400 before anything is sent.
 * Call it once before `uploadFile` for the first of them. The API has no batch (each file is its
 * own upload), so this check is the browser's (`uploadBatchProblem`).
 */
export function checkUploadBatch(files: readonly File[]): void {
  const problem = uploadBatchProblem(files);
  if (problem) throw refused(problem);
}

/**
 * The firm's logo in the same three steps as `uploadFile`: PNG, JPEG or WebP up to 2 MB, checked
 * first (LOGO_WRONG_TYPE, LOGO_TOO_BIG: 400, nothing sent). Show errors with
 * `errorMessage(error, LOGO_ERRORS)`; UPLOAD_FAILED is the PUT to storage failing.
 */
export async function uploadLogo<T>(
  file: File,
  steps: {
    start: (body: CreateLogoUploadRequest) => Promise<UploadTicket>;
    finish: (uploadToken: string) => Promise<T>;
    signal?: AbortSignal;
  },
): Promise<T> {
  const problem = logoFileProblem(file);
  const contentType = logoContentTypeFor(file.type);
  if (problem || !contentType) {
    const code = problem ?? 'LOGO_WRONG_TYPE';
    throw new ApiRequestError(400, code, LOGO_ERRORS[code]);
  }
  const sha256 = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const ticket = await steps.start({ contentType, sizeBytes: file.size, sha256 });
  await put(file, ticket, steps);
  return retryWhenUnavailable(() => steps.finish(ticket.uploadToken), { signal: steps.signal });
}

/** PUTs the file to the ticket's URL, reporting progress (fetch cannot report upload progress). */
function put(
  file: File,
  ticket: UploadTicket,
  steps: Pick<UploadSteps<unknown>, 'onProgress' | 'signal'>,
): Promise<void> {
  const { onProgress, signal } = steps;
  // Mock mode only (never in a production build): the mock's ticket has no storage behind it.
  if (process.env.NODE_ENV !== 'production' && ticket.url.startsWith('mock:')) {
    onProgress?.(100);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cancel = () => xhr.abort();
    const settle = (error?: unknown) => {
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve();
    };
    xhr.open(ticket.method, ticket.url);
    xhr.timeout = PUT_TIMEOUT_MS;
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        settle();
      } else {
        settle(failed(502));
      }
    };
    xhr.onerror = () => settle(failed(0));
    xhr.ontimeout = () => settle(failed(0));
    xhr.onabort = () => settle(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', cancel, { once: true });
    xhr.send(file);
  });
}
