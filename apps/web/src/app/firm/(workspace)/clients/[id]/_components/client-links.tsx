'use client';

import type { ClientLink, ClientLinkRole, ClientRecord } from '@firmivra/types';
import { Badge, Button, Card, Input, Modal, Select, Toast } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';

// Clients Review 2 (G9): linked profiles on Overview. A Business and its owner's or responsible
// party's Personal profile (or a spouse, family, a partner, a related business) are linked once;
// both profiles list the link, each in its own words. Adding, changing and removing are the
// API's (audited); Staff see and link only clients assigned to them.

const ERRORS: Record<string, string> = {
  ALREADY_LINKED: 'These clients are already linked.',
  SELF_LINK: 'Choose another client: a client cannot be linked to itself.',
  CLIENT_ARCHIVED: 'Restore the archived client first.',
  NOT_FOUND: 'That client is not available to you.',
};

/** What the other profile is to this one (LINKED), or this one to the other (ADDED_TO). */
const WORDS: Record<ClientLinkRole, { linked: string; addedTo: string; choice: string }> = {
  OWNER: { linked: 'Owner', addedTo: 'Business they own', choice: 'Owner of this client' },
  RESPONSIBLE_PARTY: {
    linked: 'Responsible party',
    addedTo: 'Business they answer for',
    choice: 'Responsible party for this client',
  },
  SPOUSE: { linked: 'Spouse', addedTo: 'Spouse', choice: 'Spouse' },
  FAMILY: { linked: 'Family', addedTo: 'Family', choice: 'Family member' },
  PARTNER: { linked: 'Business partner', addedTo: 'Business partner', choice: 'Business partner' },
  RELATED_BUSINESS: {
    linked: 'Related business',
    addedTo: 'Related business',
    choice: 'Related business',
  },
  OTHER: { linked: 'Linked profile', addedTo: 'Linked profile', choice: 'Other' },
};
const ROLES = Object.keys(WORDS) as ClientLinkRole[];
export const relationText = (l: ClientLink) =>
  l.side === 'LINKED' ? WORDS[l.role].linked : WORDS[l.role].addedTo;

const key = (clientId: string) => ['clients', clientId, 'links'];

/** The search once typing pauses. */
function useSettled(text: string, ms = 300) {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(t);
  }, [text, ms]);
  return settled;
}

