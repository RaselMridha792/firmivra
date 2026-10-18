'use client';

import {
  Badge,
  Button,
  Callout,
  Input,
  Modal,
  PageHeader,
  Radio,
  Select,
  Textarea,
  Toast,
} from '@firmivra/ui';
import { FlowArrow, Info, Kanban, Plus, SlidersHorizontal } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  adminSales,
  fieldErrors,
  type CreatePipeline,
  type SalesPipeline,
  type SavePipeline,
} from '../../../../../../../mocks/admin-sales';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { usePipelines } from '../../../_components/add-lead-panel';
import {
  Crumbs,
  FrameError,
  FrameState,
  Panel,
  SALES_KEY,
  useSalesMeta,
} from '../../../_components/sales-ui';
import { StageRow, type DraftStage } from './stage-row';

interface Removal {
  id: string;
  name: string;
  records: number;
  moveTo: string | null;
}

/** Create Pipeline: a name, a description and the stages it starts with. */
function CreatePipelineModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (pipeline: SalesPipeline) => void;
}) {
  const [form, setForm] = useState<CreatePipeline>({
    name: '',
    description: '',
    template: 'DEFAULT',
  });
  const create = useApiMutation((body: CreatePipeline) => adminSales.createPipeline(body), {
    invalidate: SALES_KEY,
  });
  const errors = fieldErrors(create.error);
  const general = create.error && !Object.keys(errors).length ? errorMessage(create.error) : null;
  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(form, { onSuccess: onCreated });
  }
  return (
    <Modal
      open
      title="Create Pipeline"
      subtitle="A new sales process, without code changes."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="sales-create-pipeline" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create Pipeline'}
          </Button>
        </>
      }
    >
      <form id="sales-create-pipeline" noValidate onSubmit={submit} className="flex flex-col gap-3">
        <Input
          label="Pipeline name"
          maxLength={60}
          value={form.name}
          error={errors['name']}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <Textarea
          label="Description"
          rows={2}
          maxLength={300}
          value={form.description}
          error={errors['description']}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
        <fieldset className="flex flex-col">
          <legend className="mb-1 text-sm font-medium text-text">Start with</legend>
          <Radio
            name="pipeline-template"
            label="The Firmivra lifecycle (ten stages, as the default pipeline)"
            checked={form.template === 'DEFAULT'}
            onChange={() => setForm({ ...form, template: 'DEFAULT' })}
          />
          <Radio
            name="pipeline-template"
            label="Three stages: New, Won and Lost"
            checked={form.template === 'BASIC'}
            onChange={() => setForm({ ...form, template: 'BASIC' })}
          />
        </fieldset>
        {general ? (
          <p role="alert" className="text-sm text-danger">
            {general}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

/** Removing a stage that holds records: they move to another stage first (delete protection). */
function RemoveStageModal({
  stage,
  records,
  targets,
  onClose,
  onConfirm,
}: {
  stage: DraftStage;
  records: number;
  targets: DraftStage[];
  onClose: () => void;
  onConfirm: (moveTo: string) => void;
}) {
  const [moveTo, setMoveTo] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      open
      title={`Remove ${stage.name || 'this stage'}`}
      subtitle={`It holds ${records} ${records === 1 ? 'record' : 'records'}. They move before the stage goes; their history stays.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!moveTo) {
                setError('Choose where the records go.');
                return;
              }
              onConfirm(moveTo);
            }}
          >
            Remove on save
          </Button>
        </>
      }
    >
      <Select
        label="Move its records to"
        value={moveTo}
        error={error || undefined}
        onChange={(event) => setMoveTo(event.target.value)}
        options={[
          { value: '', label: 'Choose a stage' },
          ...targets.map((target) => ({ value: target.id ?? target.key, label: target.name })),
        ]}
      />
    </Modal>
  );
}

const draftOf = (pipeline: SalesPipeline): DraftStage[] =>
  pipeline.stages.map((stage) => ({ ...stage, key: stage.id }));

/** The editor of one pipeline: its name, description and stages, saved together. */
function PipelineEditor({
  pipeline,
  onSaved,
}: {
  pipeline: SalesPipeline;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(pipeline.name);
  const [description, setDescription] = useState(pipeline.description);
  const [stages, setStages] = useState<DraftStage[]>(() => draftOf(pipeline));
  const [removed, setRemoved] = useState<Removal[]>([]);
  const [removing, setRemoving] = useState<DraftStage | null>(null);
  const save = useApiMutation((body: SavePipeline) => adminSales.savePipeline(body), {
    invalidate: SALES_KEY,
  });
  const errors = fieldErrors(save.error);
  const general = save.error && !Object.keys(errors).length ? errorMessage(save.error) : null;
  const recordsOf = (stage: DraftStage) => (stage.id ? (pipeline.recordCounts[stage.id] ?? 0) : 0);

  function update(index: number, next: DraftStage) {
    setStages(stages.map((stage, at) => (at === index ? next : stage)));
  }
  function moveStage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    setStages(next);
  }
  function remove(stage: DraftStage, moveTo: string | null) {
    setStages(stages.filter((item) => item.key !== stage.key));
    if (stage.id)
      setRemoved([
        ...removed,
        { id: stage.id, name: stage.name, records: recordsOf(stage), moveTo },
      ]);
    setRemoving(null);
  }
  function undo(removal: Removal) {
    const original = pipeline.stages.find((stage) => stage.id === removal.id);
    if (original) setStages([...stages, { ...original, key: original.id }]);
    setRemoved(removed.filter((item) => item.id !== removal.id));
  }
  function addStage() {
    setStages([
      ...stages,
      {
        key: `new-${crypto.randomUUID()}`,
        name: '',
        type: 'ACTIVE',
        tone: 'blue',
        active: true,
        requires: [],
        automation: 'NONE',
      },
    ]);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      {
        id: pipeline.id,
        name,
        description,
        stages: stages.map(({ key: _key, ...stage }) => stage),
        removed: removed.map(({ id, moveTo }) => ({ id, moveTo })),
      },
      { onSuccess: (saved) => onSaved(`${saved.name} was saved.`) },
    );
  }
  function discard() {
    setName(pipeline.name);
    setDescription(pipeline.description);
    setStages(draftOf(pipeline));
    setRemoved([]);
    save.reset();
  }

  return (
    <form noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      <Panel icon={SlidersHorizontal} title="Pipeline Settings" testId="pipeline-settings">
        <div className="grid gap-3 lg:grid-cols-2">
          <Input
            label="Pipeline name"
            maxLength={60}
            value={name}
            error={errors['name']}
            onChange={(event) => setName(event.target.value)}
          />
          <Textarea
            label="Description"
            rows={2}
            maxLength={300}
            value={description}
            error={errors['description']}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {pipeline.isDefault ? (
          <p className="mt-2 text-xs text-muted">
            The default pipeline opens first on the Sales Pipeline page.
          </p>
        ) : null}
      </Panel>

      <Panel
        icon={Kanban}
        title="Stages"
        testId="pipeline-stages"
        action={
          <Button variant="secondary" onClick={addStage}>
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Stage
          </Button>
        }
      >
        <p className="mb-3 text-sm text-muted">
          Board order, top to bottom. The type decides what each stage counts toward: active
          pipeline, converted client, transaction-synced, closed or lost.
        </p>
        <ol aria-label="Stages" className="flex flex-col gap-3">
          {stages.map((stage, index) => (
            <StageRow
              key={stage.key}
              stage={stage}
              index={index}
              count={stages.length}
              records={recordsOf(stage)}
              errors={errors}
              onChange={(next) => update(index, next)}
              onMove={(direction) => moveStage(index, direction)}
              onRemove={() => (recordsOf(stage) > 0 ? setRemoving(stage) : remove(stage, null))}
            />
          ))}
        </ol>
        {errors['stages'] ? <p className="mt-2 text-sm text-danger">{errors['stages']}</p> : null}
        {removed.length ? (
          <div data-testid="removed-stages" className="mt-3 rounded-lg bg-danger-soft p-3 text-sm">
            <p className="font-semibold text-heading">Removed when you save</p>
            <ul className="mt-1 flex flex-col gap-1">
              {removed.map((removal) => (
                <li key={removal.id} className="flex flex-wrap items-center gap-2 text-text">
                  {removal.name}
                  {removal.records
                    ? ` (${removal.records} records move to ${stages.find((stage) => stage.id === removal.moveTo)?.name ?? 'another stage'})`
                    : ''}
                  <button
                    type="button"
                    onClick={() => undo(removal)}
                    className="font-medium text-action hover:underline"
                  >
                    Undo
                  </button>
                </li>
              ))}
            </ul>
            {errors['removed'] ? <p className="mt-1 text-danger">{errors['removed']}</p> : null}
          </div>
        ) : null}
      </Panel>

      {general ? (
        <p role="alert" className="text-sm text-danger">
          {general}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={discard}>
          Discard Changes
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save Pipeline'}
        </Button>
      </div>
      {removing ? (
        <RemoveStageModal
          stage={removing}
          records={recordsOf(removing)}
          targets={stages.filter((stage) => stage.key !== removing.key && stage.id)}
          onClose={() => setRemoving(null)}
          onConfirm={(moveTo) => remove(removing, moveTo)}
        />
      ) : null}
    </form>
  );
}

/**
 * Build Pipeline (docx §15): administrators create pipelines and manage their stages. Stage ids
 * never change, so renaming or reordering keeps history; a stage with records moves them first.
 */
export function PipelineBuilder() {
  const meta = useSalesMeta();
  const pipelines = usePipelines();
  const [chosen, setChosen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const selected =
    pipelines.data?.find((pipeline) => pipeline.id === chosen) ??
    pipelines.data?.find((pipeline) => pipeline.isDefault);
  const allowed = meta.data?.permissions.managePipelines ?? false;

  return (
    <div data-testid="pipeline-builder" className="flex min-w-0 flex-col gap-4">
      <PageHeader
        above={
          <Crumbs
            items={[
              { label: 'Dashboard', href: '/' },
              { label: 'Sales', href: '/sales' },
              { label: 'Pipeline', href: '/sales/pipeline' },
              { label: 'Build Pipeline' },
            ]}
          />
        }
        title="Build Pipeline"
        subtitle="Create sales pipelines and manage their stages, without code changes."
        actions={
          <>
            <Link
              href="/sales/pipeline"
              className="inline-flex min-h-11 items-center rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas"
            >
              Back to Pipeline
            </Link>
            {allowed ? (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden weight="bold" className="size-4" />
                Create Pipeline
              </Button>
            ) : null}
          </>
        }
      />
      <Callout icon={Info} surface="info" size="compact" title="History is protected">
        Renaming or reordering a stage keeps every record&apos;s history. A stage that holds records
        is removed only after its records move to another stage.
      </Callout>
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}

      {meta.isError && !meta.data ? (
        <div className="rounded-xl bg-surface p-4 shadow-md">
          <FrameError onRetry={() => void meta.refetch()} />
        </div>
      ) : meta.data && !allowed ? (
        <div data-testid="page-forbidden" className="rounded-xl bg-surface p-4 shadow-md">
          <p className="font-medium text-text">Only administrators can build pipelines.</p>
          <p className="mt-1 text-sm text-muted">Ask an Owner or Super Admin for access.</p>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12 xl:items-start">
          <div className="min-w-0 xl:col-span-4">
            <Panel icon={FlowArrow} title="Pipelines" testId="pipeline-list">
              <FrameState query={pipelines} empty="No pipelines yet." lines={3}>
                {(list) => (
                  <ul className="flex flex-col gap-2">
                    {list.map((pipeline) => {
                      const records = Object.values(pipeline.recordCounts).reduce(
                        (sum, n) => sum + n,
                        0,
                      );
                      const active = pipeline.id === selected?.id;
                      return (
                        <li key={pipeline.id}>
                          <button
                            type="button"
                            aria-pressed={active}
                            onClick={() => setChosen(pipeline.id)}
                            className={`flex w-full flex-col gap-1 rounded-lg border p-3 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus ${active ? 'border-action bg-info-soft' : 'border-divider bg-surface'}`}
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-heading">{pipeline.name}</span>
                              {pipeline.isDefault ? <Badge tone="info">Default</Badge> : null}
                            </span>
                            <span className="text-sm text-muted">
                              {pipeline.stages.length} stages · {records}{' '}
                              {records === 1 ? 'record' : 'records'}
                            </span>
                            {pipeline.description ? (
                              <span className="text-sm text-text">{pipeline.description}</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </FrameState>
            </Panel>
          </div>
          <div className="min-w-0 xl:col-span-8">
            {selected ? (
              <PipelineEditor
                key={`${selected.id}-${selected.updatedAt}`}
                pipeline={selected}
                onSaved={setToast}
              />
            ) : (
              <Panel icon={Kanban} title="Stages">
                <FrameState
                  query={pipelines}
                  empty="Create a pipeline to manage its stages."
                  lines={6}
                >
                  {() => <p className="text-sm text-muted">Choose a pipeline on the left.</p>}
                </FrameState>
              </Panel>
            )}
          </div>
        </div>
      )}

      {creating ? (
        <CreatePipelineModal
          onClose={() => setCreating(false)}
          onCreated={(pipeline) => {
            setCreating(false);
            setChosen(pipeline.id);
            setToast(`${pipeline.name} was created.`);
          }}
        />
      ) : null}
    </div>
  );
}
