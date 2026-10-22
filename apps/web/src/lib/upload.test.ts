// The browser upload helper (upload.ts) against a stand-in XMLHttpRequest: node has none, and the
// helper's only way to storage is `new XMLHttpRequest()`. Synthetic files only.
import { createHash } from 'node:crypto';
import {
  ApiRequestError,
  DOCUMENT_ERRORS,
  UPLOAD_LIMITS,
  type UploadFileFacts,
  type UploadTicket,
} from '@firmivra/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadFile, type UploadSteps } from './upload';

/** How the stand-in storage answers a PUT: a status, no answer, a timeout, or not yet. */
type Reply = number | 'error' | 'timeout' | 'hang';

class FakeXhr {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: Blob | undefined;
  status = 0;
  timeout = 0;
  aborted = false;
  done = false;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: Blob) {
    this.body = body;
    sent.push(this);
    inFlight += 1;
    mostInFlight = Math.max(mostInFlight, inFlight);
    const answer = reply(this);
    if (answer !== 'hang') setImmediate(() => this.answer(answer));
  }
  /** Ends the request the way storage would: half the bytes go before a failure. */
  answer(answer: Exclude<Reply, 'hang'>) {
    if (this.done) return;
    this.done = true;
    inFlight -= 1;
    const total = this.body?.size ?? 0;
    const loaded = typeof answer === 'number' ? total : Math.floor(total / 2);
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
    if (answer === 'error') this.onerror?.();
    else if (answer === 'timeout') this.ontimeout?.();
    else {
      this.status = answer;
      this.onload?.();
    }
  }
  abort() {
    if (this.done) return;
    this.done = true;
    this.aborted = true;
    inFlight -= 1;
    this.onabort?.();
  }
}

let sent: FakeXhr[] = [];
let inFlight = 0;
let mostInFlight = 0;
let reply: (xhr: FakeXhr) => Reply = () => 200;

const NOW = new Date('2026-10-21T12:00:00.000Z');
const inAnHour = new Date(NOW.getTime() + 60 * 60_000).toISOString();

