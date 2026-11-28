'use client';

import {
  PORTAL_TAB_LABELS,
  type PortalTab,
  type PortalTabs,
  type UpdatePortalTabsRequest,
} from '@firmivra/types';
import { Button, Card, Input, Modal, Toggle } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowUp,
  CloudUpload,
  FileText,
  FolderOpen,
  MessageSquare,
  Receipt,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { useUnsavedChanges } from '../../../../../../lib/unsaved';

const QUERY = ['portal-tabs'];

/** What each built-in tab does, and its icon (Client Portal guide 5). */
const META: Record<PortalTab, { does: string; icon: LucideIcon }> = {
  INTAKE_FORMS: { does: 'Client completes and submits forms', icon: FileText },
  BUSINESS_RESOURCES: { does: 'View company-provided documents', icon: FolderOpen },
  DOCUMENTS: { does: 'Client uploads documents', icon: CloudUpload },
  TAX_RETURNS: { does: 'View past tax returns', icon: FileText },
  INVOICES_PAYMENTS: { does: 'View invoices and payment history', icon: Receipt },
  MESSAGES: { does: 'View and reply to messages', icon: MessageSquare },
};

/** 409 DUPLICATE_LABEL: two tabs would share a name. */
const FEATURE_ERRORS = { DUPLICATE_LABEL: 'Two tabs have the same name. Give each its own.' };

/** Settings > Client Portal > Portal Features: which tabs clients see. Owner and Admin. */
export function PortalFeatures() {
  const query = useApiQuery(QUERY, () => api.portalTabs.get());
  return (
    <Card className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-action text-on-action">
          <Settings2 aria-hidden className="size-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-heading">Portal Features</h2>
          <p className="text-sm text-muted">
            Choose which tabs appear in the client portal. Turning a tab off hides it from clients
            and blocks it by link too; it never deletes any client data.
          </p>
        </div>
      </div>
      <PageState query={query}>{(saved) => <FeaturesForm saved={saved} />}</PageState>
    </Card>
  );
}

/** One row of the form: a tab in its place, with the firm's own name or none (the default). */
type Row = { tab: PortalTab; label: string };

const rowsOf = (saved: PortalTabs): Row[] =>
  saved.layout.map((item) => ({ tab: item.tab, label: item.renamed ? item.label : '' }));

