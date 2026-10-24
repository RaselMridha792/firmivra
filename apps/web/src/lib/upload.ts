import {
  ApiRequestError,
  type CreateLogoUploadRequest,
  DOCUMENT_ERRORS,
  fileNameFitsType,
  LOGO_ERRORS,
  logoContentTypeFor,
  logoFileProblem,
  megabytes,
  retryWhenUnavailable,
  UPLOAD_LIMITS,
  uploadBatchProblem,
  uploadContentTypeFor,
  type UploadFileFacts,
  type UploadMultipartTicket,
  type UploadPart,
  type UploadPutTicket,
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
  /**
   * The flow's largest file, checked before anything is sent (FILE_TOO_LARGE). Documents pass
   * `UPLOAD_LIMITS.maxBytes` (or their flow's constant, such as STAFF_DOCUMENT_LIMITS.maxBytes);
   * a flow with a smaller limit passes its own (SUPPORT_ATTACHMENT_LIMITS.maxBytes,
   * TEMPLATE_ATTACHMENT_MAX_BYTES), so it never follows the documents' limit. Never more than
   * `UPLOAD_LIMITS.maxBytes`.
   */
  maxBytes: number;
  /** 0 to 100 while the file goes up. */
  onProgress?: (percent: number) => void;
  /** Cancels the upload (it then rejects with an AbortError). */
  signal?: AbortSignal;
}

type Sending = Pick<UploadSteps<unknown>, 'onProgress' | 'signal'>;

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
/** A part's URL no longer works (expired, or the upload is gone): a new ticket is needed. */
const expired = () => new ApiRequestError(410, 'UPLOAD_EXPIRED', DOCUMENT_ERRORS.UPLOAD_EXPIRED);
const cancelled = () => new DOMException('Upload cancelled', 'AbortError');
/** Stops before the next step once the caller has cancelled. */
const checkAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw cancelled();
};
/** Mock mode only (never in a production build): the mock's ticket has no storage behind it. */
const isMock = (url: string) => process.env.NODE_ENV !== 'production' && url.startsWith('mock:');

/** A PUT (the whole file, or one part) that takes longer than this is given up. */
const PUT_TIMEOUT_MS = 10 * 60_000;
/** Parts of a multipart upload that go up at once. */
const PARTS_AT_ONCE = 3;
/** The wait before a failed part goes again: doubles after each try, up to the most. */
const PART_RETRY_FIRST_MS = 1_000;
const PART_RETRY_MOST_MS = 30_000;

/**
 * Uploads one file from the browser in the three steps of docs/api/documents.yaml: ask the API
 * for an upload ticket, send the file straight to storage, then confirm. Resolves with the saved
 * document. Checks the type (PDF, JPG, PNG, Excel .xlsx or Word .docx), the name's ending and the
 * size (`steps.maxBytes`: 100 MB for documents) first. A browser may give an .xlsx or .docx no
 * type: the name's ending then decides (`uploadContentTypeFor`). Rejects with ApiRequestError like
 * an API error: show it with `errorMessage(error, DOCUMENT_ERRORS)`, since errorMessage() alone
 * knows only the generic codes. Its own refusals are FILE_TYPE_NOT_ALLOWED, FILE_EMPTY and
 * FILE_TOO_LARGE (400, nothing sent), UPLOAD_FAILED when storage can't take the file, and
 * UPLOAD_EXPIRED when a part's URL no longer works (choose the file again); a cancel via
 * `signal` rejects with an AbortError. When confirm answers 503 (storage busy), it confirms again
 * with the same token after the API's Retry-After, up to 3 times. It sends no credentials to
 * storage, only the ticket's URLs and headers.
 *
 * The API decides how the file goes: one PUT (16 MB or less), or a multipart upload whose parts
 * go up three at once, each retried on its own until the ticket expires (`sendParts`).
 *
 * The SHA-256 is taken from the whole file in memory (Web Crypto has no streaming digest): up to
 * 100 MB held for a moment, which desktop browsers handle.
 *
 *   const saved = await uploadFile(file, {
 *     start: (facts) => api.myDocuments(slug).createUpload({ serviceId, requestId, ...facts }),
 *     finish: (uploadToken) => api.myDocuments(slug).confirmUpload({ uploadToken }),
 *     maxBytes: UPLOAD_LIMITS.maxBytes,
 *     onProgress: setPercent,
 *   });
 */