beforeEach(() => {
  sent = [];
  inFlight = 0;
  mostInFlight = 0;
  reply = () => 200;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  // Only the waits between tries are fake; setImmediate stays real for the stand-in's answers.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lets pending I/O and promises run (the digest, the stand-in's answers) until `check` holds. */
async function until(check: () => boolean) {
  for (let i = 0; i < 2000 && !check(); i++) await new Promise((done) => setImmediate(done));
  expect(check()).toBe(true);
}
/** Lets everything that can run, run (no fake time passes). */
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((done) => setImmediate(done));
}

const pdf = (text: string, name = 'Synthetic_W-2.pdf') =>
  new File([text], name, { type: 'application/pdf' });
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function multipart(
  parts: number,
  partSizeBytes: number,
  options: { url?: (n: number) => string; expiresAt?: string } = {},
): UploadTicket {
  const url = options.url ?? ((n: number) => `https://storage.test/upload/part-${String(n)}`);
  return {
    uploadToken: 'token.with-a-dot',
    method: 'MULTIPART',
    partSizeBytes,
    parts: Array.from({ length: parts }, (_, i) => ({
      partNumber: i + 1,
      url: url(i + 1),
      headers: {},
    })),
    expiresAt: options.expiresAt ?? inAnHour,
  };
}

/** Steps that answer `ticket` and confirm with a saved document, recording what they saw. */
function stepsFor(ticket: UploadTicket, extra: Partial<UploadSteps<{ id: string }>> = {}) {
  const seen = { facts: [] as UploadFileFacts[], tokens: [] as string[], progress: [] as number[] };
  const steps: UploadSteps<{ id: string }> = {
    start: (facts) => {
      seen.facts.push(facts);
      return Promise.resolve(ticket);
    },
    finish: (uploadToken) => {
      seen.tokens.push(uploadToken);
      return Promise.resolve({ id: 'doc-1' });
    },
    maxBytes: UPLOAD_LIMITS.maxBytes,
    onProgress: (percent) => seen.progress.push(percent),
    ...extra,
  };
  return { steps, seen };
}

const partOf = (xhr: FakeXhr) => Number(/part-(\d+)$/.exec(xhr.url)?.[1]);

describe('uploadFile: one PUT', () => {
  const put: UploadTicket = {
    uploadToken: 'put-token',
    method: 'PUT',
    url: 'https://storage.test/upload/whole',
    headers: { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': 'c2lnbmVk' },
    expiresAt: inAnHour,
  };

  it('sends the whole file once to the URL with exactly its headers, then confirms', async () => {
    const file = pdf('%PDF-1.4 synthetic');
    const { steps, seen } = stepsFor(put);
    await expect(uploadFile(file, steps)).resolves.toEqual({ id: 'doc-1' });
    expect(seen.facts).toEqual([
      {
        fileName: 'Synthetic_W-2.pdf',
        contentType: 'application/pdf',
        sizeBytes: file.size,
        sha256: sha256('%PDF-1.4 synthetic'),
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: 'PUT', url: put.url, headers: put.headers });
    expect(sent[0]?.body).toBe(file);
    expect(sent[0]?.timeout).toBe(10 * 60_000);
    expect(seen.progress.at(-1)).toBe(100);
    expect(seen.tokens).toEqual(['put-token']);
  });

  it('is not sent again when storage refuses it (UPLOAD_FAILED)', async () => {
    reply = () => 500;
    const { steps, seen } = stepsFor(put);
    await expect(uploadFile(pdf('%PDF-1.4 synthetic'), steps)).rejects.toMatchObject({
      status: 502,
      code: 'UPLOAD_FAILED',
    });
    expect(sent).toHaveLength(1);
    expect(seen.tokens).toEqual([]);
  });

  it('sends nothing to a mock: URL (mock mode)', async () => {
    const { steps, seen } = stepsFor({ ...put, url: 'mock:upload/1' });
    await expect(uploadFile(pdf('%PDF-1.4 synthetic'), steps)).resolves.toEqual({ id: 'doc-1' });
    expect(sent).toHaveLength(0);
    expect(seen.progress).toEqual([100]);
  });

  it('fails as UPLOAD_FAILED (status 0) without a connection', async () => {
    reply = () => 'error';
    const { steps } = stepsFor(put);
    await expect(uploadFile(pdf('%PDF-1.4 synthetic'), steps)).rejects.toMatchObject({
      status: 0,
      code: 'UPLOAD_FAILED',
    });
  });
});

describe('uploadFile: a multipart upload', () => {
  it("sends each part's bytes to its own URL, with no headers and no type", async () => {
    const text = 'abcdefghijklmnopqrstuvwxy'; // 25 bytes: parts of 10, 10 and 5
    const { steps, seen } = stepsFor(multipart(3, 10));
    await expect(uploadFile(pdf(text), steps)).resolves.toEqual({ id: 'doc-1' });

    const byPart = new Map<number, FakeXhr>(sent.map((xhr) => [partOf(xhr), xhr]));
    expect([...byPart.keys()].sort()).toEqual([1, 2, 3]);
    const bodies = await Promise.all([1, 2, 3].map((n) => byPart.get(n)?.body?.text()));
    expect(bodies).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxy']);
    for (const xhr of sent) {
      expect(xhr.method).toBe('PUT');
      expect(xhr.headers).toEqual({});
      expect(xhr.body?.type).toBe('');
    }
    // The whole file's SHA-256, and the same confirm as a PUT.
    expect(seen.facts[0]?.sha256).toBe(sha256(text));
    expect(seen.tokens).toEqual(['token.with-a-dot']);
  });

  it('sends three parts at once, starting the next as one finishes', async () => {
    reply = () => 'hang';
    const { steps, seen } = stepsFor(multipart(7, 2));
    const done = uploadFile(pdf('0123456789abcd'), steps);
    await until(() => sent.length === 3);
    await settle();
    expect(sent.map(partOf)).toEqual([1, 2, 3]);

    sent[1]?.answer(200);
    await until(() => sent.length === 4);
    await settle();
    expect(sent.length).toBe(4);
    expect(partOf(sent[3]!)).toBe(4);

    // The rest answer at once.
    reply = () => 200;
    for (const xhr of [...sent]) xhr.answer(200);
    await expect(done).resolves.toEqual({ id: 'doc-1' });
    expect(sent.map(partOf).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(mostInFlight).toBe(3);
    expect(seen.tokens).toHaveLength(1);
  });

  it('sends a failed part again to the same URL after a growing wait', async () => {
    const answers: Reply[] = ['error', 503, 200];
    reply = (xhr) => (partOf(xhr) === 2 ? (answers.shift() ?? 200) : 200);
    const { steps, seen } = stepsFor(multipart(3, 4));
    const done = uploadFile(pdf('aaaabbbbcccc'), steps);

    const tries = () => sent.filter((xhr) => partOf(xhr) === 2).length;
    await until(() => tries() === 1 && sent.every((xhr) => xhr.done));
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(tries()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => tries() === 2 && sent.every((xhr) => xhr.done));
    await settle();
    await vi.advanceTimersByTimeAsync(1999);
    expect(tries()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => tries() === 3);

    await expect(done).resolves.toEqual({ id: 'doc-1' });
    const urls = sent.filter((xhr) => partOf(xhr) === 2).map((xhr) => xhr.url);
    expect(new Set(urls)).toEqual(new Set(['https://storage.test/upload/part-2']));
    // Progress never goes back while a part is sent again, and ends at 100.
    expect(seen.progress).toEqual([...seen.progress].sort((a, b) => a - b));
    expect(seen.progress.at(-1)).toBe(100);
    expect(seen.tokens).toHaveLength(1);
  });

  it('stops trying a part once the ticket would expire (UPLOAD_FAILED)', async () => {
    reply = (xhr) => (partOf(xhr) === 1 ? 500 : 200);
    const expiresAt = new Date(NOW.getTime() + 2_500).toISOString();
    const { steps, seen } = stepsFor(multipart(2, 4, { expiresAt }));
    const done = uploadFile(pdf('aaaabbbb'), steps);
    const failure = expect(done).rejects.toMatchObject({ status: 502, code: 'UPLOAD_FAILED' });

    await until(() => sent.length === 2 && sent.every((xhr) => xhr.done));
    await settle();
    await vi.advanceTimersByTimeAsync(1_000); // 1 s after the first try: still in time
    await until(() => sent.filter((xhr) => partOf(xhr) === 1).length === 2);
    await settle();
    // A 2 s wait would end past the ticket: no third try.
    await failure;
    expect(sent.filter((xhr) => partOf(xhr) === 1)).toHaveLength(2);
    expect(seen.tokens).toEqual([]);
  });

  it('stops every part on a 403 and asks to start again (UPLOAD_EXPIRED)', async () => {
    reply = (xhr) => (partOf(xhr) === 1 ? 403 : 'hang');
    const { steps, seen } = stepsFor(multipart(5, 2));
    const done = uploadFile(pdf('aabbccddee'), steps);

    const error = await done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 410,
      code: 'UPLOAD_EXPIRED',
      message: DOCUMENT_ERRORS.UPLOAD_EXPIRED,
    });
    expect(sent.map(partOf)).toEqual([1, 2, 3]);
    expect(sent.filter((xhr) => xhr.aborted).map(partOf)).toEqual([2, 3]);
    await settle();
    expect(sent).toHaveLength(3);
    expect(seen.tokens).toEqual([]);
  });

  it('reports the bytes sent of the whole file, up to 100', async () => {
    const { steps, seen } = stepsFor(multipart(4, 25));
    await uploadFile(pdf('x'.repeat(100)), steps);
    expect(seen.progress).toEqual([...seen.progress].sort((a, b) => a - b));
    expect(seen.progress).toContain(25);
    expect(seen.progress.at(-1)).toBe(100);
    expect(seen.progress.filter((p) => p === 100)).toHaveLength(1);
  });

  it('cancels every part in flight when the caller aborts', async () => {
    reply = () => 'hang';
    const controller = new AbortController();
    const { steps, seen } = stepsFor(multipart(6, 2), { signal: controller.signal });
    const done = uploadFile(pdf('aabbccddeeff'), steps);
    await until(() => sent.length === 3);

    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent.every((xhr) => xhr.aborted)).toBe(true);
    await settle();
    expect(sent).toHaveLength(3);
    expect(seen.tokens).toEqual([]);
  });

  it('cancels a part waiting to be sent again', async () => {
    reply = () => 'error';
    const controller = new AbortController();
    const { steps } = stepsFor(multipart(1, 4), { signal: controller.signal });
    const done = uploadFile(pdf('aaaa'), steps);
    await until(() => sent.length === 1 && sent[0]!.done);
    await settle();

    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(1);
  });

  it('sends nothing to mock: URLs (mock mode) and still confirms', async () => {
    const ticket = multipart(3, 4, { url: (n) => `mock:upload/7/part-${String(n)}` });
    const { steps, seen } = stepsFor(ticket);
    await expect(uploadFile(pdf('aaaabbbbcc'), steps)).resolves.toEqual({ id: 'doc-1' });
    expect(sent).toHaveLength(0);
    expect(seen.progress.at(-1)).toBe(100);
    expect(seen.tokens).toEqual(['token.with-a-dot']);
  });
});

describe("uploadFile: the flow's largest file", () => {
  /** A file's size is all the check reads, so no bytes are needed. */
  const sized = (size: number) =>
    ({ name: 'Synthetic.pdf', type: 'application/pdf', size }) as unknown as File;
  const TEN_MB = 10 * 1024 * 1024;

  it('refuses a file over a 10 MB flow limit before anything is sent', async () => {
    const { steps, seen } = stepsFor(multipart(2, TEN_MB), { maxBytes: TEN_MB });
    await expect(uploadFile(sized(TEN_MB + 1), steps)).rejects.toMatchObject({
      status: 400,
      code: 'FILE_TOO_LARGE',
      message: 'This file is larger than 10 MB. Choose a smaller file.',
    });
    expect(seen.facts).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it('never takes more than the documents limit (100 MB), whatever the flow says', async () => {
    const { steps, seen } = stepsFor(multipart(11, TEN_MB), {
      maxBytes: 2 * UPLOAD_LIMITS.maxBytes,
    });
    await expect(uploadFile(sized(UPLOAD_LIMITS.maxBytes + 1), steps)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
      message: DOCUMENT_ERRORS.FILE_TOO_LARGE,
    });
    expect(seen.facts).toEqual([]);
  });
});