function FeaturesForm({ saved }: { saved: PortalTabs }) {
  const [tabs, setTabs] = useState(saved.tabs);
  const [rows, setRows] = useState<Row[]>(() => rowsOf(saved));
  const [confirm, setConfirm] = useState<PortalTab | null>(null);
  const [done, setDone] = useState(false);
  const save = useApiMutation((body: UpdatePortalTabsRequest) => api.portalTabs.update(body), {
    invalidate: QUERY,
  });
  const changed = (Object.keys(tabs) as PortalTab[]).filter((tab) => tabs[tab] !== saved.tabs[tab]);
  const savedRows = rowsOf(saved);
  // CP-5b, CP-5c: the order or a name changed.
  const arranged = rows.some(
    (row, i) => row.tab !== savedRows[i]?.tab || row.label.trim() !== savedRows[i]?.label,
  );
  const dirty = changed.length > 0 || arranged;
  // CP-7.1: leaving with unsaved switches asks first (components/leave-guard.tsx).
  useUnsavedChanges(dirty);
  const set = (tab: PortalTab, on: boolean) => {
    setDone(false);
    setTabs({ ...tabs, [tab]: on });
  };
  const rename = (index: number, label: string) => {
    setDone(false);
    setRows(rows.map((row, i) => (i === index ? { ...row, label } : row)));
  };
  const move = (index: number, by: -1 | 1) => {
    const to = index + by;
    const here = rows[index];
    const there = rows[to];
    if (!here || !there) return;
    setDone(false);
    const next = [...rows];
    next[index] = there;
    next[to] = here;
    setRows(next);
  };
  const nameOf = (row: Row) => row.label.trim() || PORTAL_TAB_LABELS[row.tab];
  const submit = () =>
    save.mutate(
      {
        ...(changed.length > 0
          ? { tabs: Object.fromEntries(changed.map((tab) => [tab, tabs[tab]])) }
          : {}),
        ...(arranged
          ? { layout: rows.map((row) => ({ tab: row.tab, label: row.label.trim() || null })) }
          : {}),
      },
      { onSuccess: () => setDone(true) },
    );

  return (
    <>
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <table className="w-full min-w-xl text-left text-sm">
            <caption className="sr-only">Default portal tabs</caption>
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Order
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Tab Name (Client View)
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Function
                </th>
                <th scope="col" className="py-2 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, index) => {
                const { does, icon: Icon } = META[row.tab];
                const name = nameOf(row);
                return (
                  <tr key={row.tab} data-testid={`portal-tab-${row.tab}`}>
                    <td className="py-3 pr-3 text-muted">
                      <span className="flex items-center gap-1">
                        {index + 1}
                        <Button
                          variant="ghost"
                          className="min-h-8 px-1"
                          aria-label={`Move ${name} up`}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp aria-hidden className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          className="min-h-8 px-1"
                          aria-label={`Move ${name} down`}
                          disabled={index === rows.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown aria-hidden className="size-4" />
                        </Button>
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <span className="flex items-center gap-2">
                        <Icon aria-hidden className="size-5 shrink-0 text-action" />
                        <Input
                          label={`Name of ${PORTAL_TAB_LABELS[row.tab]}`}
                          hideLabel
                          value={row.label}
                          placeholder={PORTAL_TAB_LABELS[row.tab]}
                          maxLength={40}
                          onChange={(e) => rename(index, e.target.value)}
                        />
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-muted">{does}</td>
                    <td className="py-3">
                      <Toggle
                        label={`Show ${name}`}
                        checked={tabs[row.tab]}
                        onChange={(on) => (on ? set(row.tab, true) : setConfirm(row.tab))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            Leave a name empty to use the default. Business Documents &amp; Resources shows only in
            business portals.
          </p>
        </div>
        <TabsPreview rows={rows} tabs={tabs} nameOf={nameOf} />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button disabled={!dirty || save.isPending} onClick={submit}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button
          variant="secondary"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setTabs(saved.tabs);
            setRows(savedRows);
          }}
        >
          Cancel
        </Button>
        {done && !dirty ? (
          <p role="status" className="text-sm text-success">
            Changes saved.
          </p>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, FEATURE_ERRORS)} Your changes are kept; try again.
          </p>
        ) : null}
      </div>
      <Modal
        open={confirm !== null}
        title={confirm ? `Turn off ${PORTAL_TAB_LABELS[confirm]}?` : ''}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Keep it on
            </Button>
            <Button
              onClick={() => {
                if (confirm) set(confirm, false);
                setConfirm(null);
              }}
            >
              Turn off
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          Once you save, clients no longer see this tab, and its page and actions are blocked even
          by a direct link. Nothing is deleted: documents, forms, invoices and messages stay, and
          turning it back on restores the tab as it was.
        </p>
      </Modal>
    </>
  );
}

/**
 * CP-5h: the portal's tab row as clients will see it once saved: the names in order, a tab that
 * is off left out, and Business Documents & Resources only in a business portal.
 */
function TabsPreview({
  rows,
  tabs,
  nameOf,
}: {
  rows: Row[];
  tabs: PortalTabs['tabs'];
  nameOf: (row: Row) => string;
}) {
  const [business, setBusiness] = useState(true);
  const shown = rows.filter(
    (row) => tabs[row.tab] && (business || row.tab !== 'BUSINESS_RESOURCES'),
  );
  return (
    <aside
      className="flex min-w-0 w-full flex-col gap-3 rounded-card border border-border bg-canvas p-4 xl:w-72"
      aria-label="Tab preview"
      data-testid="tabs-preview"
    >
      <div>
        <h3 className="font-semibold text-heading">Preview</h3>
        <p className="text-xs text-muted">The tabs a client sees, in order, once you save.</p>
      </div>
      <div role="group" aria-label="Portal type" className="flex gap-2">
        {[
          [true, 'Business'],
          [false, 'Personal'],
        ].map(([value, label]) => (
          <Button
            key={String(label)}
            variant={business === value ? 'primary' : 'secondary'}
            className="min-h-9 flex-1"
            aria-pressed={business === value}
            onClick={() => setBusiness(value as boolean)}
          >
            {label}
          </Button>
        ))}
      </div>
      <ol className="flex flex-col gap-1 text-sm" data-testid="tabs-preview-list">
        {shown.map((row) => (
          <li key={row.tab} className="rounded-control bg-surface px-3 py-2 text-heading">
            {nameOf(row)}
          </li>
        ))}
      </ol>
    </aside>
  );
}
