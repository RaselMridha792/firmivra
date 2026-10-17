'use client';

import type { SaveServiceCategoryRequest, ServiceCategory } from '@firmivra/types';
import { Badge, Button, Input, Modal, Select, Textarea, Toast } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowUp,
  Archive,
  ArrowsMerge,
  FolderOpen,
  PencilSimple,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { CatalogFrame } from './catalog-frame';

const KEY = ['services-pricing'] as const;
const CATEGORIES = [...KEY, 'categories'];
const TONES = [
  { value: 'info', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'success', label: 'Green' },
  { value: 'warning', label: 'Amber' },
  { value: 'danger', label: 'Red' },
  { value: 'neutral', label: 'Grey' },
] as const;
const ICONS = [
  { value: '', label: 'No icon' },
  { value: 'user', label: 'Person' },
  { value: 'briefcase', label: 'Briefcase' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'chart-bar', label: 'Chart' },
  { value: 'users-three', label: 'People' },
  { value: 'money', label: 'Money' },
  { value: 'book', label: 'Book' },
  { value: 'file-text', label: 'Document' },
  { value: 'shield', label: 'Shield' },
  { value: 'buildings', label: 'Buildings' },
];
/** The API's own codes, in the firm's words. */
const ERRORS = {
  DUPLICATE_NAME: 'A category with this name already exists.',
  IN_USE: 'Move or merge its services first.',
};
const toneBadge = (tone: string | null | undefined) =>
  (['info', 'purple', 'success', 'warning', 'danger', 'neutral'] as const).find(
    (t) => t === tone,
  ) ?? 'neutral';

type Dialog =
  | { kind: 'edit'; category: ServiceCategory | null }
  | { kind: 'merge'; category: ServiceCategory }
  | { kind: 'delete'; category: ServiceCategory };

/** /services-pricing/categories: create, rename, reorder, merge, deactivate and delete categories. */
export function CategoriesScreen() {
  const list = useApiQuery(CATEGORIES, () => api.servicesPricing.categories());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const rows = [...(list.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const options = { invalidate: [...KEY] };
  const notify = (text: string, tone: 'success' | 'error' = 'success') =>
    setMessage({ text, tone });
  const fail = (error: unknown) => notify(errorMessage(error, ERRORS), 'error');
  const reorder = useApiMutation(
    (ids: string[]) => api.servicesPricing.reorderCategories({ ids }),
    options,
  );
  const setStatus = useApiMutation(
    (input: { category: ServiceCategory; status: 'ACTIVE' | 'INACTIVE' }) =>
      api.servicesPricing.updateCategory(input.category.id, {
        name: input.category.name,
        description: input.category.description ?? '',
        icon: input.category.icon,
        tone: toneBadge(input.category.tone),
        status: input.status,
      }),
    options,
  );
  const move = (index: number, step: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    const target = index + step;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    reorder.mutate(ids, { onError: fail });
  };
  const state = list.isPending
    ? 'Loading…'
    : list.isError
      ? 'Categories are not available right now.'
      : 'No categories yet. Add the first one to group your services.';

  return (
    <CatalogFrame tab="categories">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <section
        aria-label="Service categories"
        className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
        data-testid="categories-card"
      >
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-full bg-warning-soft text-gold"
            >
              <FolderOpen weight="fill" className="size-6" />
            </span>
            <div>
              <h2 className="font-display text-xl font-bold text-heading">Service Categories</h2>
              <p className="text-sm text-muted">
                Group your services. A category with services cannot be deleted: merge or deactivate
                it.
              </p>
            </div>
          </div>
          <Button onClick={() => setDialog({ kind: 'edit', category: null })}>
            <Plus aria-hidden weight="bold" className="size-4" /> Add Category
          </Button>
        </header>
        {rows.length === 0 ? (
          <p className="rounded-lg bg-canvas p-8 text-center text-sm text-muted">{state}</p>
        ) : (
          <div className="relative overflow-x-auto rounded-lg border border-divider">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Service categories in display order</caption>
              <thead className="bg-table-head text-heading">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 font-semibold">Services</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody data-testid="category-rows">
                {rows.map((c, i) => (
                  <tr key={c.id} className="border-t border-divider">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Move ${c.name} up`}
                          disabled={i === 0 || reorder.isPending}
                          onClick={() => move(i, -1)}
                          className="flex size-8 items-center justify-center rounded-lg border border-divider text-heading hover:bg-canvas disabled:opacity-40"
                        >
                          <ArrowUp aria-hidden weight="bold" className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${c.name} down`}
                          disabled={i === rows.length - 1 || reorder.isPending}
                          onClick={() => move(i, 1)}
                          className="flex size-8 items-center justify-center rounded-lg border border-divider text-heading hover:bg-canvas disabled:opacity-40"
                        >
                          <ArrowDown aria-hidden weight="bold" className="size-4" />
                        </button>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={toneBadge(c.tone)}>
                        <span data-testid="category-name">{c.name}</span>
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text">{c.description ?? '—'}</td>
                    <td className="px-4 py-3 text-heading">{c.serviceCount}</td>
                    <td className="px-4 py-3">
                      <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {c.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: 'edit', category: c })}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-info-soft px-3 text-sm font-semibold text-action"
                        >
                          <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
                          <span className="sr-only"> {c.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setStatus.mutate(
                              {
                                category: c,
                                status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                              },
                              {
                                onSuccess: () =>
                                  notify(
                                    c.status === 'ACTIVE'
                                      ? `${c.name} deactivated.`
                                      : `${c.name} activated.`,
                                  ),
                                onError: fail,
                              },
                            )
                          }
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-divider px-3 text-sm font-medium text-heading hover:bg-canvas"
                        >
                          <Archive aria-hidden weight="fill" className="size-4" />
                          {c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          <span className="sr-only"> {c.name}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Merge ${c.name}`}
                          title="Merge into another category"
                          onClick={() => setDialog({ kind: 'merge', category: c })}
                          className="flex size-9 items-center justify-center rounded-lg border border-divider text-heading hover:bg-canvas"
                        >
                          <ArrowsMerge aria-hidden weight="fill" className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${c.name}`}
                          title="Delete"
                          onClick={() => setDialog({ kind: 'delete', category: c })}
                          className="flex size-9 items-center justify-center rounded-lg border border-divider text-danger hover:bg-canvas"
                        >
                          <Trash aria-hidden weight="fill" className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {dialog?.kind === 'edit' ? (
        <EditDialog
          category={dialog.category}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            notify(text);
          }}
        />
      ) : null}
      {dialog?.kind === 'merge' ? (
        <MergeDialog
          category={dialog.category}
          others={rows.filter((r) => r.id !== dialog.category.id && r.status === 'ACTIVE')}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            notify(text);
          }}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeleteDialog
          category={dialog.category}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            notify(text);
          }}
        />
      ) : null}
    </CatalogFrame>
  );
}

