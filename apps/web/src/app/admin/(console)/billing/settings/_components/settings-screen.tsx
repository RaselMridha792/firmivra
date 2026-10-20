'use client';

import { Button, Callout, Modal, Tabs } from '@firmivra/ui';
import { ArrowCounterClockwise, FloppyDisk, LockSimple } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMe } from '../../../../../../components/signed-in';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { type AdminRole, type BillingSettings } from '../../../../../../mocks/admin-billing';
import { billingSettingsErrors } from '../../../../../../mocks/admin-billing-settings';
import { formatDateTime } from '../../_components/billing-format';
import { BILLING_ERRORS } from '../../_components/billing-labels';
import { BillingNotice, useNotice } from '../../_components/billing-parts';
import { BillingHeader } from '../../_components/billing-shell';
import { GeneralTab } from './general-tab';
import { InvoicesTab } from './invoices-tab';
import { NumberingTab } from './numbering-tab';
import { PaymentsTab } from './payments-tab';
import { PermissionsTab } from './permissions-tab';
import { RemindersTab } from './reminders-tab';
import {
  highImpactChanges,
  resetTab,
  sameSettings,
  SETTINGS_TABS,
  tabLabel,
  tabsWithErrors,
  type SectionKey,
  type SettingsTabId,
} from './settings-model';
import { SettingsStatusContext, type SettingsForm, type SettingsStatus } from './settings-parts';
import { TaxesTab } from './taxes-tab';
import { TemplatesTab } from './templates-tab';
import { adminBilling, adminBillingSettings } from '../../_components/billing-api';

/**
 * Billing Settings (firmivra-billing-settings-dashboard.jpg; docx §15): platform-wide billing
 * defaults for every firm, never one firm's branding or contact details. Eight tabs edit one
 * unsaved copy of the settings:
 * - Save Changes checks every tab, opens the first tab with a problem, asks to confirm
 *   high-impact changes (features off, numbering, permissions), then saves all tabs at once.
 * - Cancel throws away every unsaved change (it asks first) and keeps the page open.
 * - Reset to Defaults puts the open tab back to Firmivra's defaults in the unsaved copy (it asks
 *   first); nothing changes for firms until Save Changes.
 */

const FORM_ID = 'billing-settings-form';

interface Loaded {
  settings: BillingSettings;
  defaults: BillingSettings;
  role: AdminRole | null;
}

export function BillingSettingsScreen() {
  const { me } = useMe();
  const [tab, setTab] = useState<SettingsTabId>('general');
  const loaded = useApiQuery(['admin-billing', 'settings-page', me.user.id], async () => {
    const [settings, defaults, admins] = await Promise.all([
      adminBilling.settings(),
      adminBillingSettings.defaults(),
      adminBilling.admins(),
    ]);
    const role = admins.find((admin) => admin.id === me.user.id)?.role ?? null;
    return { settings, defaults, role } satisfies Loaded;
  });

  if (loaded.data) return <SettingsEditor loaded={loaded.data} tab={tab} onTab={setTab} />;
  const status: SettingsStatus = loaded.isError
    ? { state: 'failed', error: loaded.error }
    : { state: 'loading' };
  return (
    <SettingsLayout
      status={status}
      form={null}
      tab={tab}
      onTab={setTab}
      saveDisabled
      footer={<SettingsFooter onReset={null} onCancel={null} dirty={false} saveDisabled />}
    />
  );
}

type Dialog =
  | { kind: 'save'; changes: string[] }
  | { kind: 'discard' }
  | { kind: 'reset'; tab: SettingsTabId }
  | null;

