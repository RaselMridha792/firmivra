'use client';

import type { AdvisoryServiceOption, ClientListItem } from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { BA_KEY, errorText } from './ba-shared';

/**
 * Advisory B17 (Octavia, Oct 25): Search Existing Clients beside the plan's client choice. It
 * searches the firm's clients by name, email or phone. A client already in the advisory
 * program is chosen as they are; any other is added to it (its primary service focus asked) and
 * chosen. Never a new client record: the advisory engagement links to the existing one, and the
 * API refuses a second (409 ALREADY_ADVISORY_CLIENT).
 */
export function SearchExistingClientDialog({
  advisoryOf,
  onClose,
  onChosen,
}: {
  /** The advisory client id of each firm client already in the program. */
  advisoryOf: ReadonlyMap<string, string>;
  onClose: () => void;
  onChosen: (advisoryClientId: string) => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<ClientListItem>();
  const [primaryId, setPrimaryId] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const term = search.trim();
  const found = useApiQuery([...BA_KEY, 'existing-clients', term], () =>
    term.length >= 2 ? api.clients.list({ search: term, limit: 20 }) : Promise.resolve(null),
  );
  const services = useApiQuery([...BA_KEY, 'services'], () => api.advisory.serviceOptions());
  const label = (s: AdvisoryServiceOption) => (s.referralOnly ? `${s.name} (referral)` : s.name);

  const add = async () => {
    if (!picked) return;
    setSaving(true);
    setError(undefined);
    try {
      const c = await api.advisory.addClient({ clientId: picked.id, primaryServiceId: primaryId });
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      onChosen(c.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const items = found.data?.items.filter((c) => !c.archivedAt) ?? [];
  return (
    <Modal
      open
      title="Search Existing Clients"
      subtitle="Find the client among the firm's clients. Nothing new is created for them."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {picked ? (
            <Button disabled={!primaryId || saving} onClick={() => void add()}>
              {saving ? 'Adding…' : 'Add to Advisory and Choose'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="search-existing-client">
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {picked ? (
          <>
            <p className="text-sm text-text">
              <span className="font-semibold text-heading">{picked.displayName}</span> is not in the
              advisory program yet. Choose their primary service focus to add them.
            </p>
            <Select
              label="Primary service focus *"
              required
              value={primaryId}
              onChange={(e) => setPrimaryId(e.target.value)}
              options={[
                {
                  value: '',
                  label: services.isError ? 'Services could not be loaded' : 'Choose a service…',
                },
                ...(services.data ?? []).map((s) => ({ value: s.serviceId, label: label(s) })),
              ]}
            />
            <button
              type="button"
              className="self-start text-sm font-medium text-link underline"
              onClick={() => {
                setPicked(undefined);
                setPrimaryId('');
              }}
            >
              Back to the search
            </button>
          </>
        ) : (
          <>
            <Input
              label="Search clients"
              placeholder="Name, email or phone"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
            {term.length < 2 ? (
              <p className="text-sm text-muted">Type at least two characters.</p>
            ) : found.isPending ? (
              <p className="text-sm text-muted">Searching…</p>
            ) : found.isError ? (
              <p role="alert" className="text-sm text-danger">
                Clients could not be searched right now.
              </p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted">No client matches “{term}”.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-divider" aria-label="Matching clients">
                {items.map((c) => {
                  const advisoryId = advisoryOf.get(c.id);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="flex min-w-0 flex-1 flex-col text-sm">
                        <span className="font-semibold text-heading">{c.displayName}</span>
                        <span className="truncate text-muted">
                          {[c.email, c.phone].filter(Boolean).join(' · ') || 'No email or phone'}
                        </span>
                      </span>
                      {advisoryId ? (
                        <Button variant="secondary" onClick={() => onChosen(advisoryId)}>
                          Choose
                        </Button>
                      ) : (
                        <Button variant="secondary" onClick={() => setPicked(c)}>
                          Add to Advisory
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
