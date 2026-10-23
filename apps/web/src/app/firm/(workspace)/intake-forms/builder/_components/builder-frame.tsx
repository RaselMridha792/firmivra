'use client';

import { ApiRequestError, type IntakeFormDetail, type QuestionType } from '@firmivra/types';
import { Button, Skeleton } from '@firmivra/ui';
import {
  CaretRight,
  Eye,
  Graph,
  type Icon,
  PaperPlaneTilt,
  SquaresFour,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  type DraftNotice,
  type DraftSection,
  type FormDraft,
  blankQuestion,
  checkDraft,
  forgetDraft,
  loadDraft,
  newKey,
  peekDraft,
  problemDomId,
  problemPlace,
  savedDraft,
  toRequest,
  updateDraft,
  useDraft,
} from './builder-draft';
import {
  type BuilderState,
  type BuilderTab,
  BuilderCard,
  CardFrame,
  INTAKE_FORMS,
  NOT_LOADED,
} from './builder-parts';
import { FormLinkDialog, isMainForm } from '../../_components/form-link-dialog';
import { FormDetailsCard } from './form-details';
import { MoreMenu } from './more-menu';
import { AddQuestionsCard, FormSettingsCard } from './question-palette';
import { NEW_LABEL } from './question-types';

const TABS: { id: BuilderTab; label: string; path: string; icon: Icon }[] = [
  { id: 'builder', label: 'Form Builder', path: '', icon: SquaresFour },
  { id: 'preview', label: 'Preview', path: '/preview', icon: Eye },
  { id: 'logic', label: 'Logic & Rules', path: '/logic', icon: Graph },
];
const tabPath = (tab: BuilderTab) => TABS.find((t) => t.id === tab)?.path ?? '';

const GONE = 'This form no longer exists. Go back to Intake Forms and open it again.';
/** Why the form did not load; a malformed id in the address is the same as a missing form. */
const LOAD_ERRORS: Record<string, string> = {
  NOT_FOUND: GONE,
  FORM_NOT_FOUND: GONE,
  VALIDATION_FAILED: GONE,
  FORBIDDEN: 'Only people who manage intake forms can open the builder.',
};
const SAVE_ERRORS: Record<string, string> = {
  FORM_PUBLISHED: 'This version was published in the meantime. Save again to keep your changes.',
  FORM_INCOMPLETE:
    'The form can’t be published yet: every section needs a question, every question a label, and a multiple-choice question at least two choices.',
  NOT_FOUND: GONE,
  FORM_NOT_FOUND: GONE,
  FORBIDDEN: 'Only people who manage intake forms can change them.',
};

type SaveMode = 'draft' | 'publish' | 'template' | 'send';
const publishes = (mode: SaveMode) => mode === 'publish' || mode === 'send';

/** The line under the title after a save that went through (`fromPublished`: a new version). */
function doneText(mode: SaveMode, fromPublished: boolean, template: boolean) {
  if (mode === 'draft') {
    return fromPublished
      ? 'Saved as a new draft. The published form is unchanged.'
      : 'Draft saved.';
  }
  if (mode === 'template') {
    return template ? 'Template saved.' : 'Saved. A template copy is in Form Templates.';
  }
  if (mode === 'send') return 'Form published. Opening Send Intake Form…';
  return fromPublished
    ? 'Published as a new version. Forms already sent keep the earlier one.'
    : 'Form published. It can now be sent.';
}

/** What a save did: `stored` is false when the new copy was made but saving into it failed. */
interface SaveResult {
  form: IntakeFormDetail;
  stored: boolean;
  failed: unknown;
}

/** The breadcrumb's short name for each title (the design: "Intake Forms > Create New Form"). */
const CRUMBS: Record<string, string> = {
  'Create New Intake Form': 'Create New Form',
  'Edit Intake Form': 'Edit Form',
};

