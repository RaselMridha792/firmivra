'use client';

import { ActionMenu, Button, Checkbox, Tabs } from '@firmivra/ui';
import {
  ChatText,
  Link as LinkIcon,
  ListBullets,
  ListNumbers,
  LockSimple,
  PaperPlaneTilt,
  Paperclip,
  TextB,
  TextItalic,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { useRef, useState, type RefObject } from 'react';
import {
  adminSupport,
  attachmentProblem,
  type CannedResponse,
  type TicketDetail,
} from '../../../../../../../mocks/admin-support';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { fileSize, SUPPORT, SUPPORT_ERRORS } from '../../../_components/support-data';

export type ComposerMode = 'REPLY' | 'NOTE';

function Tool({ icon: Glyph, label, onClick }: { icon: Icon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md text-heading hover:bg-canvas"
    >
      <Glyph aria-hidden weight="bold" className="size-5" />
    </button>
  );
}

/**
 * The reply editor under the conversation (docx §3 Reply editor, Send to client, Internal Note
 * mode): Reply and Internal Note tabs, the formatting tools, attachments, canned responses (they
 * fill the box and are never sent by themselves), "Send to client" and Send Reply. Internal notes
 * sit on an amber box so they never look like a client reply.
 */
export function TicketComposer({
  ticket,
  mode,
  onMode,
  text,
  onText,
  boxRef,
  canNote,
  canned,
  onSent,
}: {
  ticket: TicketDetail;
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  text: string;
  onText: (text: string) => void;
  boxRef: RefObject<HTMLTextAreaElement | null>;
  canNote: boolean;
  canned: CannedResponse[];
  onSent: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [sendToClient, setSendToClient] = useState(true);
  const [missing, setMissing] = useState(false);
  const send = useApiMutation(
    () =>
      adminSupport.reply(ticket.id, {
        mode,
        body: text,
        sendToClient: mode === 'REPLY' && sendToClient,
        attachments: files.map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          file,
        })),
      }),
    { invalidate: SUPPORT },
  );
  const note = mode === 'NOTE';

  /** Puts marks around the selection (or a placeholder) and selects the text between them. */
  function wrap(before: string, after: string, placeholder: string) {
    const box = boxRef.current;
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? text.length;
    const picked = text.slice(start, end) || placeholder;
    onText(text.slice(0, start) + before + picked + after + text.slice(end));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + before.length, start + before.length + picked.length);
    });
  }

  /** Starts each selected line with "- " or "1. ", "2. "… */
  function list(numbered: boolean) {
    const box = boxRef.current;
    const start = text.lastIndexOf('\n', (box?.selectionStart ?? text.length) - 1) + 1;
    const end = box?.selectionEnd ?? text.length;
    const lines = (text.slice(start, end) || 'List item').split('\n');
    const marked = lines.map((line, row) => `${numbered ? `${row + 1}.` : '-'} ${line}`).join('\n');
    onText(text.slice(0, start) + marked + text.slice(end));
    requestAnimationFrame(() => box?.focus());
  }

  function insert(response: CannedResponse) {
    const box = boxRef.current;
    const at = box?.selectionStart ?? text.length;
    const glue = at > 0 && !text.slice(0, at).endsWith('\n') ? '\n\n' : '';
    onText(text.slice(0, at) + glue + response.body + text.slice(at));
    requestAnimationFrame(() => box?.focus());
  }

  function submit() {
    if (!text.trim()) {
      setMissing(true);
      boxRef.current?.focus();
      return;
    }
    send.mutate(undefined, {
      onSuccess: () => {
        onText('');
        setFiles([]);
        setMissing(false);
        onSent(
          note
            ? 'Internal note added.'
            : sendToClient
              ? 'Reply sent to the client.'
              : 'Reply added to the conversation without sending it.',
        );
      },
    });
  }

  const suggested = [...canned].sort(
    (a, b) =>
      Number(b.categoryId === ticket.category.id) - Number(a.categoryId === ticket.category.id),
  );

  return (
    <section
      aria-label="Reply editor"
      data-testid="composer"
      className="rounded-xl border border-divider bg-surface px-4 pt-1 pb-4"
    >
      <Tabs
        label="Reply type"
        variant="underline"
        value={mode}
        onChange={(next) => onMode(next as ComposerMode)}
        items={[
          { id: 'REPLY', label: 'Reply' },
          ...(canNote ? [{ id: 'NOTE', label: 'Internal Note' }] : []),
        ]}
      />
      <div className={`mt-3 rounded-lg ${note ? 'bg-amber-surface p-3' : ''}`}>
        {note ? (
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-warning">
            <LockSimple aria-hidden weight="fill" className="size-4" />
            Staff only: internal notes are never shown to the client or sent in notifications.
          </p>
        ) : null}
        <label htmlFor="ticket-reply" className="sr-only">
          {note ? 'Internal note' : 'Reply'}
        </label>
        <textarea
          id="ticket-reply"
          ref={boxRef}
          rows={3}
          maxLength={5000}
          value={text}
          aria-invalid={missing && !text.trim() ? true : undefined}
          placeholder={note ? 'Add an internal note for the team...' : 'Type your reply here...'}
          onChange={(event) => {
            onText(event.target.value);
            setMissing(false);
          }}
          className={`w-full rounded-lg border px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-focus ${note ? 'border-gold bg-surface' : 'border-border bg-surface'} ${missing && !text.trim() ? 'border-danger' : ''}`}
        />
        {missing && !text.trim() ? (
          <p className="mt-1 text-xs text-danger">
            {note ? 'Write the note first.' : 'Write a reply first.'}
          </p>
        ) : null}
      </div>
      {files.length ? (
        <ul aria-label="Files to attach" className="mt-2 flex flex-wrap gap-2">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="inline-flex items-center gap-1 rounded-md bg-canvas py-1 pr-1 pl-2 text-xs text-text"
            >
              <Paperclip aria-hidden weight="bold" className="size-3.5" />
              {file.name} ({fileSize(file.size)})
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles(files.filter((f) => f !== file))}
                className="rounded-sm p-0.5 hover:bg-surface"
              >
                <X aria-hidden weight="bold" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {fileError ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {fileError}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-1">
          <Tool icon={Paperclip} label="Attach files" onClick={() => fileRef.current?.click()} />
          <span aria-hidden className="mx-1 h-6 w-px bg-divider" />
          <Tool icon={TextB} label="Bold" onClick={() => wrap('**', '**', 'bold text')} />
          <Tool icon={TextItalic} label="Italic" onClick={() => wrap('*', '*', 'italic text')} />
          <Tool
            icon={LinkIcon}
            label="Link"
            onClick={() => wrap('[', '](https://)', 'link text')}
          />
          <span aria-hidden className="mx-1 h-6 w-px bg-divider" />
          <Tool icon={ListBullets} label="Bulleted list" onClick={() => list(false)} />
          <Tool icon={ListNumbers} label="Numbered list" onClick={() => list(true)} />
          {suggested.length ? (
            <ActionMenu
              align="left"
              label="Insert canned response"
              trigger={
                <>
                  <ChatText aria-hidden weight="fill" className="size-4" />
                  <span className="hidden sm:inline">Canned</span>
                </>
              }
              sections={[
                {
                  title: 'Insert, then edit before sending',
                  items: suggested.map((response) => ({
                    label: response.title,
                    onSelect: () => insert(response),
                  })),
                },
              ]}
            />
          ) : null}
          <input
            ref={fileRef}
            type="file"
            multiple
            aria-label="Attach files"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])];
              event.target.value = '';
              const problems = picked.map(attachmentProblem).filter(Boolean);
              setFileError(problems.join(' '));
              setFiles([...files, ...picked.filter((file) => !attachmentProblem(file))]);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {note ? null : (
            <Checkbox
              label="Send to client"
              checked={sendToClient}
              onChange={(event) => setSendToClient(event.target.checked)}
            />
          )}
          <Button onClick={submit} disabled={send.isPending}>
            <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
            {send.isPending ? 'Sending…' : note ? 'Add Note' : 'Send Reply'}
          </Button>
        </div>
      </div>
      {send.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {errorMessage(send.error, SUPPORT_ERRORS)}
        </p>
      ) : null}
    </section>
  );
}
