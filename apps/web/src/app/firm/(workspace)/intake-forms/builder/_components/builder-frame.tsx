'use client';

import { ApiRequestError, type QuestionType } from '@firmivra/types';
import { ActionMenu, Button, Callout, PageHeader } from '@firmivra/ui';
import {
  CaretRight,
  DotsThreeVertical,
  Eye,
  FloppyDisk,
  GridFour,
  Info,
  PaperPlaneRight,
  TreeStructure,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, createElement, useEffect, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  type DraftSection,
  type FormDraft,
  blankQuestion,
  checkDraft,
  loadDraft,
  newKey,
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
import { FormDetailsCard } from './form-details';
import { AddQuestionsCard, FormSettingsCard } from './question-palette';
import { NEW_LABEL } from './question-types';

const TABS: { id: BuilderTab; label: string; path: string; icon: typeof Eye }[] = [
  { id: 'builder', label: 'Form Builder', path: '', icon: GridFour },
  { id: 'preview', label: 'Preview', path: '/preview', icon: Eye },
  { id: 'logic', label: 'Logic & Rules', path: '/logic', icon: TreeStructure },
];

const ERRORS: Record<string, string> = {
  FORM_PUBLISHED: 'This version is published. Save again to keep your changes as a new draft.',
  FORM_NOT_FOUND: 'This form no longer exists. Go back to Intake Forms and open it again.',
  NOT_FOUND: 'This form no longer exists. Go back to Intake Forms and open it again.',
  FORBIDDEN: 'Only people who manage intake forms can change them.',
};

type SaveMode = 'draft' | 'publish' | 'template' | 'send';
const DONE: Record<SaveMode, string> = {
  draft: 'Draft saved.',
  publish: 'Form published. It can now be sent.',
  template: 'Saved as a template. It is in Form Templates.',
  send: 'Saved. Opening Send Intake Form…',
};

/** "Intake Forms > Create New Intake Form" over the title. */
function Breadcrumb({ title }: { title: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted">
      <Link href="/intake-forms" className="hover:text-action hover:underline">
        Intake Forms
      </Link>
      <CaretRight aria-hidden weight="bold" className="size-3" />
      <span aria-current="page" className="font-semibold text-heading">
        {title}
      </span>
    </nav>
  );
}

/** Form Builder, Preview and Logic & Rules: one tab bar of links (each tab is a route). */
function BuilderTabs({ id, tab }: { id: string; tab: BuilderTab }) {
  return (
    <nav
      aria-label="Build Your Form"
      className="grid grid-cols-3 overflow-hidden rounded-lg bg-canvas"
    >
      {TABS.map((t) => {
        const on = t.id === tab;
        return (
          <Link
            key={t.id}
            href={`/intake-forms/builder/${id}${t.path}`}
            aria-current={on ? 'page' : undefined}
            className={`flex min-h-12 items-center justify-center gap-2 border-b-3 px-2 text-sm font-semibold ${on ? 'border-action bg-surface text-action' : 'border-transparent text-heading hover:text-action'}`}
          >
            {createElement(t.icon, { 'aria-hidden': true, weight: 'fill', className: 'size-5' })}
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
 * the version they were sent with).
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState('');
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (form.data) loadDraft(formId, form.data);
  }, [formId, form.data]);

  const draft = held?.draft ?? null;
  const data = form.data;
  const update = (change: (d: FormDraft) => FormDraft) => {
    updateDraft(formId, change);
    setDone('');
  };

  const save = useApiMutation(
    async ({ mode, body }: { mode: SaveMode; body: FormDraft }) => {
      if (!data) throw new Error('not loaded');
      const request = toRequest(body);
      // A published or retired version is frozen: the changes go to a new draft copy.
      const target =
        data.status === 'DRAFT'
          ? data
          : await api.intakeForms.duplicateForm(formId, body.isTemplate);
      let saved = await api.intakeForms.saveForm(target.id, request);
      if (mode === 'publish') saved = await api.intakeForms.publishForm(saved.id);
      if (mode === 'template') await api.intakeForms.duplicateForm(saved.id, true);
      return saved;
    },
    { invalidate: INTAKE_FORMS },
  );

  const run = (mode: SaveMode) => {
    if (!draft) return;
    const found = checkDraft(draft, mode === 'publish');
    setErrors(found);
    setDone('');
    if (Object.keys(found).length) return;
    save.mutate(
      { mode, body: draft },
      {
        onSuccess: (saved) => {
          savedDraft(saved.id, saved, draft.start);
          const moved = saved.id !== formId;
          setDone(
            moved && mode === 'draft'
              ? 'Saved as a new draft. The published form is unchanged.'
              : DONE[mode],
          );
          if (mode === 'send') router.push(`/intake-forms/send?formId=${saved.id}`);
          else if (moved) router.replace(`/intake-forms/builder/${saved.id}${tabPath(tab)}`);
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
    const target = sectionKey ?? active ?? draft.sections.at(-1)?.key ?? null;
    if (!target) {
      const key = newKey('s');
      const first: DraftSection = {
        key,
        title: 'Section 1',
        description: '',
        questions: [question],
      };
      update((d) => ({ ...d, sections: [first] }));
      setActive(key);
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

  const isTemplate = draft?.isTemplate ?? data?.isTemplate ?? false;
  const title =
    data && data.status !== 'DRAFT'
      ? isTemplate
        ? 'Edit Form Template'
        : 'Edit Intake Form'
      : isTemplate
        ? 'Create Form Template'
        : 'Create New Intake Form';
  const loading = form.isPending;
  const failed = form.isError ? errorMessage(form.error, ERRORS) : '';
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
  const busy = save.isPending;
  const saveError = save.error
    ? save.error instanceof ApiRequestError && save.error.code === 'FORM_INCOMPLETE'
      ? save.error.message
      : errorMessage(save.error, ERRORS)
    : '';

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="sticky top-0 z-20 flex flex-col gap-2 bg-canvas pb-2">
        <PageHeader
          title={title}
          subtitle="Build a customized intake form for your clients. Add questions, organize into sections, and set preferences."
          above={<Breadcrumb title={title} />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-12 px-5 text-base"
                disabled={!state || busy}
                onClick={() => run('draft')}
              >
                <FloppyDisk aria-hidden weight="fill" className="size-5" />
                Save as Draft
              </Button>
              <Link
                href={`/intake-forms/builder/${formId}/preview`}
                className="inline-flex min-h-12 items-center gap-2 rounded-control border border-action bg-surface px-5 text-base font-medium text-action hover:bg-accent-soft"
              >
                <Eye aria-hidden weight="fill" className="size-5" />
                Preview
              </Link>
              <Button
                type="button"
                className="min-h-12 px-5 text-base"
                disabled={!state || busy}
                onClick={() => run('publish')}
              >
                <PaperPlaneRight aria-hidden weight="fill" className="size-5" />
                {busy ? 'Saving…' : 'Publish Form'}
              </Button>
              <ActionMenu
                label="More save options"
                align="right"
                trigger={
                  <span className="flex size-12 items-center justify-center rounded-control border border-divider bg-surface text-heading hover:bg-canvas">
                    <DotsThreeVertical aria-hidden weight="bold" className="size-5" />
                  </span>
                }
                sections={[
                  {
                    items: [
                      { label: 'Save as Template', onSelect: () => run('template') },
                      { label: 'Save & Send', onSelect: () => run('send') },
                    ],
                  },
                ]}
              />
            </div>
          }
        />
        <div aria-live="polite" data-testid="builder-status" className="min-h-5 text-sm">
          {saveError ? (
            <span className="text-danger">{saveError}</span>
          ) : Object.keys(errors).length ? (
            <span className="text-danger">
              {errors.form ?? 'Check the highlighted items, then save again.'}
            </span>
          ) : done ? (
            <span className="text-success">{done}</span>
          ) : held?.dirty ? (
            <span className="text-muted">Unsaved changes</span>
          ) : null}
        </div>
      </div>

      {failed ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          {failed}
        </Callout>
      ) : data && data.status !== 'DRAFT' ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          This form is published. Forms already sent keep this version; saving your changes makes a
          new draft copy.
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        {state ? (
          <FormDetailsCard state={state} />
        ) : (
          <CardFrame title="1. Form Details" loading={loading} />
        )}
        <BuilderCard title="2. Build Your Form" testId="build-your-form">
          <BuilderTabs id={formId} tab={tab} />
          {state ? (
            children(state)
          ) : loading ? (
            <div aria-busy="true" className="h-40 animate-pulse rounded-lg bg-subtle" />
          ) : (
            <p className="rounded-lg bg-subtle p-3 text-sm text-muted">{NOT_LOADED}</p>
          )}
        </BuilderCard>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2 lg:grid lg:grid-cols-2 min-[1440px]:col-span-1 min-[1440px]:flex">
          <AddQuestionsCard state={state} />
          {state ? (
            <FormSettingsCard state={state} />
          ) : (
            <CardFrame title="4. Form Settings" loading={loading} />
          )}
        </div>
      </div>
    </div>
  );
}

const tabPath = (tab: BuilderTab) => TABS.find((t) => t.id === tab)?.path ?? '';
