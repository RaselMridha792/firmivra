'use client';

import type { AdvisoryResource } from '@firmivra/types';
import { Badge, Button, Modal, Select, Textarea } from '@firmivra/ui';
import { ArrowSquareOut, BookOpen, PaperPlaneTilt } from '@phosphor-icons/react';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { ErrorLine } from './ba-dialogs';
import { FilterSelect, SearchBox, useAct } from './ba-list-kit';
import { BaShell } from './ba-shell';
import {
  BA_KEY,
  RESOURCE_ICON,
  RESOURCE_KIND,
  card,
  errorText,
  outlined,
  quiet,
} from './ba-shared';

/** The guide's library categories (§9), in its order. */
const CATEGORIES = [
  'Formation / EIN',
  'Branding',
  'Website',
  'Banking',
  'Funding',
  'Business Planning',
  'Market Research',
  'Financial Management',
  'Growth / Operations',
  'Education',
];

/** /business-advisory/resources: the resource library, by category; client-facing ones can be sent. */
export function ResourceLibrary() {
  const { toast, say } = useAct();
  const overview = useApiQuery([...BA_KEY, 'overview'], () => api.advisory.overview());
  const canSend = overview.data?.canSend ?? false;
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [audience, setAudience] = useState('');
  const [sending, setSending] = useState<AdvisoryResource>();
  const term = useDeferredValue(search.trim());
  const q = useApiQuery([...BA_KEY, 'resources', term, category, audience], () =>
    api.advisory.resources({
      ...(term ? { search: term } : {}),
      ...(category ? { category } : {}),
      ...(audience ? { clientFacing: audience === 'clients' } : {}),
    }),
  );
  const items = q.data ?? [];
  const groups = [...new Set([...CATEGORIES, ...items.map((r) => r.category)])]
    .map((c) => ({ category: c, items: items.filter((r) => r.category === c) }))
    .filter((g) => g.items.length);

  return (
    <BaShell>
      {toast}
      <section
        className={`${card} flex flex-col gap-4`}
        aria-label="Resource library"
        data-testid="ba-resources"
      >
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={search} onChange={setSearch} label="Search resources" />
          <FilterSelect
            label="Category"
            all="All Categories"
            value={category}
            onChange={setCategory}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            width="w-52"
          />
          <FilterSelect
            label="Audience"
            all="Clients and Staff"
            value={audience}
            onChange={setAudience}
            options={[
              { value: 'clients', label: 'For clients' },
              { value: 'staff', label: 'Staff only' },
            ]}
          />
        </div>
        {q.isError ? (
          <p role="alert" className={quiet}>
            The resource library is not available right now. Try again in a moment.
          </p>
        ) : q.data && groups.length === 0 ? (
          <p className={quiet}>
            {term || category || audience ? 'No resources match.' : 'No resources yet.'}
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => {
            const Glyph = RESOURCE_ICON[g.category] ?? BookOpen;
            return (
              <section
                key={g.category}
                aria-label={g.category}
                className="flex flex-col gap-2 rounded-xl border border-divider p-4"
                data-testid="resource-group"
              >
                <h2 className="flex items-center gap-3 font-display text-lg font-bold text-heading">
                  <span
                    aria-hidden
                    className="flex size-10 items-center justify-center rounded-xl bg-info-soft text-action"
                  >
                    <Glyph weight="fill" className="size-6" />
                  </span>
                  {g.category}
                </h2>
                <ul className="divide-y divide-divider">
                  {g.items.map((r) => (
                    <li key={r.key} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="min-w-40 flex-1 text-sm font-medium text-heading">
                        {r.title}
                      </span>
                      <Badge tone="info">{RESOURCE_KIND[r.kind] ?? r.kind}</Badge>
                      {r.clientFacing ? (
                        <Badge tone="success">For clients</Badge>
                      ) : (
                        <Badge tone="neutral">Staff only</Badge>
                      )}
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-9 items-center gap-1 px-2 text-sm font-medium text-link hover:underline"
                        >
                          Open <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
                        </a>
                      ) : null}
                      {canSend && r.clientFacing ? (
                        <button
                          type="button"
                          className={`${outlined} min-h-9 px-3`}
                          aria-label={`Send ${r.title} to a client`}
                          onClick={() => setSending(r)}
                        >
                          <PaperPlaneTilt
                            aria-hidden
                            weight="fill"
                            className="size-4 text-action"
                          />{' '}
                          Send to Client
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <p className="text-xs text-muted">
          Only resources marked for clients can be sent. For legal, banking, lending or insurance
          needs, these are checklists and referrals, not advice.
        </p>
      </section>
      {sending ? (
        <SendResourceDialog
          resource={sending}
          onClose={() => setSending(undefined)}
          onSent={(name) => {
            setSending(undefined);
            say(`${sending.title} sent to ${name}.`);
          }}
        />
      ) : null}
    </BaShell>
  );
}

export function SendResourceDialog({
  resource,
  advisoryClientId: preset,
  onClose,
  onSent,
}: {
  resource: AdvisoryResource;
  advisoryClientId?: string;
  onClose: () => void;
  onSent: (clientName: string) => void;
}) {
  const clients = useApiQuery([...BA_KEY, 'pick-clients'], () =>
    api.advisory.clients({ pageSize: 100 }),
  );
  const [clientId, setClientId] = useState(preset ?? '');
  const [channel, setChannel] = useState('PORTAL_MESSAGE');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      open
      title="Send Resource"
      subtitle={resource.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!clientId || saving}
            onClick={async () => {
              setSaving(true);
              setError(undefined);
              try {
                await api.advisory.sendResource(resource.key, {
                  advisoryClientId: clientId,
                  channel: channel as never,
                  ...(message.trim() ? { message: message.trim() } : {}),
                });
                onSent(
                  clients.data?.items.find((c) => c.id === clientId)?.client.name ?? 'the client',
                );
              } catch (e) {
                setError(errorText(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            Send
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="send-resource">
        <ErrorLine text={error} />
        <Select
          label="Advisory client"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          options={[
            {
              value: '',
              label: clients.isError ? 'Advisory clients could not be loaded' : 'Choose a client…',
            },
            ...(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.client.name })),
          ]}
        />
        <Select
          label="Send by"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          options={[
            { value: 'PORTAL_MESSAGE', label: 'Client portal message' },
            { value: 'EMAIL', label: 'Email' },
          ]}
        />
        <Textarea
          label="Message (optional)"
          rows={3}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
    </Modal>
  );
}