export async function uploadFile<T>(file: File, steps: UploadSteps<T>): Promise<T> {
  const contentType = uploadContentTypeFor(file.name, file.type);
  if (!contentType || !fileNameFitsType(file.name, contentType)) {
    throw refused('FILE_TYPE_NOT_ALLOWED');
  }
  if (file.size === 0) throw refused('FILE_EMPTY');
  const maxBytes = Math.min(steps.maxBytes, UPLOAD_LIMITS.maxBytes);
  if (file.size > maxBytes) {
    throw new ApiRequestError(
      400,
      'FILE_TOO_LARGE',
      `This file is larger than ${megabytes(maxBytes)}. Choose a smaller file.`,
    );
  }

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
  await send(file, ticket, steps);
  checkAborted(steps.signal);
  // A 503 deletes nothing, and the token lasts 15 minutes (70 for a multipart upload): the same
  // token confirms again.
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
  await send(file, ticket, steps);
  return retryWhenUnavailable(() => steps.finish(ticket.uploadToken), { signal: steps.signal });
}

/**
 * An image of one of `contentTypes`, at most `maxBytes` (the lead email's inline images): checked
 * here first (400 FILE_TYPE_NOT_ALLOWED, FILE_EMPTY or FILE_TOO_LARGE), then the same three steps
 * as a logo.
 */
export async function uploadImage<T, C extends string>(
  file: File,
  steps: {
    contentTypes: readonly C[];
    maxBytes: number;
    start: (body: { contentType: C; sizeBytes: number; sha256: string }) => Promise<UploadTicket>;
    finish: (uploadToken: string) => Promise<T>;
    signal?: AbortSignal;
  },
): Promise<T> {
  const contentType = steps.contentTypes.find((t) => t === file.type);
  if (!contentType) throw refused('FILE_TYPE_NOT_ALLOWED');
  if (file.size === 0) throw refused('FILE_EMPTY');
  if (file.size > steps.maxBytes) throw refused('FILE_TOO_LARGE');
  const sha256 = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const ticket = await steps.start({ contentType, sizeBytes: file.size, sha256 });
  await send(file, ticket, steps);
  return retryWhenUnavailable(() => steps.finish(ticket.uploadToken), { signal: steps.signal });
}

/** Step 2: the file to storage, the way the ticket says. */
function send(file: File, ticket: UploadTicket, steps: Sending): Promise<void> {
  return ticket.method === 'PUT' ? sendWhole(file, ticket, steps) : sendParts(file, ticket, steps);
}

/** One PUT of the whole file to the ticket's URL, reporting progress. */
async function sendWhole(file: File, ticket: UploadPutTicket, steps: Sending): Promise<void> {
  const { onProgress, signal } = steps;
  if (isMock(ticket.url)) {
    onProgress?.(100);
    return;
  }
  const status = await put(ticket.url, ticket.headers, file, signal, (loaded, total) =>
    onProgress?.(Math.round((loaded / total) * 100)),
  );
  if (status === null) throw failed(0);
  if (status < 200 || status >= 300) throw failed(502);
  onProgress?.(100);
}

/**
 * A multipart upload: part N is the file's bytes from (N - 1) * partSizeBytes, PUT to its own URL
 * with exactly its headers (no type, so the browser sends no Content-Type; it sets the signed
 * Content-Length itself). Three parts go up at once. A part that fails (no answer, a timeout, a
 * 5xx, 408 or 429) goes again to the same URL after a wait (1 s, doubling, at most 30 s) while
 * the ticket lasts; then UPLOAD_FAILED. A 403 or 404 means its URL no longer works: every part
 * stops and the upload rejects with UPLOAD_EXPIRED (choose the file again for a new ticket).
 * Another 4xx would come back the same: UPLOAD_FAILED at once. Progress is the bytes sent of the
 * whole file and never goes back while a part is sent again. A cancel stops every part at once.
 */
