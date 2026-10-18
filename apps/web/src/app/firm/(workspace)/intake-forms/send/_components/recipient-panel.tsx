'use client';

import type { ClientListItem, LeadListItem } from '@firmivra/types';
import { type KeyboardEvent, type ReactNode, useDeferredValue, useId, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { FieldError, FieldLabel, Loading, Panel, QuietLine, UNAVAILABLE } from './panel';
import { PersonPicker, type PickerOption } from './person-picker';
import type { Recipient } from './send-model';

const LIMIT = 25;
const KINDS: { kind: Recipient['kind']; label: string }[] = [
  { kind: 'CLIENT', label: 'Client' },
  { kind: 'LEAD', label: 'Lead' },
];

export const contactLine = (r: Pick<Recipient, 'email' | 'phone'>) =>
  [r.email, r.phone].filter(Boolean).join(' | ');

const fromClient = (c: ClientListItem): Recipient => ({
  kind: 'CLIENT',
  id: c.id,
  name: c.displayName,
  firstName:
    c.accountType === 'INDIVIDUAL'
      ? (c.displayName.split(/\s+/)[0] ?? c.displayName)
      : c.displayName,
  email: c.email,
  phone: c.phone,
  portal: c.portalStatus === 'ACTIVE',
});

const fromLead = (l: LeadListItem): Recipient => ({
  kind: 'LEAD',
  id: l.id,
  name: `${l.firstName} ${l.lastName}`.trim(),
  firstName: l.firstName,
  email: l.email,
  phone: l.phone,
  portal: false,
});

const toOption = (r: Recipient): PickerOption => ({
  id: r.id,
  name: r.name,
  detail: contactLine(r),
});

/** Client | Lead: a two-way switch as wide as the card. */
function KindSwitch({
  kind,
  onKind,
}: {
  kind: Recipient['kind'];
  onKind: (kind: Recipient['kind']) => void;
}) {
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next = kind === 'CLIENT' ? 'LEAD' : 'CLIENT';
    onKind(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-kind="${next}"]`)?.focus();
  }
  return (
    <div
      role="radiogroup"
      aria-label="Send to"
      onKeyDown={onKey}
      className="grid grid-cols-2 rounded-lg bg-folder-surface"
    >
      {KINDS.map((k) => (
        <button
          key={k.kind}
          type="button"
          role="radio"
          data-kind={k.kind}
          aria-checked={kind === k.kind}
          tabIndex={kind === k.kind ? 0 : -1}
          onClick={() => onKind(k.kind)}
          className={`min-h-11 rounded-lg px-4 text-sm font-medium ${kind === k.kind ? 'bg-action text-on-action' : 'text-heading hover:bg-folder-hover'}`}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

interface PickerProps {
  value: Recipient | undefined;
  onSelect: (recipient: Recipient | undefined) => void;
  error: string | undefined;
}

/**
 * The Client or Lead field. Loading, no records and an unreachable API keep the field's label
 * with a quiet line; a search that fails or finds nothing says so inside the open list.
 */
function RecipientField({
  noun,
  search,
  onSearch,
  term,
  pending,
  failed,
  items,
  value,
  onSelect,
  error,
}: PickerProps & {
  noun: 'client' | 'lead';
  search: string;
  onSearch: (search: string) => void;
  /** The search the list was asked for (deferred). */
  term: string;
  pending: boolean;
  failed: boolean;
  items: Recipient[] | undefined;
}) {
  const labelId = useId();
  const buttonId = useId();
  const errorId = useId();
  const title = noun === 'client' ? 'Client' : 'Lead';
  const plural = `${noun}s`;
  const first = term === '' && !value;

  let body: ReactNode;
  if (first && pending) body = <Loading rows={1} />;
  else if (first && failed) body = <QuietLine>{UNAVAILABLE}</QuietLine>;
  else if (first && items?.length === 0)
    body = (
      <QuietLine>
        No {plural} yet. Add a {noun} first, then send the form.
      </QuietLine>
    );
  else
    body = (
      <PersonPicker
        labelId={labelId}
        buttonId={buttonId}
        listLabel={`${title}s`}
        placeholder={`Select a ${noun}`}
        value={value ? toOption(value) : undefined}
        options={(items ?? []).map(toOption)}
        onSelect={(option) => onSelect(items?.find((r) => r.id === option?.id))}
        search={{ label: `Search ${plural}`, value: search, onChange: onSearch }}
        status={
          pending
            ? 'Searching…'
            : failed
              ? UNAVAILABLE
              : items?.length === 0
                ? `No ${plural} match your search.`
                : undefined
        }
        error={error}
        errorId={errorId}
      />
    );

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel id={labelId} htmlFor={buttonId} required>
        {title}
      </FieldLabel>
      {body}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

/** Clients: GET /business/clients, searched by name, email and phone (Staff: their own). */
function ClientPicker(props: PickerProps) {
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const list = useApiQuery(['intake-forms', 'send', 'clients', term], () =>
    api.clients.list({ search: term || undefined, limit: LIMIT }),
  );
  return (
    <RecipientField
      {...props}
      noun="client"
      search={search}
      onSearch={setSearch}
      term={term}
      pending={list.isPending}
      failed={list.isError}
      items={list.data?.items.map(fromClient)}
    />
  );
}

/** Leads: GET /business/leads, searched by name, email and phone. */
function LeadPicker(props: PickerProps) {
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const list = useApiQuery(['intake-forms', 'send', 'leads', term], () =>
    api.leads.list({ search: term || undefined, limit: LIMIT }),
  );
  return (
    <RecipientField
      {...props}
      noun="lead"
      search={search}
      onSearch={setSearch}
      term={term}
      pending={list.isPending}
      failed={list.isError}
      items={list.data?.items.map(fromLead)}
    />
  );
}

/** Step 1: Client or Lead, then the person. */
export function RecipientPanel({
  kind,
  onKind,
  recipient,
  onRecipient,
  error,
}: {
  kind: Recipient['kind'];
  onKind: (kind: Recipient['kind']) => void;
  recipient: Recipient | undefined;
  onRecipient: (recipient: Recipient | undefined) => void;
  error: string | undefined;
}) {
  const props = { value: recipient, onSelect: onRecipient, error };
  return (
    <Panel
      step={1}
      title="Select Recipient"
      subtitle="Choose who will receive this form."
      testId="send-recipient"
    >
      <KindSwitch kind={kind} onKind={onKind} />
      {kind === 'CLIENT' ? <ClientPicker {...props} /> : <LeadPicker {...props} />}
    </Panel>
  );
}
