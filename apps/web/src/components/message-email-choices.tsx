'use client';

import {
  type ClientMessagePreference,
  MESSAGE_BODY_EMAIL_WARNING,
  MESSAGE_DOCUMENTS_AS_LINKS_NOTE,
  type MessageDelivery,
} from '@firmivra/types';
import { Checkbox } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../lib/api';
import { useApiQuery } from '../lib/query';

/**
 * Tax Returns Review 2 (Messaging): the email a client gets about a firm message. The message
 * always reaches the client's portal, and the client always gets an email that it is waiting
 * (TR-4). Per send, the email may also carry the text (with a warning) and the documents as
 * sign-in links into the portal. The two start from the client's saved preference, else the
 * firm's defaults; Save keeps them for the client.
 */
export interface EmailChoicesValue {
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
  const loaded: EmailChoicesValue | null = pref.data
    ? {
        emailIncludesBody: pref.data.effective.emailIncludesBody,
        emailIncludesDocuments: pref.data.effective.emailIncludesDocuments,
        saveForClient: false,
      }
    : null;
  const value = edit && edit.clientId === clientId ? edit.value : loaded;
  const delivery: MessageDelivery | undefined = value
    ? {
        emailIncludesBody: value.emailIncludesBody,
        emailIncludesDocuments: value.emailIncludesDocuments,
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
  [
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
  return (
    <fieldset className="flex flex-col gap-2 rounded-control border border-border p-3 text-sm">
      <legend className="px-1 text-xs font-semibold text-muted">Email to the client</legend>
      <p className="text-xs text-muted" data-testid="email-always">
        The message goes to their client portal, and they always get an email that it is waiting.
      </p>
      {preference.bodyAllowed ? (
        <Checkbox
          label="Include the text in the email"
          checked={value.emailIncludesBody}
          onChange={(e) => set({ ...value, emailIncludesBody: e.target.checked })}
        />
      ) : null}
      {value.emailIncludesBody ? (
        <p role="note" className="rounded-lg bg-warning-soft p-2 text-xs text-heading">
          {MESSAGE_BODY_EMAIL_WARNING}
        </p>
      ) : null}
      <Checkbox
        label="Link its documents in the email"
        checked={value.emailIncludesDocuments}
        onChange={(e) => set({ ...value, emailIncludesDocuments: e.target.checked })}
      />
      <p className="text-xs text-muted">{MESSAGE_DOCUMENTS_AS_LINKS_NOTE}</p>
      <Checkbox
        label={`Save as ${clientName ?? 'this client'}'s preference`}
        checked={value.saveForClient}
        onChange={(e) => set({ ...value, saveForClient: e.target.checked })}
      />
    </fieldset>
  );
}
