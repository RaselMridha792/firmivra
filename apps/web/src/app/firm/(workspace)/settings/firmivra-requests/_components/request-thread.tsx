'use client';

import {
  type FirmivraRequestFile,
  type FirmivraRequestThread,
  SUPPORT_ATTACHMENT_LIMITS,
} from '@firmivra/types';
import { Button, FileDropzone, IconButton } from '@firmivra/ui';
import { ArrowLeft, ChatText, DownloadSimple, Paperclip, Trash } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { uploadFile } from '../../../../../../lib/upload';
import { Quiet, SettingsCard } from '../../_components/settings-parts';
import { dayText, OWNER_ONLY, REQUESTS_KEY, RequestStatus } from './requests-screen';

const threadKey = (id: string) => [...REQUESTS_KEY, id] as const;
/** The picker's types: each content type and its file name endings. */
const ACCEPT = Object.entries(SUPPORT_ATTACHMENT_LIMITS.types).flatMap(([type, ends]) => [
  type,
  ...ends,
]);

const ERRORS: Record<string, string> = {
  REQUEST_CLOSED: 'Firmivra has closed this request. Send Firmivra a new message if you need to.',
};

const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
const sizeText = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : megabytes(bytes);

/** "Nov 19, 2026, 3:05 PM": the viewer's own time. */
const timeText = (value: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );

function FileRow({ requestId, file }: { requestId: string; file: FirmivraRequestFile }) {
  const [failed, setFailed] = useState('');
  const clean = file.scanStatus === 'CLEAN';
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <Paperclip aria-hidden className="size-4 text-muted" />
      <span className="min-w-0 break-all text-text">{file.fileName}</span>
      <span className="text-muted">{sizeText(file.sizeBytes)}</span>
      {clean ? (
        <button
          type="button"
          onClick={() => {
            setFailed('');
            void api.firmivraRequests.fileLink(requestId, file.id).then(
              (link) => window.location.assign(link.url),
              (error: unknown) => setFailed(errorMessage(error)),
            );
          }}
          className="inline-flex items-center gap-1 font-medium text-link hover:underline"
        >
          <DownloadSimple aria-hidden weight="bold" className="size-4" />
          Download
          <span className="sr-only"> {file.fileName}</span>
        </button>
      ) : (
        <span className="text-muted">
          {file.scanStatus === 'PENDING'
            ? 'Being checked for viruses'
            : 'Blocked by the virus check'}
        </span>
      )}
      {failed ? (
        <span role="alert" className="text-danger">
          {failed}
        </span>
      ) : null}
    </li>
  );
}

