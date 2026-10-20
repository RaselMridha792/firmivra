'use client';

import type { AutomationTemplateRow } from '@firmivra/types';
import { type Column, Select, Table, Toast } from '@firmivra/ui';
import { ArrowLeft, Copy, DownloadSimple, Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { ImportDialog } from './automation-dialogs';
import {
  AUTOMATIONS_KEY,
  AUTOMATION_ERRORS,
  MODULE_ICON,
  card,
  dayText,
  outlined,
  subtle,
} from './automations-shared';

/** /automations/templates: reusable rules: use, export, import, archive. */
export function TemplatesScreen() {
  const router = useRouter();
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [exported, setExported] = useState<string>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const catalog = useApiQuery([...AUTOMATIONS_KEY, 'catalog'], () => api.automations.catalog());
  const list = useApiQuery([...AUTOMATIONS_KEY, 'templates', category, archived, page], () =>
    api.automations.templates({
      ...(category ? { category: category as 'CLIENTS' } : {}),
      includeArchived: archived,
      page,
      pageSize: 10,
    }),
  );
  const options = { invalidate: [...AUTOMATIONS_KEY] };
  const fail = (e: unknown) => notice(errorMessage(e, AUTOMATION_ERRORS), 'error');
  const use = useApiMutation((id: string) => api.automations.useTemplate(id), options);
  const archive = useApiMutation(
    (t: AutomationTemplateRow) =>
      t.archived ? api.automations.restoreTemplate(t.id) : api.automations.archiveTemplate(t.id),
    options,
  );
  const exportOne = useApiMutation((id: string) => api.automations.exportTemplate(id), {});
  const starters = useApiMutation(() => api.automations.installStarters(), options);
  const columns: Column<AutomationTemplateRow>[] = [
    {
      id: 'name',
      label: 'Template',
      cell: (t) => {
        const Glyph = MODULE_ICON[t.category];
        return (
          <span className="flex min-w-48 items-start gap-2">
            <Glyph aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0 text-action" />
            <span>
              <span className="block font-medium text-heading">
                {t.name}
                {t.archived ? ' (archived)' : ''}
              </span>
              {t.description ? (
                <span className="block text-xs text-muted">{t.description}</span>
              ) : null}
            </span>
          </span>
        );
      },
    },
    { id: 'trigger', label: 'Trigger', cell: (t) => t.triggerSummary },
    { id: 'actions', label: 'Actions', cell: (t) => t.actionsSummary },
    { id: 'updated', label: 'Updated', cell: (t) => dayText(t.updatedAt) },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="automation-templates">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/automations" aria-label="Back to Automation" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/automations" className="text-link">
          Automation
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Templates</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
            Automation Templates
          </h1>
          <p className="text-base text-muted">Set up common workflows in a few clicks.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={outlined} onClick={() => setImporting(true)}>
            <DownloadSimple aria-hidden weight="bold" className="size-4" /> Import Template
          </button>
          <button
            type="button"
            className={outlined}
            disabled={starters.isPending}
            onClick={() =>
              starters.mutate(undefined, {
                onSuccess: (r) =>
                  notice(`${r.alreadyThere} starter templates are in place.`, 'success'),
                onError: fail,
              })
            }
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Install starter templates
          </button>
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <section className={card} aria-label="Templates">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-52">
            <Select
              label="Category"
              hideLabel
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All categories' },
                ...(catalog.data?.modules ?? []).map((m) => ({ value: m.module, label: m.label })),
              ]}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked);
                setPage(1);
              }}
            />{' '}
            Show archived
          </label>
        </div>
        <div className="relative" data-testid="template-table">
          <Table
            rows={list.data?.items ?? []}
            columns={columns}
            rowKey={(t) => t.id}
            caption="Automation templates"
            dense
            noun="templates"
            pageSize={10}
            loading={list.isPending}
            emptyTitle={list.isError ? 'Templates are not available' : 'No templates'}
            emptyText={
              list.isError
                ? 'We could not load the templates. Try again in a moment.'
                : 'Install the starter templates, or save a rule as a template.'
            }
            rowActions={(t) => (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-control border border-action px-3 py-1 text-xs font-medium text-action hover:bg-accent-soft disabled:opacity-50"
                  disabled={t.archived || use.isPending || t.integrationsMissing.length > 0}
                  aria-label={`Use template ${t.name}`}
                  onClick={() =>
                    use.mutate(t.id, {
                      onSuccess: (r) => router.push(`/automations/${r.id}/edit`),
                      onError: fail,
                    })
                  }
                >
                  Use Template
                </button>
                <button
                  type="button"
                  aria-label={`Export ${t.name}`}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-heading hover:bg-canvas"
                  onClick={() =>
                    exportOne.mutate(t.id, {
                      onSuccess: (x) => setExported(JSON.stringify(x, null, 2)),
                      onError: fail,
                    })
                  }
                >
                  <Copy aria-hidden weight="fill" className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`${t.archived ? 'Restore' : 'Archive'} ${t.name}`}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-danger hover:bg-canvas"
                  onClick={() => archive.mutate(t, { onError: fail })}
                >
                  <Trash aria-hidden weight="fill" className="size-4" />
                </button>
              </span>
            )}
            server={{
              page: list.data?.page ?? 1,
              total: list.data?.total ?? 0,
              hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
              hasPrevious: (list.data?.page ?? 1) > 1,
              onNext: () => setPage(page + 1),
              onPrevious: () => setPage(Math.max(1, page - 1)),
              onPage: (n: number) => setPage(n),
              onSort: () => undefined,
            }}
          />
        </div>
      </section>
      {exported ? (
        <section className={card} aria-label="Exported template" data-testid="exported">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Exported template</h2>
          <p className="mb-2 text-sm text-text">
            Copy this text and paste it into Import Template on another Firmivra account.
          </p>
          <pre className="max-h-64 overflow-auto rounded-lg bg-canvas p-3 text-xs text-heading">
            {exported}
          </pre>
          <button type="button" className={`${subtle} mt-2`} onClick={() => setExported(undefined)}>
            Close
          </button>
        </section>
      ) : null}
      {importing ? (
        <ImportDialog
          onClose={() => setImporting(false)}
          onDone={(name) => {
            setImporting(false);
            notice(`${name} imported.`, 'success');
          }}
        />
      ) : null}
    </div>
  );
}
