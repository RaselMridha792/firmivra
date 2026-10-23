'use client';

import {
  ArrowCounterClockwise,
  Bell,
  EnvelopeSimple,
  Eye,
  FileText,
  FloppyDisk,
  GearSix,
  type Icon,
  Lightning,
  LinkSimple,
  Palette,
  ShieldCheck,
  User,
} from '@phosphor-icons/react';
import type { IntakeSettings, UpdateIntakeSettingsRequest } from '@firmivra/types';
import {
  Button,
  IconTile,
  KpiCard,
  type KpiTone,
  Modal,
  PageHeader,
  Skeleton,
  Toast,
} from '@firmivra/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { portalAuth } from '../../../../../../lib/auth';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  AutomationCard,
  BrandingCard,
  ClientExperienceCard,
  GeneralCard,
  type Member,
  NotificationsCard,
  SecurityCard,
} from './settings-cards';
import type { FrameState } from './settings-look';
import {
  apiFieldErrors,
  CHANGES_KEY,
  changesOf,
  checklist,
  type Draft,
  type FieldErrors,
  type Group,
  INTAKE_KEY,
  remindersOn,
  type SectionId,
  sectionDomId,
  SETTINGS_KEY,
  switches,
  toDraft,
  validate,
} from './settings-model';
import { FullPreview } from './settings-preview';
import {
  ClientPreviewFrame,
  RecentChanges,
  SettingsChecklist,
  SettingsProTip,
} from './settings-side';

/** The left nav: the guide's eight categories, in the design's order. */
const SECTIONS: { id: SectionId; label: string; icon: Icon }[] = [
  { id: 'general', label: 'General', icon: GearSix },
  { id: 'client', label: 'Client Experience', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'automation', label: 'Automation', icon: Lightning },
  { id: 'submission', label: 'Submission Rules', icon: FileText },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'security', label: 'Security & Compliance', icon: ShieldCheck },
  { id: 'integrations', label: 'Integrations', icon: LinkSimple },
];

/** The API's words for its codes, here and not in lib/errors (Intake Forms only). */
const MESSAGES = {
  SAVE_CONFLICT: 'Someone saved these settings after you opened them. Reload and try again.',
  TEST_REMINDER_UNAVAILABLE: 'Test reminder emails are not available yet.',
};
const STAFF_ONLY = 'Only an owner or admin can change these settings.';
const FIX = 'Some details need fixing. Check the highlighted fields.';

interface Edits {
  draft: Draft;
  /** The saved settings the edits started from, and their version (one version at a time). */
  base: Draft;
  version: string;
}
type Notice = { message: string; tone: 'success' | 'error' };

/** A top card whose value is a word (Email Reminders: On), label first as the design draws it. */
function StatusKpi({
  icon,
  tone,
  label,
  value,
  on,
  note,
  loading,
}: {
  icon: Icon;
  tone: KpiTone;
  label: string;
  value: string;
  on: boolean;
  note: string;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-surface p-4 shadow-md">
      <IconTile icon={icon} tone={tone} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm text-heading">{label}</span>
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <span className={`text-2xl leading-none font-bold ${on ? 'text-success' : 'text-muted'}`}>
            {value}
          </span>
        )}
        {note ? <span className="text-xs text-muted">{note}</span> : null}
      </div>
    </div>
  );
}

function Kpis({ settings, loading }: { settings: IntakeSettings | undefined; loading: boolean }) {
  const all = settings ? switches(settings) : [];
  const reminders = settings ? remindersOn(settings) : false;
  const rules = settings?.automation.automationRuleCount;
  const esign = settings?.general.requireSignature ?? false;
  /** The line under a value: only from loaded settings; quiet while loading, a note when failed. */
  const note = (text: string) => (settings ? text : loading ? '' : 'Could not load this right now');
  return (
    <section
      aria-label="Settings summary"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      data-testid="settings-kpis"
    >
      <div className="min-w-0" data-testid="kpi-active">
        <KpiCard
          icon={GearSix}
          tone="purple"
          label="Active Settings"
          loading={loading}
          value={settings ? all.filter(Boolean).length : '—'}
          note={note(`Of ${all.length} on/off settings`)}
        />
      </div>
      <div className="min-w-0" data-testid="kpi-reminders">
        <StatusKpi
          icon={EnvelopeSimple}
          tone="blue"
          label="Email Reminders"
          loading={loading}
          value={settings ? (reminders ? 'On' : 'Off') : '—'}
          on={reminders}
          note={note(reminders ? 'Automated reminders active' : 'No reminders scheduled')}
        />
      </div>
      <div className="min-w-0" data-testid="kpi-rules">
        <KpiCard
          icon={Lightning}
          tone="amber"
          label="Automation Rules"
          loading={loading}
          value={rules ?? '—'}
          note={note(rules === undefined ? 'Not available yet' : 'Rules using intake events')}
        />
      </div>
      <div className="min-w-0" data-testid="kpi-esign">
        <StatusKpi
          icon={FileText}
          tone="green"
          label="E-Sign"
          loading={loading}
          value={settings ? (esign ? 'Enabled' : 'Off') : '—'}
          on={esign}
          note={note(esign ? 'Electronic signatures active' : 'Signatures not required')}
        />
      </div>
    </section>
  );
}