/** The Owner's answer: text and up to 10 files, each uploaded first, then sent with the text. */
function AnswerForm({ thread }: { thread: FirmivraRequestThread }) {
  const id = useId();
  const client = useQueryClient();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const text = body.trim();
    if (!text) {
      setMissing(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const uploadTokens: string[] = [];
      for (const file of files) {
        uploadTokens.push(
          await uploadFile(file, {
            start: (facts) => api.firmivraRequests.createUpload(thread.id, facts),
            // Support's files have no confirm step: the answer checks them.
            finish: (token) => Promise.resolve(token),
            maxBytes: SUPPORT_ATTACHMENT_LIMITS.maxBytes,
          }),
        );
      }
      const next = await api.firmivraRequests.reply(thread.id, {
        requestId: (requestId.current ??= crypto.randomUUID()),
        body: text,
        uploadTokens,
      });
      client.setQueryData(threadKey(thread.id), next);
      void client.invalidateQueries({ queryKey: REQUESTS_KEY, exact: true });
      setBody('');
      setFiles([]);
      requestId.current = null;
    } catch (failure) {
      setError(errorMessage(failure, ERRORS));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      title="Your answer"
      subtitle="Firmivra sees your answer and files on this request."
      icon={ChatText}
      testId="firmivra-answer"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <label htmlFor={`${id}-body`} className="text-sm font-medium text-heading">
          Answer (required)
        </label>
        <textarea
          id={`${id}-body`}
          value={body}
          rows={5}
          maxLength={5000}
          onChange={(event) => {
            setBody(event.target.value);
            setMissing(false);
          }}
          aria-invalid={missing || undefined}
          aria-describedby={missing ? `${id}-missing` : undefined}
          className="w-full resize-y rounded-control border border-border bg-surface p-3 text-sm text-text aria-[invalid=true]:border-danger"
        />
        {missing ? (
          <p id={`${id}-missing`} className="text-xs text-danger">
            Write your answer.
          </p>
        ) : null}
        <FileDropzone
          label="Files for Firmivra"
          icon={Paperclip}
          title="Drag and drop files here, or click to browse"
          accept={ACCEPT}
          maxBytes={SUPPORT_ATTACHMENT_LIMITS.maxBytes}
          maxFiles={SUPPORT_ATTACHMENT_LIMITS.maxFiles}
          hints={[
            `Accepted formats: ${SUPPORT_ATTACHMENT_LIMITS.typeNames}`,
            `Max size: ${megabytes(SUPPORT_ATTACHMENT_LIMITS.maxBytes)} per file, up to ${SUPPORT_ATTACHMENT_LIMITS.maxFiles} files`,
          ]}
          disabled={busy}
          onFiles={(chosen) => {
            setRejected('');
            setFiles((current) =>
              [...current, ...chosen].slice(0, SUPPORT_ATTACHMENT_LIMITS.maxFiles),
            );
          }}
          onReject={(rejections) =>
            setRejected(
              rejections
                .map(({ file, reason }) =>
                  reason === 'size'
                    ? `${file.name} is larger than ${megabytes(SUPPORT_ATTACHMENT_LIMITS.maxBytes)}.`
                    : `${file.name} isn't a file type Firmivra takes.`,
                )
                .join(' '),
            )
          }
        />
        {rejected ? (
          <p role="alert" className="text-sm text-danger">
            {rejected}
          </p>
        ) : null}
        {files.length ? (
          <ul aria-label="Files to send" className="flex flex-col gap-1">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center gap-2 text-sm">
                <Paperclip aria-hidden className="size-4 text-muted" />
                <span className="min-w-0 flex-1 break-all text-text">{file.name}</span>
                <span className="text-muted">{sizeText(file.size)}</span>
                <IconButton
                  icon={Trash}
                  tone="danger"
                  label={`Remove ${file.name}`}
                  disabled={busy}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send Answer'}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}

function Thread({ id }: { id: string }) {
  const query = useApiQuery(threadKey(id), () => api.firmivraRequests.get(id));
  return (
    <PageState query={query}>
      {(thread) => (
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              {thread.subject}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
              <RequestStatus status={thread.status} />
              <span>
                Request #{thread.number} · asked {dayText(thread.requestedAt)}
              </span>
            </div>
          </header>
          <SettingsCard title="Firmivra's request" icon={ChatText} testId="firmivra-request-text">
            <p className="whitespace-pre-wrap break-words text-sm text-text">{thread.request}</p>
          </SettingsCard>
          {thread.messages.length ? (
            <ol aria-label="Conversation" className="flex flex-col gap-3">
              {thread.messages.map((m) => (
                <li
                  key={m.id}
                  data-testid="firmivra-message"
                  className={`flex flex-col gap-2 rounded-xl border border-divider p-4 ${m.from === 'FIRM' ? 'bg-surface' : 'bg-info-soft'}`}
                >
                  <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold text-heading">{m.authorName}</span>
                    <time dateTime={m.at} className="text-muted">
                      {timeText(m.at)}
                    </time>
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-text">{m.body}</p>
                  {m.files.length ? (
                    <ul className="flex flex-col gap-1">
                      {m.files.map((f) => (
                        <FileRow key={f.id} requestId={thread.id} file={f} />
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {thread.canReply ? (
            <AnswerForm thread={thread} />
          ) : (
            <Quiet>
              Firmivra has closed this request. Send Firmivra a new message if you need to.
            </Quiet>
          )}
        </div>
      )}
    </PageState>
  );
}

/** One request from Firmivra and its conversation, with the Owner's answer form. */
export function FirmivraRequestScreen({ id }: { id: string }) {
  const { role } = useFirm();
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/settings/firmivra-requests"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-link hover:underline"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" />
        Back to Requests from Firmivra
      </Link>
      {role === 'OWNER' ? <Thread id={id} /> : <Quiet>{OWNER_ONLY}</Quiet>}
    </div>
  );
}