/** "Intake Forms > Create New Form" over the title. */
function Breadcrumb({ title }: { title: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-text">
      <Link href="/intake-forms" className="hover:text-action hover:underline">
        Intake Forms
      </Link>
      <CaretRight aria-hidden weight="bold" className="size-3" />
      <span aria-current="page" className="font-semibold text-heading">
        {CRUMBS[title] ?? title}
      </span>
    </nav>
  );
}

/** Save as Draft and Preview: white, blue border, navy text (the kit's outline is blue text). */
const OUTLINED =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 py-2 text-sm font-semibold text-heading hover:bg-info-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:hover:bg-surface';

/** The last card of a column on wide screens: it grows to the bottom of the row. */
const GROW = 'xl:flex-1';

/**
 * The problems a save or publish found, each with where it is (Octavia's review, I3: "Check the
 * highlighted items" with nothing highlighted). On the Form Builder tab each one opens its section
 * and brings the row into view; on the other tabs it goes to the Form Builder tab.
 */
function ProblemList({
  draft,
  errors,
  publishing,
  onBuilderTab,
  formId,
  onShow,
}: {
  draft: FormDraft;
  errors: Record<string, string>;
  publishing: boolean;
  onBuilderTab: boolean;
  formId: string;
  onShow: (sectionKey: string | null) => void;
}) {
  const items = Object.entries(errors).map(([key, message]) => ({
    key,
    message,
    ...problemPlace(draft, key),
  }));
  const show = (key: string, sectionKey: string | null) => {
    onShow(sectionKey);
    revealProblem(key);
  };
  const shown = items.slice(0, MAX_LISTED);
  return (
    <span className="flex flex-col gap-1 text-danger" data-testid="builder-problems">
      <span className="font-semibold">
        {publishing ? 'Fix these to publish' : 'Fix these to save'} ({items.length}):
      </span>
      <span className="flex flex-col">
        {shown.map((item) => (
          <span key={item.key}>
            {onBuilderTab ? (
              <button
                type="button"
                className="text-left underline"
                onClick={() => show(item.key, item.sectionKey)}
              >
                {item.label}
              </button>
            ) : (
              <Link href={`/intake-forms/builder/${formId}`} className="underline">
                {item.label}
              </Link>
            )}
            : {item.message}
          </span>
        ))}
        {items.length > shown.length ? (
          <span>and {items.length - shown.length} more, shown on their sections.</span>
        ) : null}
      </span>
    </span>
  );
}

/** The most problems the status line lists; the rest show on their sections. */
const MAX_LISTED = 6;

/**
 * After the section opens (the next frame): the problem's row, or else the first invalid field,
 * comes into view and takes focus.
 */
function revealProblem(key: string | undefined) {
  requestAnimationFrame(() => {
    const row =
      (key ? document.getElementById(problemDomId(key)) : null) ??
      document.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!row.matches('input, select, textarea, button')) row.setAttribute('tabindex', '-1');
    row.focus({ preventScroll: true });
  });
}