function SettingsEditor({
  loaded,
  tab,
  onTab,
}: {
  loaded: Loaded;
  tab: SettingsTabId;
  onTab: (tab: SettingsTabId) => void;
}) {
  const [saved, setSaved] = useState(loaded.settings);
  const [draft, setDraft] = useState(loaded.settings);
  // After a save was tried, the messages follow the draft so a fixed field clears at once.
  const [checked, setChecked] = useState(false);
  // Bumped on Cancel and Reset so every field starts again from the restored values.
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, showNotice, clearNotice] = useNotice();
  const save = useApiMutation((next: BillingSettings) => adminBillingSettings.save(next), {
    invalidate: ['admin-billing'],
  });

  const dirty = !sameSettings(saved, draft);
  const errors = checked ? billingSettingsErrors(draft).fields : {};
  const readOnly = loaded.role !== null && !saved.permissions.EDIT_SETTINGS.includes(loaded.role);

  // A reload or closing the tab asks first while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const form: SettingsForm = {
    value: draft,
    errors,
    myRole: loaded.role,
    patch: <K extends SectionKey>(key: K, value: Partial<BillingSettings[K]>) =>
      setDraft((now) => ({ ...now, [key]: { ...now[key], ...value } })),
  };

  function commit(next: BillingSettings) {
    setDialog(null);
    save.mutate(next, {
      onSuccess: (result) => {
        setSaved(result);
        setDraft(result);
        setChecked(false);
        showNotice({ tone: 'success', message: 'Billing settings saved.' });
      },
      onError: (error) =>
        showNotice({ tone: 'error', message: errorMessage(error, BILLING_ERRORS) }),
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || save.isPending) return;
    if (!dirty) {
      showNotice({ tone: 'success', message: 'No changes to save.' });
      return;
    }
    const found = billingSettingsErrors(draft).fields;
    const broken = tabsWithErrors(found);
    setChecked(true);
    const first = broken[0];
    if (first) {
      if (!broken.includes(tab)) onTab(first);
      showNotice({
        tone: 'error',
        message: `Fix the highlighted fields before saving: ${broken.map(tabLabel).join(', ')}.`,
      });
      return;
    }
    const changes = highImpactChanges(saved, draft, loaded.role);
    if (changes.length) setDialog({ kind: 'save', changes });
    else commit(draft);
  }

  function restore(next: BillingSettings) {
    setDraft(next);
    setRevision((n) => n + 1);
    setDialog(null);
  }

  return (
    <>
      <SettingsLayout
        status={{ state: 'ready' }}
        form={form}
        tab={tab}
        onTab={onTab}
        readOnly={readOnly}
        revision={revision}
        saveDisabled={readOnly || save.isPending}
        saving={save.isPending}
        onSubmit={onSubmit}
        footer={
          <SettingsFooter
            dirty={dirty}
            saving={save.isPending}
            saveDisabled={readOnly || save.isPending}
            onReset={readOnly ? null : () => setDialog({ kind: 'reset', tab })}
            onCancel={readOnly || !dirty ? null : () => setDialog({ kind: 'discard' })}
            tab={tab}
            meta={`Last saved ${formatDateTime(saved.updatedAt)} by ${saved.updatedBy}.`}
          />
        }
      />

      <Modal
        open={dialog?.kind === 'save'}
        title="Apply these changes to every firm?"
        subtitle="These settings are the defaults for all firms on Firmivra."
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Keep Editing
            </Button>
            <Button onClick={() => commit(draft)}>Save Changes</Button>
          </>
        }
      >
        <ul data-testid="settings-impact" className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {dialog?.kind === 'save'
            ? dialog.changes.map((change) => <li key={change}>{change}</li>)
            : null}
        </ul>
      </Modal>
      <Modal
        open={dialog?.kind === 'discard'}
        title="Discard unsaved changes?"
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Keep Editing
            </Button>
            <Button
              onClick={() => {
                setChecked(false);
                restore(saved);
              }}
            >
              Discard Changes
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">Every tab goes back to the last saved settings.</p>
      </Modal>
      <Modal
        open={dialog?.kind === 'reset'}
        title={`Reset ${dialog?.kind === 'reset' ? tabLabel(dialog.tab) : ''} to defaults?`}
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (dialog?.kind === 'reset') restore(resetTab(dialog.tab, draft, loaded.defaults));
              }}
            >
              Reset to Defaults
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          This tab goes back to Firmivra&apos;s default settings. Nothing changes for firms until
          you save.
        </p>
      </Modal>
      <BillingNotice notice={notice} onDismiss={clearNotice} />
    </>
  );
}

