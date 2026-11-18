'use client';

import {
  ADVISORY_RESOURCE_FORMAT_LABELS,
  type AdvisoryResource,
  type AdvisoryResourceFormat,
} from '@firmivra/types';
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

/**
 * Send Resource (B28, Business Advisory review §18): the client, the channel (Portal or Email), the
 * format where the resource offers a choice (Secure Link or PDF), an optional message, and a
 * preview of exactly what the client receives with the checks that would refuse it (no portal
 * login, a format the resource doesn't offer). Send stays off until the preview says it can go.
 */
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
  const [channel, setChannel] = useState<'PORTAL_MESSAGE' | 'EMAIL'>('PORTAL_MESSAGE');
  const [format, setFormat] = useState<AdvisoryResourceFormat>('SECURE_LINK');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const note = useDeferredValue(message.trim());
  const request = {
    advisoryClientId: clientId,
    channel,
    format,
    ...(note ? { message: note } : {}),
  };
  const preview = useApiQuery(
    [...BA_KEY, 'resource-preview', resource.key, clientId, channel, format, note],
    () => (clientId ? api.advisory.previewResource(resource.key, request) : Promise.resolve(null)),
  );
  const view = preview.data;
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
            disabled={!clientId || saving || !view?.eligible}
            onClick={async () => {
              setSaving(true);
              setError(undefined);
              try {
                await api.advisory.sendResource(resource.key, {
                  advisoryClientId: clientId,
                  channel,
                  format,
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
          onChange={(e) => setChannel(e.target.value as 'PORTAL_MESSAGE' | 'EMAIL')}
          options={[
            { value: 'PORTAL_MESSAGE', label: 'Portal' },
            { value: 'EMAIL', label: 'Email' },
          ]}
        />
        <Select
          label="Format"
          value={format}
          disabled={resource.formats.length < 2}
          hint={
            resource.formats.length < 2
              ? `This resource goes as a ${ADVISORY_RESOURCE_FORMAT_LABELS[resource.formats[0] ?? 'SECURE_LINK']}.`
              : 'Secure Link opens it in their portal; PDF is a copy they download there.'
          }
          onChange={(e) => setFormat(e.target.value as AdvisoryResourceFormat)}
          options={resource.formats.map((f) => ({
            value: f,
            label: ADVISORY_RESOURCE_FORMAT_LABELS[f],
          }))}
        />
        <Textarea
          label="Message (optional)"
          rows={3}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <section
          aria-label="Preview"
          data-testid="resource-preview"
          className="rounded-xl border border-divider p-3 text-sm"
        >
          <h3 className="mb-1 font-semibold text-heading">What the client receives</h3>
          {!clientId ? (
            <p className={quiet}>Choose a client to see the preview.</p>
          ) : preview.isError ? (
            <p role="alert" className="text-danger">
              {errorText(preview.error)}
            </p>
          ) : !view ? (
            <p className={quiet}>Loading…</p>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className="text-muted">To</dt>
                <dd className="min-w-0 break-words text-heading" data-testid="preview-to">
                  {view.to.name}
                  {view.to.email ? ` <${view.to.email}>` : ''}
                  {view.channel === 'EMAIL' ? ' (email)' : ' (portal message)'}
                </dd>
                <dt className="text-muted">Subject</dt>
                <dd className="min-w-0 break-words text-heading">{view.subject}</dd>
              </dl>
              <p
                className="mt-2 rounded-lg bg-canvas p-2 whitespace-pre-wrap break-words text-text"
                data-testid="preview-body"
              >
                {view.body}
              </p>
              {view.problems.length ? (
                <ul
                  role="alert"
                  className="mt-2 flex flex-col gap-1"
                  data-testid="resource-problems"
                >
                  {view.problems.map((p) => (
                    <li key={p.code} className="text-danger">
                      {p.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-success" data-testid="resource-eligible">
                  Ready to send.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
