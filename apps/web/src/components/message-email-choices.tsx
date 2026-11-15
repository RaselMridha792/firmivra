'use client';

import {
  type ClientMessagePreference,
  MESSAGE_BODY_EMAIL_WARNING,
  type MessageDelivery,
} from '@firmivra/types';
import { Checkbox } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../lib/api';
import { useApiQuery } from '../lib/query';

/**
 * Tax Returns Review 2 (Messaging): the email a client gets about a firm message, chosen per send.
 * The message always reaches the client's portal; the email says one is waiting, and may carry the
 * text (with a warning) and the documents as sign-in links into the portal. The choices start from
 * the client's saved preference, else the firm's defaults; Save keeps them for the client.
 */
export interface EmailChoicesValue {
  emailNotice: boolean;
  emailIncludesBody: boolean;
  emailIncludesDocuments: boolean;
  saveForClient: boolean;
}

/** The choices for one client's composer; `delivery` goes on the send. */
export function useEmailChoices(clientId: string | undefined) {
  const pref = useApiQuery(['messages', 'preference', clientId ?? ''], () =>
    clientId ? api.messages.preference(clientId) : Promise.resolve(null),
  );
  // Edits belong to the client they were made for; another client starts from its own.
  const [edit, setEdit] = useState<{ clientId: string; value: EmailChoicesValue }>();
  const loaded = pref.data ? { ...pref.data.effective, saveForClient: false } : null;
  const value = edit && edit.clientId === clientId ? edit.value : loaded;
  const delivery: MessageDelivery | undefined = value
    ? {
        emailNotice: value.emailNotice,
        emailIncludesBody: value.emailNotice && value.emailIncludesBody,
        emailIncludesDocuments: value.emailNotice && value.emailIncludesDocuments,
        ...(value.saveForClient ? { saveForClient: true } : {}),
      }
    : undefined;
  return {
    preference: pref.data ?? null,
    value,
    delivery,
    set: (v: EmailChoicesValue) => {
      if (clientId) setEdit({ clientId, value: v });
    },
    /** After a send: the next message starts from the (maybe just saved) preference. */
    reset: () => setEdit(undefined),
  };
}

const summary = (v: EmailChoicesValue) =>
  !v.emailNotice
    ? 'No email: portal only'
    : [
        'Email notice',
        v.emailIncludesBody ? 'with the text' : null,
        v.emailIncludesDocuments ? 'document links' : null,
      ]
        .filter(Boolean)
        .join(', ');

/** The choices; `compact` folds them under a one-line summary (the conversation's composer). */
export function EmailChoices({
  choices,
  clientName,
  compact = false,
}: {
  choices: ReturnType<typeof useEmailChoices>;
  clientName?: string;
  compact?: boolean;
}) {
  const { value, set, preference } = choices;
  if (!value || !preference) return null;
  const body = <Fields value={value} set={set} preference={preference} clientName={clientName} />;
  if (compact) {
    return (
      <details className="text-sm" data-testid="email-choices">
        <summary className="cursor-pointer text-xs font-medium text-muted">
          Email to the client: {summary(value)}
        </summary>
        <div className="mt-2">{body}</div>
      </details>
    );
  }
  return <div data-testid="email-choices">{body}</div>;
}

function Fields({
  value,
  set,
  preference,
  clientName,
}: {
  value: EmailChoicesValue;
  set: (v: EmailChoicesValue) => void;
  preference: ClientMessagePreference;
  clientName?: string;
}) {
  const on = value.emailNotice;
  return (
    <fieldset className="flex flex-col gap-2 rounded-control border border-border p-3 text-sm">
      <legend className="px-1 text-xs font-semibold text-muted">Email to the client</legend>
      <p className="text-xs text-muted">The message always goes to their client portal.</p>
      <Checkbox
        label="Email them that a new message is waiting"
        checked={on}
        onChange={(e) => set({ ...value, emailNotice: e.target.checked })}
      />
      {preference.bodyAllowed ? (
        <Checkbox
          label="Include the message text in the email"
          checked={on && value.emailIncludesBody}
          disabled={!on}
          onChange={(e) => set({ ...value, emailIncludesBody: e.target.checked })}
        />
      ) : null}
      {on && value.emailIncludesBody ? (
        <p role="note" className="rounded-lg bg-warning-soft p-2 text-xs text-heading">
          {MESSAGE_BODY_EMAIL_WARNING}
        </p>
      ) : null}
      <Checkbox
        label="Link its documents (they open after signing in to the portal)"
        checked={on && value.emailIncludesDocuments}
        disabled={!on}
        onChange={(e) => set({ ...value, emailIncludesDocuments: e.target.checked })}
      />
      <Checkbox
        label={`Save as ${clientName ?? 'this client'}'s preference`}
        checked={value.saveForClient}
        onChange={(e) => set({ ...value, saveForClient: e.target.checked })}
      />
    </fieldset>
  );
}
