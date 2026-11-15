'use client';

import {
  APPLICATION_RESPONSE_ERRORS,
  APPLICATION_RESPONSE_LIMITS,
  ApiRequestError,
  ApplicationResponseContentType,
  type ApplicationResponseRequestView,
  DOCUMENT_ERRORS,
  megabytes,
  uploadContentTypeFor,
} from '@firmivra/types';
import { Button, Card, FileDropzone, Input, Textarea } from '@firmivra/ui';
import { CheckCircle2, FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { uploadFile } from '../../../../../lib/upload';

type State =
  | { kind: 'loading' }
  | { kind: 'gone'; message: string }
  | { kind: 'request'; token: string; view: ApplicationResponseRequestView; codeSent: boolean }
  | { kind: 'answer'; token: string; view: ApplicationResponseRequestView; session: string }
  | { kind: 'done' };

const ENDED =
  'This link no longer works. It may have expired, been answered, or been replaced by a newer request. Check your email for the latest one.';
/** The link's own 410s end the page; anything else is shown where it happened. */
const isGone = (e: unknown) =>
  e instanceof ApiRequestError &&
  (e.status === 410 || e.code === 'LINK_EXPIRED' || e.code === 'SESSION_EXPIRED');
const ACCEPT = ['.pdf', '.jpg', '.jpeg', '.png'];
const WORDS: Record<string, string> = { ...DOCUMENT_ERRORS, ...APPLICATION_RESPONSE_ERRORS };
const dateText = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The applicant's answer (SA-APP-F04, Y06): the request, a 6-digit code to the application's
 * contact email, then written text, files (PDF, JPG or PNG, 10 MB each, at most 10) or both,
 * sent on the same application.
 */
export function RespondScreen() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string>();

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    let live = true;
    (token
      ? api.firmApplications.respond.open({ token })
      : Promise.reject(new ApiRequestError(410, 'LINK_EXPIRED', ENDED))
    )
      .then((view) => live && token && setState({ kind: 'request', token, view, codeSent: false }))
      .catch((e: unknown) => {
        if (!live) return;
        setState({
          kind: 'gone',
          message: isGone(e) || e instanceof ApiRequestError ? ENDED : errorMessage(e),
        });
      });
    return () => {
      live = false;
    };
  }, []);

  const failed = (e: unknown) => {
    if (isGone(e)) setState({ kind: 'gone', message: errorMessage(e, WORDS) });
    else setError(errorMessage(e, WORDS));
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  };

  if (state.kind === 'loading')
    return (
      <Card className="w-full p-7 shadow-card" data-testid="respond-loading">
        <p className="text-muted">Opening the request…</p>
      </Card>
    );
  if (state.kind === 'gone')
    return (
      <Card className="w-full p-7 shadow-card sm:p-10" data-testid="respond-gone">
        <h1 className="font-serif text-2xl font-bold text-heading">This link has ended</h1>
        <p className="mt-3 leading-7 text-muted" role="status">
          {state.message}
        </p>
      </Card>
    );
  if (state.kind === 'done')
    return (
      <Card className="w-full p-7 text-center shadow-card sm:p-10" data-testid="respond-done">
        <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
          <CheckCircle2 aria-hidden className="size-9" />
        </span>
        <h1 className="mt-5 font-serif text-3xl font-bold text-heading">Thank you</h1>
        <p className="mx-auto mt-4 max-w-lg leading-7 text-muted">
          Your answer was added to your application. Our team will review it and email the next
          steps to your contact address.
        </p>
      </Card>
    );

  const { view } = state;
  const header = (
    <>
      <p className="text-sm font-semibold text-action">{view.legalName}</p>
      <h1 className="mt-1 font-serif text-3xl font-bold text-heading">More information needed</h1>
      <blockquote
        className="mt-4 rounded-control border-l-4 border-action bg-canvas px-4 py-3 whitespace-pre-line text-text"
        data-testid="respond-reason"
      >
        {view.reason}
      </blockquote>
      <p className="mt-2 text-sm text-muted">This link works until {dateText(view.expiresAt)}.</p>
    </>
  );
  const errorLine = error ? (
    <p role="alert" className="mt-4 rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">
      {error}
    </p>
  ) : null;

  if (state.kind === 'request') {
    const { token } = state;
    const sendCode = () =>
      run(async () => {
        await api.firmApplications.respond.sendCode({ token });
        setState({ ...state, codeSent: true });
      });
    const verify = () =>
      run(async () => {
        const { session } = await api.firmApplications.respond.verifyCode({
          token,
          code: code.trim(),
        });
        setState({ kind: 'answer', token, view, session });
      });
    return (
      <Card className="w-full p-7 shadow-card sm:p-10" data-testid="respond-request">
        {header}
        {errorLine}
        <div className="mt-6 border-t border-divider pt-6">
          <h2 className="text-lg font-semibold text-heading">Confirm it is you</h2>
          <p className="mt-1 text-muted">
            We send a 6-digit code to {view.codeSentTo}, the application&apos;s contact email.
          </p>
          {state.codeSent ? (
            <div className="mt-4 flex flex-col gap-3">
              <Input
                label="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy || code.length !== 6} onClick={() => void verify()}>
                  Continue
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void sendCode()}>
                  Send a new code
                </Button>
              </div>
              <p className="text-sm text-muted">The code works for 10 minutes.</p>
            </div>
          ) : (
            <Button className="mt-4" disabled={busy} onClick={() => void sendCode()}>
              Send the code
            </Button>
          )}
        </div>
      </Card>
    );
  }

  const { session } = state;
  const addFiles = (picked: File[]) => {
    setError(undefined);
    const fit = picked.filter(
      (f) => ApplicationResponseContentType.safeParse(uploadContentTypeFor(f.name, f.type)).success,
    );
    if (fit.length < picked.length) setError('Attach PDF, JPG or PNG files only.');
    setFiles((now) => {
      const next = [...now, ...fit];
      if (next.length > APPLICATION_RESPONSE_LIMITS.maxFiles)
        setError(`Attach at most ${APPLICATION_RESPONSE_LIMITS.maxFiles} files.`);
      return next.slice(0, APPLICATION_RESPONSE_LIMITS.maxFiles);
    });
  };
  const send = () =>
    run(async () => {
      const uploadTokens: string[] = [];
      for (const [i, file] of files.entries()) {
        setProgress(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
        uploadTokens.push(
          await uploadFile(file, {
            start: (facts) =>
              api.firmApplications.respond.createUpload({
                session,
                ...facts,
                contentType: facts.contentType as ApplicationResponseContentType,
              }),
            finish: (token) => Promise.resolve(token),
            maxBytes: APPLICATION_RESPONSE_LIMITS.maxBytes,
          }),
        );
      }
      setProgress('Sending your answer…');
      await api.firmApplications.respond.submit({
        session,
        ...(text.trim() ? { text: text.trim() } : {}),
        uploadTokens,
      });
      setState({ kind: 'done' });
    });
  const empty = !text.trim() && files.length === 0;
  return (
    <Card className="w-full p-7 shadow-card sm:p-10" data-testid="respond-answer">
      {header}
      {errorLine}
      <div className="mt-6 flex flex-col gap-4 border-t border-divider pt-6">
        <h2 className="text-lg font-semibold text-heading">Your answer</h2>
        <p className="-mt-3 text-muted">Write an answer, attach files, or both.</p>
        <Textarea
          label="Answer"
          rows={6}
          maxLength={APPLICATION_RESPONSE_LIMITS.maxTextLength}
          value={text}
          onChange={(e) => setText(e.target.value)}
          hint={`Up to ${APPLICATION_RESPONSE_LIMITS.maxTextLength} characters.`}
        />
        <FileDropzone
          label="Files"
          accept={ACCEPT}
          maxBytes={APPLICATION_RESPONSE_LIMITS.maxBytes}
          maxFiles={APPLICATION_RESPONSE_LIMITS.maxFiles}
          onFiles={addFiles}
          onReject={() =>
            setError(
              `Attach PDF, JPG or PNG files up to ${megabytes(APPLICATION_RESPONSE_LIMITS.maxBytes)} each, at most ${APPLICATION_RESPONSE_LIMITS.maxFiles}.`,
            )
          }
          hints={[
            `PDF, JPG or PNG, up to ${megabytes(APPLICATION_RESPONSE_LIMITS.maxBytes)} each, at most ${APPLICATION_RESPONSE_LIMITS.maxFiles}`,
          ]}
        />
        {files.length ? (
          <ul className="flex flex-col gap-2" aria-label="Files to send">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${f.size}-${f.lastModified}`}
                className="flex items-center justify-between gap-3 rounded-control border border-divider px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2 text-text">
                  <FileText aria-hidden className="size-4 shrink-0 text-muted" />
                  <span className="truncate">{f.name}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  className="rounded-control p-1 text-muted hover:text-danger"
                  disabled={busy}
                  onClick={() => setFiles((now) => now.filter((_, n) => n !== i))}
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {progress ? (
          <p role="status" className="text-sm text-muted">
            {progress}
          </p>
        ) : null}
        <Button disabled={busy || empty} onClick={() => void send()}>
          Send answer
        </Button>
      </div>
    </Card>
  );
}