/** The two categories with no card in the design: what covers them today, and where. */
function SectionNote({ section, onOpen }: { section: SectionId; onOpen: (id: SectionId) => void }) {
  if (section === 'submission')
    return (
      <div className="rounded-xl bg-surface p-3 text-sm shadow-md" data-testid="section-note">
        <p className="font-bold text-heading">Submission Rules</p>
        <p className="mt-1 text-xs text-muted">
          Required answers, e-signature and expiration follow General Settings and each form&apos;s
          own settings. Separate submission rules are not available yet.
        </p>
        <button
          type="button"
          onClick={() => onOpen('general')}
          className="mt-2 text-xs font-medium text-link underline"
        >
          Go to General Settings
        </button>
      </div>
    );
  if (section === 'integrations')
    return (
      <div className="rounded-xl bg-surface p-3 text-sm shadow-md" data-testid="section-note">
        <p className="font-bold text-heading">Integrations</p>
        <p className="mt-1 text-xs text-muted">
          Email, e-signature, document and portal delivery use the services your firm connects in
          Integrations. Intake settings for them are not available yet.
        </p>
        <Link
          href="/integrations"
          className="mt-2 inline-block text-xs font-medium text-link underline"
        >
          Open Integrations
        </Link>
      </div>
    );
  return null;
}

const quickAction =
  'flex min-h-11 items-center gap-3 px-3 py-2 text-left text-sm text-heading hover:bg-folder-hover disabled:cursor-not-allowed disabled:text-muted xl:justify-center';

/**
 * Intake Forms > Intake Form Settings (intake-form-settings.jpg; guide Frame 5): the firm's
 * defaults for every intake form. One draft over the six cards, saved with the version it was
 * loaded at; KPIs, the checklist and Recent Changes from the saved settings. Every frame keeps
 * its place while it loads, when the firm is new and when the API can't be reached.
 */
