'use client';

import {
  PORTAL_TAB_LABELS,
  type PortalTab,
  type PortalTabs,
  type UpdatePortalTabsRequest,
} from '@firmivra/types';
import { Button, Card, Modal, Toggle } from '@firmivra/ui';
import {
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

const QUERY = ['portal-tabs'];

/**
 * The portal's six tabs in their order (Client Portal guide 5). Business Documents & Resources has
 * no switch yet: it needs its own module value (R0), so it always shows.
 */
const ROWS: { tab: PortalTab | null; name: string; does: string; icon: LucideIcon }[] = [
  {
    tab: 'INTAKE_FORMS',
    name: PORTAL_TAB_LABELS.INTAKE_FORMS,
    does: 'Client completes and submits forms',
    icon: FileText,
  },
  {
    tab: null,
    name: 'Business Documents & Resources',
    does: 'View company-provided documents',
    icon: FolderOpen,
  },
  {
    tab: 'DOCUMENTS',
    name: PORTAL_TAB_LABELS.DOCUMENTS,
    does: 'Client uploads documents',
    icon: CloudUpload,
  },
  {
    tab: 'TAX_RETURNS',
    name: PORTAL_TAB_LABELS.TAX_RETURNS,
    does: 'View past tax returns',
    icon: FileText,
  },
  {
    tab: 'INVOICES_PAYMENTS',
    name: PORTAL_TAB_LABELS.INVOICES_PAYMENTS,
    does: 'View invoices and payment history',
    icon: Receipt,
  },
  {
    tab: 'MESSAGES',
    name: PORTAL_TAB_LABELS.MESSAGES,
    does: 'View and reply to messages',
    icon: MessageSquare,
  },
];

/** Settings > Client Portal > Portal Features: which tabs clients see. Owner and Admin. */
export function PortalFeatures() {
  const query = useApiQuery(QUERY, () => api.portalTabs.get());
  return (
    <Card className="flex flex-col gap-4">
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
      <PageState query={query}>{(saved) => <FeaturesForm saved={saved.tabs} />}</PageState>
    </Card>
  );
}

function FeaturesForm({ saved }: { saved: PortalTabs['tabs'] }) {
  const [tabs, setTabs] = useState(saved);
  const [confirm, setConfirm] = useState<PortalTab | null>(null);
  const [done, setDone] = useState(false);
  const save = useApiMutation(
    (next: UpdatePortalTabsRequest['tabs']) => api.portalTabs.update({ tabs: next }),
    {
      invalidate: QUERY,
    },
  );
  const changed = (Object.keys(tabs) as PortalTab[]).filter((tab) => tabs[tab] !== saved[tab]);
  const set = (tab: PortalTab, on: boolean) => {
    setDone(false);
    setTabs({ ...tabs, [tab]: on });
  };

  return (
    <>
      <div className="overflow-x-auto">
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
            {ROWS.map(({ tab, name, does, icon: Icon }, index) => (
              <tr key={name}>
                <td className="py-3 pr-3 text-muted">{index + 1}</td>
                <td className="py-3 pr-3">
                  <span className="flex items-center gap-2 font-medium text-heading">
                    <Icon aria-hidden className="size-5 shrink-0 text-action" />
                    {name}
                  </span>
                </td>
                <td className="py-3 pr-3 text-muted">{does}</td>
                <td className="py-3">
                  {tab ? (
                    <Toggle
                      label={`Show ${name}`}
                      checked={tabs[tab]}
                      onChange={(on) => (on ? set(tab, true) : setConfirm(tab))}
                    />
                  ) : (
                    <span className="text-xs text-muted">Always shown</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          disabled={changed.length === 0 || save.isPending}
          onClick={() =>
            save.mutate(Object.fromEntries(changed.map((tab) => [tab, tabs[tab]])), {
              onSuccess: () => setDone(true),
            })
          }
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button
          variant="secondary"
          disabled={changed.length === 0 || save.isPending}
          onClick={() => setTabs(saved)}
        >
          Cancel
        </Button>
        {done && changed.length === 0 ? (
          <p role="status" className="text-sm text-success">
            Changes saved.
          </p>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error)} Your changes are kept; try again.
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