function EditDialog({
  category,
  onClose,
  onDone,
}: {
  category: ServiceCategory | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [tone, setTone] = useState(toneBadge(category?.tone));
  const [icon, setIcon] = useState(category?.icon ?? '');
  const save = useApiMutation(
    () => {
      const body: SaveServiceCategoryRequest = {
        name: name.trim(),
        description,
        tone,
        icon: icon || null,
        ...(category ? { status: category.status } : {}),
      };
      return category
        ? api.servicesPricing.updateCategory(category.id, body)
        : api.servicesPricing.createCategory(body);
    },
    { invalidate: [...KEY] },
  );
  return (
    <Modal
      open
      title={category ? 'Edit Category' : 'Add Category'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => onDone(category ? 'Category saved.' : 'Category added.'),
              })
            }
          >
            {category ? 'Save Category' : 'Add Category'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Category name"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
        />
        <Textarea
          label="Description (optional)"
          rows={2}
          maxLength={300}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Colour"
            value={tone}
            onChange={(event) => setTone(event.target.value as typeof tone)}
            options={TONES.map((t) => ({ value: t.value, label: t.label }))}
          />
          <Select
            label="Icon (optional)"
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
            options={ICONS}
          />
        </div>
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function MergeDialog({
  category,
  others,
  onClose,
  onDone,
}: {
  category: ServiceCategory;
  others: ServiceCategory[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [into, setInto] = useState('');
  const merge = useApiMutation(
    () => api.servicesPricing.mergeCategory(category.id, { intoId: into }),
    {
      invalidate: [...KEY],
    },
  );
  return (
    <Modal
      open
      title={`Merge ${category.name}`}
      subtitle="Every service in it moves to the category you choose. This category is then deactivated."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!into || merge.isPending}
            onClick={() =>
              merge.mutate(undefined, { onSuccess: () => onDone(`${category.name} merged.`) })
            }
          >
            Merge Category
          </Button>
        </>
      }
    >
      <Select
        label="Move its services into"
        value={into}
        onChange={(event) => setInto(event.target.value)}
        options={[
          { value: '', label: others.length ? 'Choose a category…' : 'No other active category' },
          ...others.map((o) => ({ value: o.id, label: o.name })),
        ]}
      />
      {merge.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(merge.error, ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}

function DeleteDialog({
  category,
  onClose,
  onDone,
}: {
  category: ServiceCategory;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const remove = useApiMutation(() => api.servicesPricing.deleteCategory(category.id), {
    invalidate: [...KEY],
  });
  return (
    <Modal
      open
      title={`Delete ${category.name}?`}
      subtitle={
        category.serviceCount > 0
          ? `${category.serviceCount} service(s) use it. Merge or deactivate it instead.`
          : 'No service uses it. This cannot be undone.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(undefined, { onSuccess: () => onDone(`${category.name} deleted.`) })
            }
          >
            Delete Category
          </Button>
        </>
      }
    >
      {remove.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(remove.error, ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
