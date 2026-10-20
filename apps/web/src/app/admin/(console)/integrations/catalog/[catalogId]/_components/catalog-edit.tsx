'use client';

import { ApiRequestError } from '@firmivra/types';
import { Button, Callout, Card, Modal, Tabs, Toast } from '@firmivra/ui';
import { ArrowLeft, ArrowSquareOut, WarningCircle } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  CATALOG_STATUS_LABELS,
  CATEGORY_LABELS,
  type CatalogStatus,
  type UpdateCatalogBody,
} from '../../../_components/integrations-contract';
import { ServiceLogo } from '../../../_components/integration-badges';
import { Loaded, loadError } from '../../../_components/integration-states';
import { IntegrationsHeader, LinkButton } from '../../../_components/integrations-shell';
import type { Notice } from '../../../_components/platform-actions';
import {
  AccessLossDialog,
  catalogErrorMessage,
  NotFoundCard,
  OutlineButton,
} from '../../_components/catalog-parts';
import { CatalogPreviewDialog } from '../../_components/catalog-preview';
import { isAccessLoss } from '../../_components/catalog-status';
import { AccessTab } from './access-tab';
import {
  changesOf,
  checkDraft,
  draftOf,
  type Draft,
  type DraftError,
  type EditTab,
} from './catalog-draft';
import { TabFallback } from './edit-parts';
import { QuickStats, StatusCard, TestConnectionCard } from './edit-rail';
import { GeneralTab } from './general-tab';
import { AdvancedTab, DisplayTab, SetupTab } from './setup-tabs';

/**
 * Manage / Edit Customer Integration (stripe-integration-admin-dashboard-1.jpg, the catalog edit
 * screen; docx §7): the entry's customer-facing details on five tabs (General, Access &
 * Permissions, Customer Setup, Display & Branding, Advanced), its status, quick stats and the
 * platform connection test, View in Catalog, and Save Changes with the version read. A save that
 * removes access from connected firms asks first; a stale save is refused and offers Reload.
 */

const TABS: readonly EditTab[] = ['general', 'access', 'setup', 'display', 'advanced'];
const TAB_LABELS: Record<EditTab, string> = {
  general: 'General',
  access: 'Access & Permissions',
  setup: 'Customer Setup',
  display: 'Display & Branding',
  advanced: 'Advanced',
};

const STATUS_TAG: Record<CatalogStatus, string> = {
  ENABLED: 'bg-success-soft text-success',
  DISABLED: 'bg-disabled text-muted',
  COMING_SOON: 'bg-purple-soft text-purple',
};

