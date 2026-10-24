'use client';

import { CreateTagRequest, type FirmTag, TAG_ERRORS } from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from './lead-shared';

// Add New Tag (L6 of Octavia's Leads review): Owner and Admin add a tag to the firm's one list,
// which Leads and Clients both use (the tag picker, components/tag-picker.tsx). The dialog shows
// that list, with where each tag is used, so a tag is never added twice under another spelling.

const FIRM_TAGS = ['tags'] as const;

const usedIn = (t: FirmTag) =>
  [
    t.leads ? `${t.leads} ${t.leads === 1 ? 'lead' : 'leads'}` : null,
    t.clients ? `${t.clients} ${t.clients === 1 ? 'client' : 'clients'}` : null,
  ]
    .filter(Boolean)
    .join(', ') || 'Not used yet';

export function AddTagDialog({ onClose }: { onClose: () => void }) {
  const tags = useApiQuery(FIRM_TAGS, () => api.tags.list());
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const create = useApiMutation((body: CreateTagRequest) => api.tags.create(body), {
    invalidate: FIRM_TAGS,
  });
  const items = tags.data?.items ?? [];
  return (
    <Modal
      open
      title="Add New Tag"
      subtitle="One tag list for Leads and Clients."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" form="add-tag-form" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add Tag'}
          </Button>
        </>
      }
    >
      <form
        id="add-tag-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setAdded(null);
          const parsed = CreateTagRequest.safeParse({ name });
          if (!parsed.success) {
            setProblem(parsed.error.issues[0]?.message ?? 'Enter a tag name');
            return;
          }
          setProblem(null);
          create.mutate(parsed.data, {
            onSuccess: (tag) => {
              setAdded(tag.name);
              setName('');
              // The Leads page's tag filter and pickers read the names from its options.
              void queryClient.invalidateQueries({ queryKey: [...LEAD_PIPELINE_KEY, 'options'] });
            },
          });
        }}
      >
        <Input
          label="Tag name"
          required
          maxLength={40}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={problem ?? (create.error ? errorMessage(create.error, TAG_ERRORS) : undefined)}
        />
        {added ? (
          <p role="status" className="text-sm text-success" data-testid="tag-added">
            “{added}” was added. It is in the tag list for Leads and Clients.
          </p>
        ) : null}
        <section aria-label="The firm's tags" className="flex flex-col gap-2 text-sm">
          <h3 className="font-semibold text-heading">The firm’s tags</h3>
          {tags.isPending ? (
            <p className="text-muted">Loading the tags…</p>
          ) : tags.isError ? (
            <p className="text-muted">
              The tag list can’t be loaded right now. A tag can still be added.
            </p>
          ) : items.length === 0 ? (
            <p className="text-muted">No tags yet.</p>
          ) : (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg bg-canvas px-3">
              {items.map((t) => (
                <li key={t.id} className="flex flex-wrap justify-between gap-x-3 py-2">
                  <span className="text-heading">{t.name}</span>
                  <span className="text-muted">{usedIn(t)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </form>
    </Modal>
  );
}
