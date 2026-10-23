'use client';

import { type ClientRecord, TAG_ERRORS } from '@firmivra/types';
import { Badge, Button, Card } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { TagPicker } from '../../../../../../components/tag-picker';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { clientKey } from '../../_components/client-parts';

// A client's tags (L5 of Octavia's Leads review): picked from the firm's one tag list, the same
// list Leads use (components/tag-picker.tsx), so a lead's tags and a client's never split into two
// spellings. Owner and Admin may add a new tag here; Staff choose existing ones.

const FIRM_TAGS = ['tags'] as const;

export function ClientTagsCard({ client }: { client: ClientRecord }) {
  const key = [...clientKey(client.id), 'tags'] as const;
  const tags = useApiQuery(key, () => api.clients.tags(client.id));
  const firmTags = useApiQuery(FIRM_TAGS, () => api.tags.list());
  const { role } = useFirm();
  const [draft, setDraft] = useState<string[] | null>(null);
  const save = useApiMutation(
    (names: string[]) => api.clients.setTags(client.id, { tags: names }),
    { invalidate: key },
  );
  const queryClient = useQueryClient();
  const current = tags.data?.tags ?? [];
  return (
    <Card title="Tags" data-testid="client-tags">
      {tags.isPending ? (
        <p className="text-sm text-muted">Loading tags…</p>
      ) : tags.isError ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span role="alert" className="text-danger">
            The tags can’t be loaded right now.
          </span>
          <Button variant="secondary" onClick={() => void tags.refetch()}>
            Try again
          </Button>
        </div>
      ) : draft === null ? (
        <div className="flex flex-col gap-4">
          {current.length ? (
            <ul aria-label="Client tags" className="flex flex-wrap gap-2">
              {current.map((name) => (
                <li key={name}>
                  <Badge>{name}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">This client has no tags yet.</p>
          )}
          {client.archivedAt ? (
            <p className="text-sm text-muted">Restore the client to change its tags.</p>
          ) : (
            <div>
              <Button
                variant="secondary"
                onClick={() => {
                  save.reset();
                  setDraft(current);
                }}
              >
                {current.length ? 'Edit tags' : 'Add tags'}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(draft, {
              onSuccess: () => {
                setDraft(null);
                // A new tag joins the firm's list, and the counts change.
                void queryClient.invalidateQueries({ queryKey: FIRM_TAGS });
              },
            });
          }}
        >
          <TagPicker
            label="Choose tags"
            value={draft}
            onChange={setDraft}
            options={(firmTags.data?.items ?? []).map((t) => t.name)}
            loading={firmTags.isPending}
            canCreate={role === 'OWNER' || role === 'ADMIN'}
            max={20}
            hint={
              firmTags.isError
                ? 'The firm’s tag list can’t be loaded right now; the chosen tags are kept.'
                : undefined
            }
            error={save.error ? errorMessage(save.error, TAG_ERRORS) : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save tags'}
            </Button>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