/** Focus a field once its tab is showing. */
function focusLater(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

export function CatalogEdit({ catalogId }: { catalogId: string }) {
  const router = useRouter();
  const detail = useApiQuery(['admin-integrations', 'catalog', catalogId], () =>
    adminIntegrations.getCatalog(catalogId),
  );
  const plans = useApiQuery(['admin-integrations', 'plans'], () => adminIntegrations.plans());
  const firms = useApiQuery(['admin-integrations', 'firms'], () => adminIntegrations.firmOptions());
  const access = useApiQuery(['admin-integrations', 'access'], () => adminIntegrations.access());
  const platform = useApiQuery(['admin-integrations', 'platform', 'list', 'catalog-picker'], () =>
    adminIntegrations.listPlatform({ sort: 'name', pageSize: 100 }),
  );
  const [tab, setTab] = useState<EditTab>('general');
  // Null until the first edit: the form shows the saved entry until then.
  const [draft, setDraft] = useState<Draft | null>(null);
  // The version the edits started from; a firm override saved meanwhile moves it on.
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<DraftError[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [asking, setAsking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const save = useApiMutation(
    (body: UpdateCatalogBody) => adminIntegrations.updateCatalog(catalogId, body),
    { invalidate: ['admin-integrations'] },
  );

  const item = detail.data;
  const saved = item ? draftOf(item) : null;
  const current = draft ?? saved;
  const changes: ReturnType<typeof changesOf> = current && saved ? changesOf(current, saved) : {};
  const dirty = Object.keys(changes).length > 0;
  const locked = !access.data?.canManageConfiguration;

  // Leaving the page with unsaved changes asks the browser to confirm (docx §14: no data loss).
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function set(patch: Partial<Draft>) {
    if (!item) return;
    const next = { ...(draft ?? draftOf(item)), ...patch };
    setDraft(next);
    if (baseVersion === null) setBaseVersion(item.version);
    if (errors.length) setErrors(checkDraft(next));
  }
  const errorFor = (id: string) => errors.find((error) => error.id === id)?.message;

  function submit(confirm: boolean) {
    if (!item || !current) return;
    const problems = checkDraft(current);
    setErrors(problems);
    const first = problems[0];
    if (first) {
      setTab(first.tab);
      focusLater(first.id);
      return;
    }
    if (!dirty) return;
    save.mutate(
      {
        ...changes,
        version: baseVersion ?? item.version,
        confirmAccessLoss: confirm || undefined,
      },
      {
        onSuccess: (result) => {
          setDraft(null);
          setBaseVersion(null);
          setAsking(false);
          setNotice({ tone: 'success', text: `${result.name}: changes saved.` });
        },
        onError: (error) => {
          if (isAccessLoss(error) && !confirm) {
            setAsking(true);
            return;
          }
          setAsking(false);
        },
      },
    );
  }
  function reload() {
    setDraft(null);
    setBaseVersion(null);
    setErrors([]);
    save.reset();
    void detail.refetch();
  }
  function cancel() {
    if (dirty) setLeaving(true);
    else router.push('/integrations/catalog');
  }

  const notFound = detail.error instanceof ApiRequestError && detail.error.code === 'NOT_FOUND';
  const header = (
    <IntegrationsHeader
      title="Manage Integration"
      subtitle="Update the details, access settings, and customer-facing information for this integration."
      crumbs={[
        { label: 'Integrations', href: '/integrations' },
        { label: 'Customer Integration Catalog', href: '/integrations/catalog' },
        { label: 'Manage Integration' },
      ]}
      actions={
        <LinkButton href="/integrations/catalog">
          <ArrowLeft aria-hidden weight="bold" className="size-5" />
          Back to Catalog
        </LinkButton>
      }
    />
  );
  if (notFound)
    return (
      <div className="flex min-w-0 flex-col gap-5">
        {header}
        <NotFoundCard text="We couldn't find this catalog integration. It may have been removed, or the link is wrong." />
      </div>
    );

  const tabProps = current ? { draft: current, set, errorFor, locked } : null;
  const fallback = (title: string) => <TabFallback title={title} query={detail} />;
  const conflict = save.error instanceof ApiRequestError && save.error.code === 'CONFLICT';
  const lossFirms =
    item && changes.status === 'DISABLED' && item.status !== 'DISABLED'
      ? item.stats.firmsUsing
      : null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {header}
      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <Card data-testid="catalog-summary" className="p-5!">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <Loaded query={detail} rows={2}>
              {(entry) => (
                <div className="flex min-w-0 items-center gap-5">
                  <ServiceLogo category={entry.category} size="lg" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 data-testid="catalog-name" className="text-3xl font-bold text-heading">
                        {entry.name}
                      </h2>
                      <span
                        data-testid="catalog-status-tag"
                        className={`rounded-md px-2.5 py-1 text-sm font-medium ${STATUS_TAG[entry.status]}`}
                      >
                        {CATALOG_STATUS_LABELS[entry.status]}
                      </span>
                    </div>
                    <p className="text-sm text-text">
                      {CATEGORY_LABELS[entry.category]}
                      <span aria-hidden className="mx-3 text-border">
                        |
                      </span>
                      <span className="sr-only">: </span>
                      {entry.shortDescription}
                    </p>
                  </div>
                </div>
              )}
            </Loaded>
          </div>
          <OutlineButton onClick={() => setPreviewing(true)} disabled={!item}>
            View in Catalog
            <ArrowSquareOut aria-hidden weight="fill" className="size-5" />
          </OutlineButton>
        </div>
      </Card>

      {errors.length ? (
        <div role="alert" data-testid="edit-errors">
          <Callout
            surface="warning"
            iconStyle="tile"
            tone="amber"
            icon={WarningCircle}
            title={`Fix ${errors.length === 1 ? 'this field' : `these ${errors.length} fields`} before saving`}
          >
            <ul className="flex flex-col gap-1">
              {errors.map((error) => (
                <li key={`${error.id}-${error.message}`}>
                  <button
                    type="button"
                    className="text-left text-link hover:underline"
                    onClick={() => {
                      setTab(error.tab);
                      focusLater(error.id);
                    }}
                  >
                    {TAB_LABELS[error.tab]} · {error.label}: {error.message}
                  </button>
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-3 xl:items-start">
        <div className="min-w-0 xl:col-span-2">
          <Tabs
            label="Catalog integration sections"
            variant="underline"
            value={tab}
            onChange={(id) => setTab(TABS.find((value) => value === id) ?? 'general')}
            items={[
              {
                id: 'general',
                label: TAB_LABELS.general,
                content: tabProps ? <GeneralTab {...tabProps} /> : fallback('General Information'),
              },
              {
                id: 'access',
                label: TAB_LABELS.access,
                content:
                  tabProps && item ? (
                    <AccessTab
                      {...tabProps}
                      item={item}
                      plans={plans}
                      firms={firms}
                      dirty={dirty}
                      onNotice={setNotice}
                      onVersion={(version) =>
                        setBaseVersion((previous) => (previous === null ? null : version))
                      }
                    />
                  ) : (
                    fallback('Access & Permissions')
                  ),
              },
              {
                id: 'setup',
                label: TAB_LABELS.setup,
                content: tabProps ? <SetupTab {...tabProps} /> : fallback('Customer Setup'),
              },
              {
                id: 'display',
                label: TAB_LABELS.display,
                content: tabProps ? <DisplayTab {...tabProps} /> : fallback('Display & Branding'),
              },
              {
                id: 'advanced',
                label: TAB_LABELS.advanced,
                content: tabProps ? (
                  <AdvancedTab {...tabProps} platform={platform} />
                ) : (
                  fallback('Advanced')
                ),
              },
            ]}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:pt-16">
          <StatusCard
            status={current?.status ?? null}
            saved={item?.status ?? null}
            firmsUsing={item?.stats.firmsUsing ?? null}
            disabled={locked}
            failed={detail.isError ? loadError(detail.error) : null}
            onChange={(status) => set({ status })}
          />
          <QuickStats query={detail} />
          <TestConnectionCard query={detail} />
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" onClick={cancel} className="sm:min-w-28">
          Cancel
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {save.isError && !asking ? (
            <p role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
              {catalogErrorMessage(save.error)}
              {conflict ? (
                <Button variant="secondary" onClick={reload}>
                  Reload
                </Button>
              ) : null}
            </p>
          ) : dirty ? (
            <p role="status" className="text-sm text-muted">
              You have unsaved changes.
            </p>
          ) : null}
          <Button
            onClick={() => submit(false)}
            disabled={!item || locked || !dirty || save.isPending}
            className="min-w-40"
          >
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {asking && item ? (
        <AccessLossDialog
          name={item.name}
          firms={lossFirms}
          change={
            changes.status
              ? `becomes ${CATALOG_STATUS_LABELS[changes.status]}`
              : 'these changes are saved'
          }
          busy={save.isPending}
          error={save.isError && !isAccessLoss(save.error) ? catalogErrorMessage(save.error) : null}
          onCancel={() => setAsking(false)}
          onConfirm={() => submit(true)}
        />
      ) : null}
      {previewing && item ? (
        <CatalogPreviewDialog
          catalogId={item.id}
          note={
            dirty
              ? 'Unsaved changes are not in this preview. Display & Branding shows them before saving.'
              : undefined
          }
          onClose={() => setPreviewing(false)}
        />
      ) : null}
      {leaving ? (
        <Modal
          open
          title="Discard your changes?"
          subtitle={item?.name}
          onClose={() => setLeaving(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setLeaving(false)}>
                Keep Editing
              </Button>
              <Button onClick={() => router.push('/integrations/catalog')}>Discard Changes</Button>
            </>
          }
        >
          <p className="max-w-md text-sm text-text">
            Your changes to this catalog integration are not saved. Leave without saving them?
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