async function sendParts(file: File, ticket: UploadMultipartTicket, steps: Sending): Promise<void> {
  const { onProgress, signal } = steps;
  checkAborted(signal);
  const sent = new Map<number, number>();
  let shown = -1;
  const report = (partNumber: number, bytes: number) => {
    sent.set(partNumber, bytes);
    let total = 0;
    for (const n of sent.values()) total += n;
    const percent = Math.min(100, Math.floor((total / file.size) * 100));
    if (percent > shown) {
      shown = percent;
      onProgress?.(percent);
    }
  };

  // One stop for every part: the caller's cancel, or a part that can't go.
  const stop = new AbortController();
  const cancel = () => stop.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const queue = [...ticket.parts];
  let failure: unknown;
  const worker = async () => {
    for (let part = queue.shift(); part && !stop.signal.aborted; part = queue.shift()) {
      await sendPart(file, ticket, part, stop.signal, report);
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(PARTS_AT_ONCE, queue.length) }, () =>
        worker().catch((error: unknown) => {
          failure ??= error;
          stop.abort();
        }),
      ),
    );
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  if (signal?.aborted) throw cancelled();
  if (failure !== undefined) throw failure;
  if (shown < 100) onProgress?.(100);
}

/** One part, sent again after a failure while the ticket lasts (see `sendParts`). */
async function sendPart(
  file: File,
  ticket: UploadMultipartTicket,
  part: UploadPart,
  signal: AbortSignal,
  report: (partNumber: number, bytes: number) => void,
): Promise<void> {
  const from = (part.partNumber - 1) * ticket.partSizeBytes;
  const body = file.slice(from, from + ticket.partSizeBytes);
  if (isMock(part.url)) {
    report(part.partNumber, body.size);
    return;
  }
  const deadline = Date.parse(ticket.expiresAt);
  for (let attempt = 0; ; attempt++) {
    report(part.partNumber, 0);
    const status = await put(part.url, part.headers, body, signal, (loaded) =>
      report(part.partNumber, Math.min(loaded, body.size)),
    );
    if (status !== null && status >= 200 && status < 300) {
      report(part.partNumber, body.size);
      return;
    }
    if (status === 403 || status === 404) throw expired();
    if (status !== null && status < 500 && status !== 408 && status !== 429) throw failed(502);
    const wait = Math.min(PART_RETRY_FIRST_MS * 2 ** attempt, PART_RETRY_MOST_MS);
    // Not past the ticket's end (an unreadable end counts as past).
    if (!(Date.now() + wait < deadline)) throw failed(status === null ? 0 : 502);
    await pause(wait, signal);
  }
}

/**
 * PUTs `body` to `url` with exactly `headers`, reporting bytes sent (fetch cannot report upload
 * progress). Resolves with the response's status, or null when there was none (no connection, or
 * PUT_TIMEOUT_MS passed); rejects with an AbortError on a cancel.
 */
function put(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  signal: AbortSignal | undefined,
  onSent: (loaded: number, total: number) => void,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const xhr = new XMLHttpRequest();
    const cancel = () => xhr.abort();
    const settle = (status: number | null | 'aborted') => {
      signal?.removeEventListener('abort', cancel);
      if (status === 'aborted') reject(cancelled());
      else resolve(status);
    };
    xhr.open('PUT', url);
    xhr.timeout = PUT_TIMEOUT_MS;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onSent(e.loaded, e.total);
    };
    xhr.onload = () => settle(xhr.status);
    xhr.onerror = () => settle(null);
    xhr.ontimeout = () => settle(null);
    xhr.onabort = () => settle('aborted');
    signal?.addEventListener('abort', cancel, { once: true });
    xhr.send(body);
  });
}

/** Resolves after `ms`, or rejects with an AbortError as soon as `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelled());
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}
