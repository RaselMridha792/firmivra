'use client';

import {
  type ClientListItem,
  type CreatePortalCustomTab,
  PORTAL_CUSTOM_TAB_MODULES,
  type PortalCustomTab,
  type PortalCustomTabModule,
  type PortalTabAudience,
  PortalTabLabel,
  type UpdatePortalCustomTab,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input, Modal, Radio, Select, Toggle } from '@firmivra/ui';
import { LayoutGrid, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { ClientPicker } from '../../../documents/upload/_components/client-picker';

const QUERY = ['portal-tabs', 'custom'];
/** Also the portal's menu (['portal-tabs', slug]): a change shows there at once in this browser. */
const INVALIDATE = ['portal-tabs'];

const AUDIENCES: { id: PortalTabAudience; label: string }[] = [
  { id: 'ALL', label: 'All business clients' },
  { id: 'TAGS', label: 'Business clients with a tag' },
  { id: 'CLIENTS', label: 'Chosen business clients' },
];

/** 409 DUPLICATE_LABEL: a built-in or another custom tab has the name; 404: a tag or client left. */
const CUSTOM_ERRORS = {
  DUPLICATE_LABEL: 'Another tab already has this name. Give this tab its own.',
  NOT_FOUND: 'A tag or client you chose is no longer available. Check the list and save again.',
};

/**
 * Settings > Client Portal > Features > Custom Tabs (Client Portal guide 7.3, CP-5d and CP-5e):
 * tabs the firm adds that reuse document upload or business resources. They show only in business
 * portals, after the built-in tabs, to all business clients, to clients with a tag, or to chosen
 * clients. Archiving hides a tab for good and deletes nothing. Owner and Admin.
 */
export function PortalCustomTabs() {
  const query = useApiQuery(QUERY, () => api.portalTabs.customList());
  const [editing, setEditing] = useState<PortalCustomTab | 'new' | null>(null);
  const [archiving, setArchiving] = useState<PortalCustomTab | null>(null);
  const toggle = useApiMutation(
    ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.portalTabs.customUpdate(id, { enabled }),
    { invalidate: INVALIDATE },
  );
  const archive = useApiMutation((id: string) => api.portalTabs.customArchive(id), {
    invalidate: INVALIDATE,
  });
  return (
    <Card className="flex min-w-0 flex-col gap-4" data-testid="portal-custom-tabs">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-action text-on-action">
          <LayoutGrid aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-heading">Custom Tabs</h2>
          <p className="text-sm text-muted">
            Add a tab that reuses document upload or business resources under your own name. Custom
            tabs show only in business portals, after the tabs above, to the clients you choose.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden className="size-4" /> Add Custom Tab
        </Button>
      </div>
      <PageState query={query}>
        {({ items }) =>
          items.length === 0 ? (
            <p className="rounded-card bg-canvas p-4 text-sm text-muted">
              No custom tabs yet. Clients see only the tabs above.
            </p>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-xl text-left text-sm">
                <caption className="sr-only">Custom portal tabs</caption>
                <thead className="border-b border-border text-xs text-muted">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Tab Name (Client View)
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Function
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Who sees it
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((tab) => (
                    <tr key={tab.id} data-testid={`custom-tab-${tab.label}`}>
                      <td className="py-3 pr-3 font-medium text-heading">{tab.label}</td>
                      <td className="py-3 pr-3 text-muted">
                        {PORTAL_CUSTOM_TAB_MODULES[tab.module]}
                      </td>
                      <td className="py-3 pr-3 text-muted">{audienceText(tab)}</td>
                      <td className="py-3 pr-3">
                        <Toggle
                          label={`Show ${tab.label}`}
                          checked={tab.enabled}
                          disabled={toggle.isPending}
                          onChange={(enabled) => toggle.mutate({ id: tab.id, enabled })}
                        />
                      </td>
                      <td className="py-3">
                        <span className="flex flex-wrap justify-end gap-2">
                          <Button variant="secondary" onClick={() => setEditing(tab)}>
                            Edit<span className="sr-only"> {tab.label}</span>
                          </Button>
                          <Button variant="ghost" onClick={() => setArchiving(tab)}>
                            Archive<span className="sr-only"> {tab.label}</span>
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </PageState>
      {toggle.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(toggle.error, CUSTOM_ERRORS)}
        </p>
      ) : null}
      {editing ? (
        <CustomTabDialog
          tab={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <Modal
        open={archiving !== null}
        title={archiving ? `Archive ${archiving.label}?` : ''}
        onClose={() => setArchiving(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setArchiving(null)}>
              Keep it
            </Button>
            <Button
              disabled={archive.isPending}
              onClick={() =>
                archiving && archive.mutate(archiving.id, { onSuccess: () => setArchiving(null) })
              }
            >
              {archive.isPending ? 'Archiving…' : 'Archive'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          Clients no longer see this tab, also by a direct link, and it can&apos;t be restored.
          Nothing is deleted: files uploaded through it stay with their client, in My Uploaded
          Documents and in the client&apos;s documents.
        </p>
        {archive.error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {errorMessage(archive.error, CUSTOM_ERRORS)}
          </p>
        ) : null}
      </Modal>
    </Card>
  );
}

function audienceText(tab: PortalCustomTab): string {
  if (tab.audience === 'ALL') return 'All business clients';
  const n = tab.tagIds.length;
  const [first, ...rest] = tab.clients;
  const parts = [
    n === 0 ? null : n === 1 ? 'Clients with 1 tag' : `Clients with ${n} tags`,
    first ? (rest.length === 0 ? first.name : `${first.name} and ${rest.length} more`) : null,
  ];
  return parts.filter(Boolean).join('; ');
}

/** Add Custom Tab or Edit: the name, the function (fixed once added) and who sees it. */
function CustomTabDialog({ tab, onClose }: { tab: PortalCustomTab | null; onClose: () => void }) {
  const [label, setLabel] = useState(tab?.label ?? '');
  const [module, setModule] = useState<PortalCustomTabModule>(tab?.module ?? 'DOCUMENTS');
  const [audience, setAudience] = useState<PortalTabAudience>(tab?.audience ?? 'ALL');
  const [tagIds, setTagIds] = useState<string[]>(tab?.tagIds ?? []);
  const [clients, setClients] = useState<{ id: string; name: string }[]>(tab?.clients ?? []);
  const [picked, setPicked] = useState<ClientListItem | null>(null);
  const [tried, setTried] = useState(false);
  const save = useApiMutation(
    (body: CreatePortalCustomTab | UpdatePortalCustomTab) =>
      tab
        ? api.portalTabs.customUpdate(tab.id, body as UpdatePortalCustomTab)
        : api.portalTabs.customCreate(body as CreatePortalCustomTab),
    { invalidate: INVALIDATE },
  );
  const name = label.trim();
  const nameError = !name
    ? 'Enter a name for the tab.'
    : PortalTabLabel.safeParse(name).success
      ? undefined
      : 'Use one line of up to 40 characters for the name.';
  const targetsError =
    audience === 'TAGS' && tagIds.length === 0
      ? 'Choose at least one tag.'
      : audience === 'CLIENTS' && clients.length === 0
        ? 'Choose at least one client.'
        : undefined;
  const targets = {
    audience,
    tagIds: audience === 'TAGS' ? tagIds : [],
    clientIds: audience === 'CLIENTS' ? clients.map((c) => c.id) : [],
  };
  const submit = () => {
    setTried(true);
    if (nameError || targetsError) return;
    const body = tab
      ? { ...(name !== tab.label ? { label: name } : {}), ...targets }
      : { label: name, module, ...targets };
    save.mutate(body, { onSuccess: onClose });
  };
  const addClient = (client: ClientListItem) => {
    setPicked(null);
    if (!clients.some((c) => c.id === client.id))
      setClients([...clients, { id: client.id, name: client.displayName }]);
  };
  return (
    <Modal
      open
      title={tab ? `Edit ${tab.label}` : 'Add Custom Tab'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : tab ? 'Save changes' : 'Add tab'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input
          label="Tab name (client view)"
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          error={tried ? nameError : undefined}
        />
        {tab ? (
          <p className="text-sm text-text">
            <span className="font-medium text-heading">Function:</span>{' '}
            {PORTAL_CUSTOM_TAB_MODULES[tab.module]}
          </p>
        ) : (
          <Select
            label="Function"
            value={module}
            onChange={(e) => setModule(e.target.value as PortalCustomTabModule)}
            options={Object.entries(PORTAL_CUSTOM_TAB_MODULES).map(([value, text]) => ({
              value,
              label: text,
            }))}
          />
        )}
        <p className="text-xs text-muted">
          Document upload lists the files each client sends through this tab; they also stay in the
          client&apos;s documents. Business resources shows what Business Documents &amp; Resources
          shows, and follows that tab&apos;s switch.
        </p>
        <fieldset className="grid gap-1">
          <legend className="text-sm font-semibold text-heading">Who sees it</legend>
          {AUDIENCES.map((a) => (
            <Radio
              key={a.id}
              name="custom-tab-audience"
              label={a.label}
              checked={audience === a.id}
              onChange={() => setAudience(a.id)}
            />
          ))}
        </fieldset>
        {audience === 'TAGS' ? (
          <fieldset className="grid gap-1">
            <legend className="text-sm font-semibold text-heading">Tags</legend>
            <TagChoices chosen={tagIds} onChange={setTagIds} />
          </fieldset>
        ) : null}
        {audience === 'CLIENTS' ? (
          <div className="grid gap-2">
            <ClientPicker
              value={picked}
              onChange={addClient}
              disabled={false}
              label="Add a client"
            />
            {clients.length > 0 ? (
              <ul aria-label="Chosen clients" className="grid gap-1">
                {clients.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-control bg-canvas px-3 py-1 text-sm"
                  >
                    <span className="min-w-0 break-words text-heading">{c.name}</span>
                    <Button
                      variant="ghost"
                      className="min-h-8"
                      onClick={() => setClients(clients.filter((x) => x.id !== c.id))}
                    >
                      Remove<span className="sr-only"> {c.name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted">Only clients with a business portal see the tab.</p>
          </div>
        ) : null}
        {tried && targetsError ? (
          <p role="alert" className="text-sm text-danger">
            {targetsError}
          </p>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, CUSTOM_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** The firm's live tags to choose from (loaded when the tag audience is chosen). */
function TagChoices({ chosen, onChange }: { chosen: string[]; onChange: (ids: string[]) => void }) {
  const tags = useApiQuery(['tags'], () => api.tags.list());
  return (
    <PageState query={tags}>
      {({ items }) =>
        items.length === 0 ? (
          <p className="text-sm text-muted">Your firm has no tags yet.</p>
        ) : (
          <div className="grid max-h-48 gap-1 overflow-y-auto">
            {items.map((t) => (
              <Checkbox
                key={t.id}
                label={t.name}
                checked={chosen.includes(t.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...chosen, t.id] : chosen.filter((id) => id !== t.id),
                  )
                }
              />
            ))}
          </div>
        )
      }
    </PageState>
  );
}
