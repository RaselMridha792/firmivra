'use client';

import type { MessageTemplateRow } from '@firmivra/types';
import { Smiley } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';

// New Message and the reply box (MSG-F11, F15): a message template of the channel's kind from
// the shared Templates library, the merge fields of the canonical list, and emoji. Each fills the
// text, which stays editable.

const field =
  'h-10 min-w-0 rounded-lg border border-divider bg-surface px-3 text-sm text-text disabled:opacity-50';
const small =
  'inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-action bg-surface px-3 text-sm font-semibold text-action hover:bg-accent-soft disabled:opacity-50';

/** A message channel's template kind in the library. */
export const TEMPLATE_KIND = { PORTAL: 'PORTAL_MESSAGE', EMAIL: 'EMAIL', SMS: 'SMS' } as const;

/** A template's text as plain text: an email template's markup becomes its lines. */
export function plainText(body: string): string {
  if (!/<[a-z][\s\S]*>/i.test(body)) return body;
  const doc = new DOMParser().parseFromString(
    body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n'),
    'text/html',
  );
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Message Template (optional) and Use Template: the library's active templates of the kind. */
export function TemplatePicker({
  kind,
  onUse,
  disabled,
}: {
  kind: (typeof TEMPLATE_KIND)[keyof typeof TEMPLATE_KIND];
  onUse: (t: { id: string; subject: string | null; body: string }) => void;
  disabled?: boolean;
}) {
  const list = useApiQuery(['messages', 'templates', kind], () =>
    api.templates.list({ kind, status: 'ACTIVE', pageSize: 100 }),
  );
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const items: MessageTemplateRow[] = list.data?.items ?? [];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-heading">
        Message Template <span className="font-normal text-muted">(optional)</span>
      </span>
      <div className="flex gap-2">
        <select
          aria-label="Message Template"
          className={`${field} flex-1`}
          value={chosen}
          disabled={disabled}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value="">
            {list.isError
              ? 'Templates are not available'
              : items.length === 0
                ? 'No active templates for this channel'
                : 'Select a template…'}
          </option>
          {items.map((t) => (
            <option key={t.id} value={t.id}>
              {t.category ? `${t.category.name} · ` : ''}
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={small}
          disabled={disabled || !chosen || busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              const t = await api.templates.get(chosen);
              onUse({ id: t.id, subject: t.subject, body: plainText(t.body) });
            } catch (e) {
              setError(errorMessage(e));
            }
            setBusy(false);
          }}
        >
          Use Template
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Merge Fields: inserts a field of the canonical list, filled for each person when it is sent. */
export function MergeFieldPicker({
  onInsert,
  disabled,
}: {
  onInsert: (token: string) => void;
  disabled?: boolean;
}) {
  const fields = useApiQuery(['messages', 'merge-fields'], () => api.templates.mergeFields());
  const usable = (fields.data ?? []).filter((f) => !f.sensitive);
  return (
    <select
      aria-label="Merge Fields"
      className={field}
      value=""
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value) onInsert(`[${e.target.value}]`);
      }}
    >
      <option value="">Merge Fields</option>
      {usable.map((f) => (
        <option key={f.key} value={f.key}>
          {f.label}
        </option>
      ))}
    </select>
  );
}

const EMOJI = [
  '😀',
  '🙂',
  '😊',
  '👍',
  '🙏',
  '👋',
  '🎉',
  '✅',
  '📄',
  '📅',
  '💼',
  '📎',
  '⏰',
  '💬',
  '⭐',
  '❤️',
];

/** Emoji: a small grid that inserts one into the text. */
export function EmojiPicker({
  onPick,
  disabled,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) =>
      rootRef.current && !rootRef.current.contains(event.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Emoji"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex size-10 items-center justify-center rounded-lg border border-divider bg-surface text-action hover:bg-canvas disabled:opacity-50"
      >
        <Smiley aria-hidden weight="bold" className="size-5" />
      </button>
      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label="Choose an emoji"
          onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
          className="absolute bottom-full left-0 z-20 mb-2 grid w-56 grid-cols-8 gap-1 rounded-xl border border-divider bg-surface p-2 shadow-lg"
        >
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`Insert ${e}`}
              className="flex size-6 items-center justify-center rounded text-base hover:bg-canvas"
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