export function LinkedProfilesCard({ client }: { client: ClientRecord }) {
  const q = useApiQuery(key(client.id), () => api.clients.links(client.id));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ClientLink>();
  const [removing, setRemoving] = useState<ClientLink>();
  const [notice, setNotice] = useState<string>();
  const archived = !!client.archivedAt;
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center justify-between gap-2">
          Linked Profiles
          {archived ? null : (
            <Button
              variant="secondary"
              className="!min-h-9"
              data-testid="add-client-link"
              onClick={() => setAdding(true)}
            >
              Add Link
            </Button>
          )}
        </span>
      }
    >
      <div data-testid="client-links" className="flex flex-col gap-3">
        {notice ? <Toast message={notice} onDismiss={() => setNotice(undefined)} /> : null}
        {q.isError ? (
          <p role="alert" className="text-sm text-danger">
            Linked profiles are not available right now.
          </p>
        ) : q.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : q.data.length === 0 ? (
          <p className="text-sm text-muted">
            No linked profiles. Link a business to its owner&apos;s personal profile, or family
            members to each other.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {q.data.map((l) => (
              <li
                key={l.id}
                data-testid="client-link-row"
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    href={`/clients/${l.other.id}`}
                    className="text-sm font-semibold wrap-anywhere text-link hover:underline"
                  >
                    {l.other.displayName}
                  </Link>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{relationText(l)}</span>
                    <span>{l.other.clientNumber}</span>
                    <Badge tone={l.other.accountType === 'BUSINESS' ? 'purple' : 'info'}>
                      {l.other.accountType === 'BUSINESS' ? 'Business' : 'Personal'}
                    </Badge>
                    {l.other.archived ? <Badge tone="neutral">Archived</Badge> : null}
                  </span>
                  {l.note ? (
                    <span className="text-xs wrap-anywhere text-text">{l.note}</span>
                  ) : null}
                </span>
                {archived ? null : (
                  <span className="flex items-center gap-3 text-sm">
                    <button
                      type="button"
                      className="font-medium text-link hover:underline"
                      aria-label={`Change the link to ${l.other.displayName}`}
                      onClick={() => setEditing(l)}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="font-medium text-danger hover:underline"
                      aria-label={`Remove the link to ${l.other.displayName}`}
                      onClick={() => setRemoving(l)}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {adding ? (
        <LinkDialog
          client={client}
          onClose={() => setAdding(false)}
          onDone={(text) => {
            setAdding(false);
            setNotice(text);
          }}
        />
      ) : null}
      {editing ? (
        <LinkDialog
          client={client}
          link={editing}
          onClose={() => setEditing(undefined)}
          onDone={(text) => {
            setEditing(undefined);
            setNotice(text);
          }}
        />
      ) : null}
      {removing ? (
        <RemoveDialog
          clientId={client.id}
          link={removing}
          onClose={() => setRemoving(undefined)}
          onDone={(text) => {
            setRemoving(undefined);
            setNotice(text);
          }}
        />
      ) : null}
    </Card>
  );
}

/** Add Link (no `link`) or Change (the role and the note). */
function LinkDialog({
  client,
  link,
  onClose,
  onDone,
}: {
  client: ClientRecord;
  link?: ClientLink;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const term = useSettled(search.trim());
  const found = useApiQuery(['clients', 'link-search', term], async () =>
    term.length >= 2 ? api.clients.list({ search: term, limit: 8, page: 1 }) : null,
  );
  const [chosen, setChosen] = useState<{ id: string; name: string }>();
  const [role, setRole] = useState<ClientLinkRole | ''>(link?.role ?? '');
  const [note, setNote] = useState(link?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [touched, setTouched] = useState(false);
  const other = link ? link.other.displayName : chosen?.name;
  const save = async () => {
    setTouched(true);
    if (!role || (!link && !chosen)) return;
    setBusy(true);
    setError(undefined);
    try {
      if (link) {
        const body = {
          ...(role !== link.role ? { role } : {}),
          ...(note.trim() !== (link.note ?? '') ? { note: note.trim() } : {}),
        };
        // Nothing changed: nothing to save.
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        await api.clients.updateLink(client.id, link.id, body);
      } else {
        await api.clients.addLink(client.id, {
          linkedClientId: chosen!.id,
          role,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }
      await qc.invalidateQueries({ queryKey: ['clients'] });
      onDone(
        link ? `The link to ${other} is saved.` : `${other} is linked to ${client.displayName}.`,
      );
    } catch (e) {
      setError(errorMessage(e, ERRORS));
    } finally {
      setBusy(false);
    }
  };
  // A Change on the other profile's link reads the role from that side.
  const inverse = link?.side === 'ADDED_TO';
  return (
    <Modal
      open
      title={link ? 'Change Link' : 'Add Link'}
      subtitle={client.displayName}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : link ? 'Save' : 'Link Profiles'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="client-link-dialog">
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {link ? null : (
          <>
            <Input
              label="Find a client *"
              placeholder="Name, email, phone or Client ID"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setChosen(undefined);
              }}
              error={touched && !chosen ? 'Choose the client to link' : undefined}
            />
            {chosen ? (
              <p className="text-sm text-text" data-testid="client-link-chosen">
                Linking <span className="font-semibold">{chosen.name}</span>
              </p>
            ) : term.length >= 2 ? (
              <ul className="flex max-h-48 flex-col overflow-y-auto rounded-control border border-border">
                {found.isPending ? (
                  <li className="px-3 py-2 text-sm text-muted">Searching…</li>
                ) : (found.data?.items ?? []).filter((c) => c.id !== client.id).length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted">No client matches.</li>
                ) : (
                  (found.data?.items ?? [])
                    .filter((c) => c.id !== client.id)
                    .map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm text-text hover:bg-canvas"
                          onClick={() => setChosen({ id: c.id, name: c.displayName })}
                        >
                          {c.displayName}
                          {c.email ? (
                            <span className="ml-2 text-xs text-muted">{c.email}</span>
                          ) : null}
                        </button>
                      </li>
                    ))
                )}
              </ul>
            ) : null}
          </>
        )}
        <Select
          label={
            inverse
              ? `${client.displayName} is ${other ?? 'the other client'}'s *`
              : `${other ?? 'The linked client'} is ${client.displayName}'s *`
          }
          value={role}
          onChange={(e) => setRole(e.target.value as ClientLinkRole | '')}
          error={touched && !role ? 'Choose how they are linked' : undefined}
          options={[
            { value: '', label: 'Choose' },
            ...ROLES.map((r) => ({ value: r, label: WORDS[r].linked })),
          ]}
        />
        <Input
          label="Note (optional)"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function RemoveDialog({
  clientId,
  link,
  onClose,
  onDone,
}: {
  clientId: string;
  link: ClientLink;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.clients.removeLink(clientId, link.id);
      await qc.invalidateQueries({ queryKey: ['clients'] });
      onDone(`The link to ${link.other.displayName} is removed.`);
    } catch (e) {
      setError(errorMessage(e, ERRORS));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Remove Link"
      subtitle={link.other.displayName}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep Link
          </Button>
          <Button disabled={busy} onClick={() => void remove()}>
            Remove Link
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-text">
        <p>Both profiles stay; only the link between them is removed, for both of them.</p>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