export function SettingsScreen() {
  const { firm, role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const settings = useApiQuery(SETTINGS_KEY, () => api.intakeForms.settings());
  const changes = useApiQuery(CHANGES_KEY, () => api.intakeForms.settingsChanges());
  const team = useApiQuery(['team'], () => api.team.list());
  // The layout's own query (same key): every role can read the firm's logo and colours.
  const info = useApiQuery(['firm', firm.id, 'branding'], () => portalAuth(firm.slug).info());

  const [edits, setEdits] = useState<Edits | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [conflict, setConflict] = useState(false);
  const [active, setActive] = useState<SectionId>('general');
  const [confirmReset, setConfirmReset] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const update = useApiMutation(
    (body: UpdateIntakeSettingsRequest) => api.intakeForms.updateSettings(body),
    { invalidate: INTAKE_KEY },
  );
  const reset = useApiMutation(() => api.intakeForms.resetSettings({ confirm: true }), {
    invalidate: INTAKE_KEY,
  });
  const testReminder = useApiMutation(() => api.intakeForms.testReminder());

  const saved = settings.data;
  const draft = edits?.draft ?? (saved ? toDraft(saved) : null);
  const dirty = edits !== null && Object.keys(changesOf(edits.draft, edits.base)).length > 0;

  // Leaving with unsaved edits asks first (the browser's own question).
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <G extends Group>(group: G, patch: Partial<Draft[G]>) => {
    if (!saved) return;
    setEdits((current) => {
      const start = current ?? {
        draft: toDraft(saved),
        base: toDraft(saved),
        version: saved.version,
      };
      return { ...start, draft: { ...start.draft, [group]: { ...start.draft[group], ...patch } } };
    });
    // A field's message goes once it is changed.
    setErrors((current) => {
      const keys = Object.keys(patch).map((key) => `${group}.${key}`);
      if (!keys.some((key) => key in current)) return current;
      return Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key)));
    });
  };

  const members: Member[] = (team.data ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ userId: m.user.id, name: m.user.name }));

  function reload() {
    setEdits(null);
    setErrors({});
    setConflict(false);
    setNotice(null);
    void settings.refetch();
  }

  function save() {
    setNotice(null);
    setConflict(false);
    if (!saved || !draft) return;
    if (!manager) return setNotice({ message: STAFF_ONLY, tone: 'error' });
    const current = edits ?? { draft, base: draft, version: saved.version };
    const body: UpdateIntakeSettingsRequest = {
      version: current.version,
      ...changesOf(current.draft, current.base),
    };
    if (Object.keys(body).length === 1)
      return setNotice({ message: 'There are no changes to save.', tone: 'success' });
    const invalid = validate(current.draft, body);
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      return setNotice({ message: FIX, tone: 'error' });
    }
    setErrors({});
    update.mutate(body, {
      onSuccess: () => {
        setEdits(null);
        setNotice({ message: 'Your intake settings were saved.', tone: 'success' });
      },
      onError: (error) => {
        if (errorCode(error) === 'SAVE_CONFLICT') return setConflict(true);
        const fields = apiFieldErrors(error);
        if (Object.keys(fields).length) setErrors(fields);
        setNotice({ message: errorMessage(error, MESSAGES), tone: 'error' });
      },
    });
  }

  function resetDefaults() {
    setNotice(null);
    setConflict(false);
    reset.mutate(undefined, {
      onSuccess: () => {
        setConfirmReset(false);
        setEdits(null);
        setErrors({});
        setNotice({ message: 'The intake settings were reset to the defaults.', tone: 'success' });
      },
      onError: (error) => {
        setConfirmReset(false);
        setNotice({ message: errorMessage(error, MESSAGES), tone: 'error' });
      },
    });
  }

  function sendTestReminder() {
    setNotice(null);
    testReminder.mutate(undefined, {
      onSuccess: () =>
        setNotice({
          message: 'A test reminder email was sent to you. No client was contacted.',
          tone: 'success',
        }),
      onError: (error) => setNotice({ message: errorMessage(error, MESSAGES), tone: 'error' }),
    });
  }

  /** The nav, the Edit links and the checklist: select the category and bring its card in view. */
  function open(section: SectionId, focus = false) {
    setActive(section);
    const card = document.getElementById(sectionDomId(section));
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (focus)
      card
        .querySelector<HTMLElement>(
          'select:enabled, input:enabled, textarea:enabled, button[role="switch"]:enabled',
        )
        ?.focus({ preventScroll: true });
  }

  const state: FrameState = settings.isPending
    ? { kind: 'loading' }
    : !saved
      ? { kind: 'failed', error: settings.error, retry: () => void settings.refetch() }
      : { kind: 'ready' };
  const cardProps = {
    draft,
    set,
    errors,
    state,
    readOnly: !manager || update.isPending || reset.isPending,
    onEdit: (section: SectionId) => open(section, true),
  };
  const branding = info.data?.branding;
  const busy = update.isPending || reset.isPending;
  const checks = saved ? checklist(saved, info.isError ? null : (branding ?? null)) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="intake-settings-page">
      {/* The subtitle under the header, so the buttons stay beside the title at 1440 px as the
          design draws them (the kit header puts a long subtitle and the buttons on one row). */}
      <div className="flex flex-col gap-1">
        <PageHeader
          title="Intake Form Settings"
          actions={
            <>
              {dirty ? (
                <span className="text-sm font-medium text-warning" data-testid="unsaved">
                  Unsaved changes
                </span>
              ) : null}
              <Button
                disabled={!saved || busy || !manager}
                title={manager ? undefined : STAFF_ONLY}
                onClick={save}
              >
                <FloppyDisk aria-hidden weight="fill" className="size-5" />
                Save Changes
              </Button>
              <Button variant="outline" onClick={() => setPreviewing(true)}>
                <Eye aria-hidden weight="fill" className="size-5" />
                Preview Client View
              </Button>
              <Button
                variant="outline"
                disabled={!saved || busy || !manager}
                title={manager ? undefined : STAFF_ONLY}
                onClick={() => setConfirmReset(true)}
              >
                <ArrowCounterClockwise aria-hidden weight="bold" className="size-5" />
                Reset Defaults
              </Button>
            </>
          }
        />
        <p className="text-base text-muted">
          Configure defaults, client experience, reminders, automation, and submission behavior for
          all intake forms.
        </p>
      </div>

      {!manager ? <p className="text-sm text-muted">{STAFF_ONLY}</p> : null}
      {conflict ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-danger-soft p-4 text-danger"
          data-testid="save-conflict"
        >
          <span>{MESSAGES.SAVE_CONFLICT}</span>
          <Button variant="secondary" onClick={reload}>
            Reload Settings
          </Button>
        </div>
      ) : null}
      {notice ? (
        <Toast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <Kpis settings={saved} loading={settings.isPending} />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
            <div className="flex flex-col gap-3 xl:w-48 xl:shrink-0">
              <nav aria-label="Settings categories" data-testid="settings-nav">
                <ul className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-1 xl:gap-0 xl:divide-y xl:divide-divider">
                  {SECTIONS.map(({ id, label, icon: Glyph }) => {
                    const selected = active === id;
                    return (
                      <li key={id} className="min-w-0">
                        <button
                          type="button"
                          aria-current={selected ? 'true' : undefined}
                          onClick={() => open(id)}
                          className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm ${selected ? 'bg-action font-medium text-on-action' : 'text-heading hover:bg-folder-hover'}`}
                        >
                          <Glyph aria-hidden weight="fill" className="size-5 shrink-0" />
                          <span className="min-w-0">{label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <SectionNote section={active} onOpen={(id) => open(id, true)} />
            </div>

            <div className="@container min-w-0 flex-1">
              <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
                <GeneralCard
                  {...cardProps}
                  members={members}
                  savedOwner={saved?.general.defaultOwner ?? null}
                />
                <ClientExperienceCard {...cardProps} />
                <NotificationsCard {...cardProps} />
                <AutomationCard
                  {...cardProps}
                  members={members}
                  savedOwner={saved?.automation.defaultFollowUpOwner ?? null}
                />
                <SecurityCard
                  {...cardProps}
                  savedFileSizeMb={saved?.security.maxFileSizeMb ?? null}
                />
                <BrandingCard
                  {...cardProps}
                  firmName={firm.name}
                  branding={branding}
                  brandingFailed={info.isError}
                />
              </div>
            </div>
          </div>

          <section
            aria-labelledby="settings-quick-actions-title"
            className="rounded-xl bg-info-soft px-4 py-3"
            data-testid="settings-quick-actions"
          >
            <h2 id="settings-quick-actions-title" className="text-base font-bold text-heading">
              Quick Actions
            </h2>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4 xl:gap-0 xl:divide-x xl:divide-folder-border">
              <div className="xl:pr-6">
                <Button
                  className="w-full"
                  disabled={!saved || busy || !manager}
                  title={manager ? undefined : STAFF_ONLY}
                  onClick={save}
                >
                  <FloppyDisk aria-hidden weight="fill" className="size-5" />
                  Save Settings
                </Button>
              </div>
              <button
                type="button"
                disabled={testReminder.isPending || !manager}
                title={manager ? undefined : STAFF_ONLY}
                onClick={sendTestReminder}
                className={quickAction}
              >
                <EnvelopeSimple aria-hidden weight="fill" className="size-6 shrink-0" />
                <span>Test Reminder Email</span>
              </button>
              <button type="button" onClick={() => setPreviewing(true)} className={quickAction}>
                <Eye aria-hidden weight="fill" className="size-6 shrink-0" />
                <span>Preview Form</span>
              </button>
              <Link href="/intake-forms/templates" className={quickAction}>
                <FileText aria-hidden weight="fill" className="size-6 shrink-0" />
                <span>Manage Templates</span>
              </Link>
            </div>
          </section>
        </div>

        <aside
          aria-label="Checklist, changes and preview"
          className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:w-64 xl:shrink-0 xl:grid-cols-1"
        >
          <SettingsChecklist
            checks={checks}
            loading={settings.isPending}
            failed={saved ? null : { error: settings.error, retry: () => void settings.refetch() }}
            onOpen={(section) => open(section, true)}
          />
          <RecentChanges changes={changes} />
          <ClientPreviewFrame
            draft={draft}
            firmName={firm.name}
            branding={branding}
            onFullPreview={() => setPreviewing(true)}
          />
          <SettingsProTip />
        </aside>
      </div>

      <FullPreview
        open={previewing}
        onClose={() => setPreviewing(false)}
        draft={draft}
        firmName={firm.name}
        branding={branding}
      />
      <Modal
        open={confirmReset}
        title="Reset to the defaults?"
        subtitle="Every intake setting on this page goes back to Firmivra's default."
        onClose={() => setConfirmReset(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button disabled={reset.isPending} onClick={resetDefaults}>
              Reset Defaults
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          Your customized settings, including changes not saved yet, are replaced. Forms already
          sent keep their own settings, and other modules are not changed.
        </p>
      </Modal>
    </div>
  );
}
