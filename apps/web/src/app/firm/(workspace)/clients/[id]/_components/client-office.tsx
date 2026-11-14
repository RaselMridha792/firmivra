'use client';

import type { ClientOfficeChoice } from '@firmivra/types';
import { Button, Card, Select, Skeleton } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';

const ERRORS = { OFFICE_NOT_AVAILABLE: 'That location is no longer active. Choose another.' };

function Lines({ office }: { office: ClientOfficeChoice }) {
  return (
    <span>
      <span className="block font-medium text-heading">{office.name}</span>
      {office.addressLines.map((line) => (
        <span key={line} className="block text-muted">
          {line}
        </span>
      ))}
    </span>
  );
}

/**
 * The client's local office (PRT-1 part 2; Client Portal guide 2, 7.4 and 9.1): the one they chose
 * at registration, shown as their local office in the portal. An Owner or Admin changes it to one
 * of the firm's active locations, or none; the API audits each change. Never set from city or
 * state.
 */
export function LocalOfficeCard({ clientId }: { clientId: string }) {
  const key = ['client-office', clientId];
  const query = useApiQuery(key, () => api.clients.office(clientId));
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState('');
  const [notice, setNotice] = useState('');
  const save = useApiMutation(
    (officeId: string | null) => api.clients.setOffice(clientId, { officeId }),
    { invalidate: key },
  );
  const o = query.data;
  return (
    <Card title="Local Office" data-testid="client-office">
      {query.isPending ? (
        <Skeleton className="h-16" />
      ) : !o ? (
        <p className="text-sm text-muted">The local office could not be loaded. Try again.</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <dl className="grid gap-3 sm:grid-cols-3">
            <dt className="text-muted">Office</dt>
            <dd className="sm:col-span-2">
              {o.office ? (
                <>
                  <Lines office={o.office} />
                  {!o.office.active ? (
                    <span className="mt-1 block text-warning">
                      This location was deactivated, so the portal no longer shows it.
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted">None assigned</span>
              )}
            </dd>
            {o.chosenAtSignUp ? (
              <>
                <dt className="text-muted">Chosen at sign-up</dt>
                <dd className="text-text sm:col-span-2">{o.chosenAtSignUp.name}</dd>
              </>
            ) : null}
          </dl>
          {editing ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(choice || null, {
                  onSuccess: () => {
                    setEditing(false);
                    setNotice('Local office changed.');
                  },
                });
              }}
            >
              <div className="min-w-56 flex-1">
                <Select
                  label="Local office"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                  options={[
                    { value: '', label: 'No office' },
                    ...o.choices.map((c) => ({
                      value: c.id,
                      label: c.addressLines.length
                        ? `${c.name} (${c.addressLines.join(', ')})`
                        : c.name,
                    })),
                  ]}
                />
              </div>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : o.canChange ? (
            <Button
              variant="secondary"
              className="w-fit"
              onClick={() => {
                save.reset();
                setNotice('');
                setChoice(o.office?.active ? o.office.id : '');
                setEditing(true);
              }}
            >
              Change Office
            </Button>
          ) : null}
          {notice ? (
            <p role="status" className="text-success">
              {notice}
            </p>
          ) : null}
          {save.error ? (
            <p role="alert" className="text-danger">
              {errorMessage(save.error, ERRORS)}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