/** The page: title row, the tab bar card, the open tab's cards and the action bar. */
function SettingsLayout({
  status,
  form,
  tab,
  onTab,
  readOnly = false,
  revision = 0,
  saveDisabled,
  saving = false,
  onSubmit,
  footer,
}: {
  status: SettingsStatus;
  form: SettingsForm | null;
  tab: SettingsTabId;
  onTab: (tab: SettingsTabId) => void;
  readOnly?: boolean;
  revision?: number;
  saveDisabled: boolean;
  saving?: boolean;
  onSubmit?: (event: FormEvent) => void;
  footer: ReactNode;
}) {
  const panels: Record<SettingsTabId, ReactNode> = {
    general: <GeneralTab form={form} />,
    invoices: <InvoicesTab form={form} />,
    payments: <PaymentsTab form={form} />,
    taxes: <TaxesTab form={form} />,
    reminders: <RemindersTab form={form} />,
    templates: <TemplatesTab form={form} />,
    numbering: <NumberingTab form={form} />,
    permissions: <PermissionsTab form={form} />,
  };
  return (
    <SettingsStatusContext value={status}>
      <div className="flex min-w-0 flex-col gap-6">
        <BillingHeader
          title="Billing Settings"
          subtitle="Configure platform-wide billing settings and defaults for all firms."
          breadcrumbs={[{ label: 'Billing', href: '/billing' }, { label: 'Billing Settings' }]}
          actions={
            <Button
              type="submit"
              form={FORM_ID}
              data-testid="settings-save"
              disabled={saveDisabled}
              className="min-h-12 px-5"
            >
              <FloppyDisk aria-hidden weight="fill" className="size-5" />
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          }
        />
        {readOnly ? (
          <Callout icon={LockSimple} size="compact" title="View only">
            You can see Billing Settings but not change them. An Owner can give your role Edit
            Billing Settings on the Permissions tab.
          </Callout>
        ) : null}
        <form
          id={FORM_ID}
          noValidate
          aria-label="Billing settings"
          onSubmit={onSubmit ?? ((event) => event.preventDefault())}
          className="flex min-w-0 flex-col gap-2"
        >
          <div className="min-w-0 [&_[role=tab]]:mb-0 [&_[role=tab]]:min-h-12 [&_[role=tab]]:border-b-3 [&_[role=tab]]:px-4 xl:[&_[role=tab]]:px-6 [&_[role=tab][aria-selected=false]]:text-heading [&_[role=tablist]]:gap-0 [&_[role=tablist]]:rounded-lg [&_[role=tablist]]:border-b-0 [&_[role=tablist]]:bg-surface [&_[role=tablist]]:shadow-sm [&_[role=tabpanel]]:pt-2 [&_[role=tabpanel]]:pb-0">
            <Tabs
              label="Billing settings sections"
              variant="underline"
              value={tab}
              onChange={(id) => {
                const next = SETTINGS_TABS.find((item) => item.id === id);
                if (next) onTab(next.id);
              }}
              items={SETTINGS_TABS.map((item) => ({
                id: item.id,
                label: item.label,
                content:
                  item.id === tab ? (
                    <fieldset
                      key={revision}
                      disabled={readOnly}
                      className="m-0 min-w-0 border-0 p-0"
                    >
                      <legend className="sr-only">{item.label}</legend>
                      {panels[item.id]}
                    </fieldset>
                  ) : null,
              }))}
            />
          </div>
          {footer}
        </form>
      </div>
    </SettingsStatusContext>
  );
}

/** The bar under the open tab: Reset to Defaults on the left; Cancel and Save on the right. */
function SettingsFooter({
  dirty,
  saving = false,
  saveDisabled,
  onReset,
  onCancel,
  tab,
  meta,
}: {
  dirty: boolean;
  saving?: boolean;
  saveDisabled: boolean;
  /** null hides the button (still loading, or view only). */
  onReset: (() => void) | null;
  onCancel: (() => void) | null;
  tab?: SettingsTabId;
  meta?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface px-4 py-4 shadow-sm md:flex-row md:items-center md:justify-between md:px-5">
      <div className="flex min-w-0 flex-col gap-1">
        {onReset && tab ? (
          <div>
            <Button variant="ghost" onClick={onReset} className="-ml-4">
              <ArrowCounterClockwise aria-hidden weight="bold" className="size-5" />
              Reset {tabLabel(tab)} to Defaults
            </Button>
          </div>
        ) : null}
        {meta ? (
          <p data-testid="settings-meta" className="text-sm text-muted">
            {meta}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {dirty ? (
          <span data-testid="settings-unsaved" className="text-sm text-muted">
            Unsaved changes
          </span>
        ) : null}
        <Button variant="secondary" onClick={onCancel ?? undefined} disabled={!onCancel}>
          Cancel
        </Button>
        <Button type="submit" data-testid="settings-save-bottom" disabled={saveDisabled}>
          <FloppyDisk aria-hidden weight="fill" className="size-5" />
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