/** Form Builder, Preview and Logic & Rules: three tab blocks of links (each tab is a route). */
function BuilderTabs({ id, tab }: { id: string; tab: BuilderTab }) {
  return (
    <nav aria-label="Build Your Form" className="grid grid-cols-3 gap-1">
      {TABS.map((t) => {
        const on = t.id === tab;
        const Glyph = t.icon;
        return (
          <Link
            key={t.id}
            href={`/intake-forms/builder/${id}${t.path}`}
            aria-current={on ? 'page' : undefined}
            className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg border-b-3 px-2 text-center text-sm font-semibold ${on ? 'border-action bg-info-soft text-action' : 'border-transparent bg-canvas text-heading hover:text-action'}`}
          >
            <Glyph
              aria-hidden
              weight="fill"
              className={`hidden size-5 shrink-0 sm:block ${on ? 'text-action' : 'text-heading'}`}
            />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Intake Forms > Create New Intake Form (create-new-intake-form.jpg, guide Frame 1): the
 * breadcrumb and title with Save as Draft, Preview and Publish Form (they stay on screen while
 * scrolling), then 1. Form Details, 2. Build Your Form with its three tabs (`tab` and
 * `children`), and 3. Add Questions and 4. Form Settings. The unsaved draft is shared by the three
 * tabs. Saving a published form keeps it as it is and saves a new draft copy (sent forms keep
 * the version they were sent with); the screen then moves to the copy.
 */
export function BuilderFrame({
  formId,
  tab,
  children,
}: {
  formId: string;
  tab: BuilderTab;
  children: (state: BuilderState) => ReactNode;
}) {
  const router = useRouter();
  const form = useApiQuery([...INTAKE_FORMS, 'form', formId], () => api.intakeForms.form(formId));
  const held = useDraft(formId);
  // null until the first save: then the draft is checked as it changes (true: as for publishing).
  const [checking, setChecking] = useState<boolean | null>(null);
  const [active, setActive] = useState<string | null>(null);
  // Saved, and on the way to the new copy or to Send: the notice shows and nothing is clickable.
  const [leaving, setLeaving] = useState<{ from: string; notice: DraftNotice } | null>(null);
  const moving = leaving?.from === formId ? leaving.notice : null;
  const [linking, setLinking] = useState(false);

  const data = form.data;
  const draft = held?.draft ?? null;
  useEffect(() => {
    if (data) loadDraft(formId, data);
  }, [formId, data]);
  // A draft copy saved from a published form: the published form's stale entry goes.
  const replaces = held?.replaces;
  useEffect(() => {
    if (replaces) forgetDraft(replaces);
  }, [replaces]);

  const save = useApiMutation(
    async ({ mode, body }: { mode: SaveMode; body: FormDraft }): Promise<SaveResult> => {
      if (!data) throw new Error('The form has not loaded');
      // A published version is frozen: the API saves the changes as the form's next draft
      // version, and the published one stays live (sent forms keep theirs). So the main form
      // stays its service's main form, with the same link. An archived form's go to a copy.
      const target =
        data.status === 'RETIRED'
          ? await api.intakeForms.duplicateForm(data.id, body.isTemplate)
          : data;
      let saved: IntakeFormDetail;
      try {
        saved = await api.intakeForms.saveForm(target.id, toRequest(body));
      } catch (failed) {
        if (target.id === data.id) throw failed;
        return { form: target, stored: false, failed };
      }
      try {
        if (publishes(mode)) saved = await api.intakeForms.publishForm(saved.id);
        else if (mode === 'template' && !saved.isTemplate) {
          await api.intakeForms.duplicateForm(saved.id, true);
        }
        return { form: saved, stored: true, failed: null };
      } catch (failed) {
        return { form: saved, stored: true, failed };
      }
    },
    { invalidate: INTAKE_FORMS },
  );

  const update = (change: (d: FormDraft) => FormDraft) => {
    updateDraft(formId, change);
    if (save.isError) save.reset();
  };

  const run = (mode: SaveMode) => {
    if (!draft || !data || save.isPending) return;
    setChecking(publishes(mode));
    const found = Object.keys(checkDraft(draft, publishes(mode)));
    if (found.length) {
      // The first problem's section opens on the next render; then it comes into view.
      const first = found[0];
      const place = first ? problemPlace(draft, first) : null;
      if (place?.sectionKey) setActive(place.sectionKey);
      if (tab === 'builder') requestAnimationFrame(() => revealProblem(first));
      return;
    }
    save.mutate(
      { mode, body: draft },
      {
        onSuccess: ({ form: saved, stored, failed }) => {
          const moved = saved.id !== formId;
          // Work done while the save ran, or work a failed save into the copy did not store,
          // stays as unsaved changes.
          const now = peekDraft(formId);
          const edited = stored ? (now && now !== draft ? now : null) : (now ?? draft);
          const why = failed ? errorMessage(failed, SAVE_ERRORS) : '';
          const text = !failed
            ? doneText(mode, data.status !== 'DRAFT', saved.isTemplate)
            : !stored
              ? `A draft copy was made, but your changes are not in it yet. ${why}`
              : publishes(mode)
                ? `Saved as a draft, but not published. ${why}`
                : `Saved, but the template copy was not made. ${why}`;
          const notice: DraftNotice = { text, tone: failed ? 'danger' : 'success' };
          savedDraft(saved.id, saved, draft.start, { edited, notice, replaces: formId });
          setChecking(null);
          const sending = mode === 'send' && !failed;
          if (sending || moved) setLeaving({ from: formId, notice });
          if (sending) router.push(`/intake-forms/send?formId=${saved.id}`);
          else if (moved) router.replace(`/intake-forms/builder/${saved.id}${tabPath(tab)}`);
          // Published: the main form's link and embed code, to copy (Octavia's I3).
          else if (mode === 'publish' && !failed && isMainForm(saved)) setLinking(true);
        },
        onError: (error) => {
          // Published elsewhere in the meantime: reload it, so the next save makes a copy.
          if (error instanceof ApiRequestError && error.code === 'FORM_PUBLISHED') {
            void form.refetch();
          }
        },
      },
    );
  };

  const addSection = () => {
    const key = newKey('s');
    update((d) => ({
      ...d,
      sections: [
        ...d.sections,
        { key, title: `Section ${d.sections.length + 1}`, description: '', questions: [] },
      ],
    }));
    setActive(key);
  };
  const addQuestion = (type: QuestionType, sectionKey?: string) => {
    if (!draft) return;
    const question = blankQuestion(type, NEW_LABEL[type]);
    // The asked-for section, else the chosen one, else the last; a removed or replaced section's
    // key never swallows the question.
    const target =
      [sectionKey, active].find((k) => k && draft.sections.some((s) => s.key === k)) ??
      draft.sections.at(-1)?.key;
    if (!target) {
      const first: DraftSection = {
        key: newKey('s'),
        title: 'Section 1',
        description: '',
        questions: [question],
      };
      update((d) => ({ ...d, sections: [first] }));
      setActive(first.key);
      return;
    }
    update((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.key === target ? { ...s, questions: [...s.questions, question] } : s,
      ),
    }));
    setActive(target);
  };

  const errors = useMemo(
    () => (draft && checking !== null ? checkDraft(draft, checking) : {}),
    [draft, checking],
  );
  const isTemplate = draft?.isTemplate ?? data?.isTemplate ?? false;
  const published = Boolean(data && data.status !== 'DRAFT');
  // A draft over a published version is still an edit: only a published form gets version 2 on.
  const editing = published || (data?.version ?? 1) > 1;
  const title = editing
    ? isTemplate
      ? 'Edit Form Template'
      : 'Edit Intake Form'
    : isTemplate
      ? 'Create Form Template'
      : 'Create New Intake Form';
  // The form has arrived but is not in the draft store yet (one render): still loading.
  const loading = form.isPending || (Boolean(data) && !held);
  const failed = form.isError && !data ? errorMessage(form.error, LOAD_ERRORS) : '';
  const state: BuilderState | null =
    draft && data
      ? {
          id: formId,
          form: data,
          draft,
          update,
          errors,
          active,
          setActive,
          addQuestion,
          addSection,
        }
      : null;
  const busy = save.isPending || Boolean(moving);
  const busyMode = save.isPending ? save.variables?.mode : undefined;
  const saveError = save.error ? errorMessage(save.error, SAVE_ERRORS) : '';
  const problems = Object.keys(errors).length;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1 bg-canvas pb-1 md:sticky md:top-0 md:z-20 md:-mt-4 md:pt-4">
        {/* Not the kit's PageHeader: its title block does not shrink, so at 1440 px the buttons
            drop under the subtitle; the design has them beside the title. */}
        <header className="flex flex-col gap-2">
          <Breadcrumb title={title} />
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-bold text-heading">{title}</h1>
              <p className="text-base text-text">
                Build a customized intake form for your clients. Add questions, organize into
                sections, and set preferences.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 xl:shrink-0">
              <button
                type="button"
                className={OUTLINED}
                disabled={!state || busy}
                onClick={() => run('draft')}
              >
                {busyMode === 'draft' ? 'Saving…' : 'Save as Draft'}
              </button>
              <Link
                href={`/intake-forms/builder/${formId}/preview`}
                className={`${OUTLINED} min-w-32`}
              >
                <Eye aria-hidden weight="fill" className="size-5 text-action" />
                Preview
              </Link>
              <Button
                type="button"
                className="min-w-40"
                disabled={!state || busy}
                onClick={() => run('publish')}
              >
                <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
                {busyMode === 'publish' || busyMode === 'send' ? 'Publishing…' : 'Publish Form'}
              </Button>
              <MoreMenu
                framed
                label="More save options"
                items={[
                  {
                    label: busyMode === 'template' ? 'Saving…' : 'Save as Template',
                    disabled: !state || busy,
                    onSelect: () => run('template'),
                  },
                  { label: 'Save & Send', disabled: !state || busy, onSelect: () => run('send') },
                  ...(data && isMainForm(data)
                    ? [{ label: 'Form Link', onSelect: () => setLinking(true) }]
                    : []),
                ]}
              />
            </div>
          </div>
        </header>
        <p aria-live="polite" data-testid="builder-status" className="min-h-5 text-sm">
          {failed ? (
            <span className="text-muted">{failed}</span>
          ) : moving ? (
            <span className={moving.tone === 'danger' ? 'text-danger' : 'text-success'}>
              {moving.text}
            </span>
          ) : saveError ? (
            <span className="text-danger">{saveError}</span>
          ) : problems && draft ? (
            <ProblemList
              draft={draft}
              errors={errors}
              publishing={checking === true}
              onBuilderTab={tab === 'builder'}
              formId={formId}
              onShow={(sectionKey) => sectionKey && setActive(sectionKey)}
            />
          ) : held?.notice ? (
            <span className={held.notice.tone === 'danger' ? 'text-danger' : 'text-success'}>
              {held.notice.text}
            </span>
          ) : held?.dirty ? (
            <span className="text-muted">Unsaved changes</span>
          ) : published ? (
            <span className="text-muted">
              This version is published. Forms already sent keep it; saving makes a new draft copy.
            </span>
          ) : null}
        </p>
      </div>

      {/* Wide screens: the three columns end level, as in the design (the last card of each
          column grows to the bottom). */}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 xl:flex xl:items-stretch">
        <div className="min-w-0 xl:flex xl:flex-9 xl:flex-col">
          {state ? (
            <FormDetailsCard state={state} className={GROW} />
          ) : (
            <CardFrame title="1. Form Details" loading={loading} className={GROW} />
          )}
        </div>
        <div className="min-w-0 xl:flex xl:flex-14 xl:flex-col">
          <BuilderCard title="2. Build Your Form" testId="build-your-form" className={GROW}>
            <BuilderTabs id={formId} tab={tab} />
            {state ? (
              children(state)
            ) : loading ? (
              <div aria-busy="true" className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
                {['first', 'second', 'third', 'fourth'].map((row) => (
                  <Skeleton key={row} className="h-16" />
                ))}
              </div>
            ) : (
              <p className="rounded-lg bg-canvas p-3 text-sm text-muted">{NOT_LOADED}</p>
            )}
          </BuilderCard>
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-2 lg:grid lg:grid-cols-2 lg:items-start xl:flex xl:flex-10 xl:flex-col xl:items-stretch">
          <AddQuestionsCard state={state} />
          {state ? (
            <FormSettingsCard state={state} className={GROW} />
          ) : (
            <CardFrame title="4. Form Settings" loading={loading} className={GROW} />
          )}
        </div>
      </div>
      {linking && data ? (
        <FormLinkDialog
          formId={formId}
          name={draft?.name || data.name}
          onClose={() => setLinking(false)}
        />
      ) : null}
    </div>
  );
}
