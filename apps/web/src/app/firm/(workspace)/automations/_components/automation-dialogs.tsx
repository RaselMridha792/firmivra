'use client';

import type { AutomationPreview, AutomationRuleRow } from '@firmivra/types';
import {
  ActionMenu,
  type ActionMenuItem,
  Badge,
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
  Textarea,
} from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  ClipboardText,
  Copy,
  DotsThreeVertical,
  FloppyDisk,
  Flask,
  Pause,
  PencilSimple,
  Play,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { AUTOMATIONS_KEY, AUTOMATION_ERRORS, quiet } from './automations-shared';

/** The three-dot menu of a rule: Edit, Duplicate, Test, Pause or Activate, View Logs, Save as Template, Archive. */
export function RuleMenu({
  row,
  onNotice,
  canManage = true,
}: {
  row: Pick<AutomationRuleRow, 'id' | 'name' | 'status'>;
  onNotice: (text: string, tone: 'success' | 'error') => void;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<'test' | 'template'>();
  const options = { invalidate: [...AUTOMATIONS_KEY] };
  const fail = (e: unknown) => onNotice(errorMessage(e, AUTOMATION_ERRORS), 'error');
  const duplicate = useApiMutation(() => api.automations.duplicateRule(row.id), options);
  const qc = useQueryClient();
  // The row can leave the list when the change lands, so the notice is shown from here, not from a per-call callback.
  const act = (change: () => Promise<unknown>, done: string) =>
    change()
      .then(() => {
        onNotice(done, 'success');
        return qc.invalidateQueries({ queryKey: [...AUTOMATIONS_KEY] });
      })
      .catch(fail);
  const item = (
    label: string,
    icon: typeof Copy,
    onSelect: () => void,
    danger?: boolean,
  ): ActionMenuItem => ({
    label,
    icon,
    onSelect,
    ...(danger ? { danger } : {}),
  });
  const items: ActionMenuItem[] = [
    item('View / Edit', PencilSimple, () => router.push(`/automations/${row.id}/edit`)),
    ...(canManage
      ? [
          item('Duplicate', Copy, () =>
            duplicate.mutate(undefined, {
              onSuccess: (d) => router.push(`/automations/${d.id}/edit`),
              onError: fail,
            }),
          ),
          item('Test', Flask, () => setDialog('test')),
          ...(row.status === 'ACTIVE'
            ? [
                item('Pause', Pause, () =>
                  act(() => api.automations.pause(row.id), `${row.name} paused.`),
                ),
              ]
            : row.status === 'ARCHIVED'
              ? []
              : [
                  item('Activate', Play, () =>
                    act(() => api.automations.activate(row.id), `${row.name} is active.`),
                  ),
                ]),
        ]
      : []),
    item('View Logs', ClipboardText, () => router.push(`/automations/logs?ruleId=${row.id}`)),
    ...(canManage
      ? [
          item('Save as Template', FloppyDisk, () => setDialog('template')),
          row.status === 'ARCHIVED'
            ? item('Restore', ArrowCounterClockwise, () =>
                act(() => api.automations.restoreRule(row.id), `${row.name} restored as a draft.`),
              )
            : item(
                'Archive',
                Archive,
                () => act(() => api.automations.archiveRule(row.id), `${row.name} archived.`),
                true,
              ),
        ]
      : []),
  ];
  return (
    <>
      <ActionMenu
        label={`Actions for ${row.name}`}
        sections={[{ items }]}
        trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
      />
      {dialog === 'test' ? (
        <TestDialog id={row.id} name={row.name} onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === 'template' ? (
        <SaveTemplateDialog
          id={row.id}
          name={row.name}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            onNotice('Saved as a template.', 'success');
          }}
        />
      ) : null}
    </>
  );
}

/** The checks and the planned actions of a rule, without running it. */
export function PreviewPanel({ preview }: { preview: AutomationPreview }) {
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="preview-panel">
      <p className="text-heading">
        <span className="font-semibold">{preview.triggerPreview}</span> · {preview.matchCount}{' '}
        matching record(s) right now.
      </p>
      {preview.sample.length > 0 ? (
        <ul className="rounded-lg border border-divider">
          {preview.sample.map((s) => (
            <li key={s.recordId} className="border-t border-divider px-3 py-1.5 first:border-t-0">
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <h3 className="mb-1 font-semibold text-heading">What would happen</h3>
        <ol className="list-decimal pl-5 text-text">
          {preview.plannedActions.map((a) => (
            <li key={a.id}>{a.summary}</li>
          ))}
        </ol>
      </div>
      {preview.checks.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Checks">
          {preview.checks.map((c, i) => (
            <li key={`${c.code}-${i}`} className="flex items-start gap-2">
              <Badge tone={c.severity === 'BLOCK' ? 'danger' : 'warning'}>
                {c.severity === 'BLOCK' ? 'Fix' : 'Note'}
              </Badge>
              <span className="text-heading">{c.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-success">All checks passed.</p>
      )}
    </div>
  );
}

function TestDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const q = useApiQuery([...AUTOMATIONS_KEY, 'test', id], () => api.automations.testRule(id));
  return (
    <Modal
      open
      title="Test rule"
      subtitle={`${name} · a dry run: nothing is sent or changed`}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {q.data ? (
        <PreviewPanel preview={q.data} />
      ) : (
        <p className={quiet}>{q.isError ? 'The test is not available right now.' : 'Loading…'}</p>
      )}
    </Modal>
  );
}

export function SaveTemplateDialog({
  id,
  name,
  onClose,
  onDone,
}: {
  id: string;
  name: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(`${name} template`);
  const save = useApiMutation(() => api.automations.saveRuleAsTemplate(id, { name: text.trim() }), {
    invalidate: [...AUTOMATIONS_KEY],
  });
  return (
    <Modal
      open
      title="Save as Template"
      subtitle="A template keeps the trigger, conditions and actions, not the history."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!text.trim() || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onDone })}
          >
            Save Template
          </Button>
        </>
      }
    >
      <Input
        label="Template name"
        value={text}
        maxLength={120}
        onChange={(e) => setText(e.target.value)}
      />
      {save.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(save.error, AUTOMATION_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}

/** Automation Settings: quiet hours, duplicate prevention, depth, safety threshold, alerts and retention. */
export function SettingsDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const q = useApiQuery([...AUTOMATIONS_KEY, 'settings'], () => api.automations.settings());
  if (!q.data) {
    return (
      <Modal
        open
        title="Automation Settings"
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className={quiet}>{q.isError ? 'Settings are not available right now.' : 'Loading…'}</p>
      </Modal>
    );
  }
  const s = q.data;
  return (
    <SettingsForm
      initial={{
        quiet: s.quietHours !== null,
        start: s.quietHours?.start ?? '20:00',
        end: s.quietHours?.end ?? '07:00',
        dedupe: String(s.defaultDedupeDays),
        depth: String(s.maxDepth),
        threshold: String(s.safetyThreshold),
        minutes: String(s.minutesSavedPerAction),
        retention: String(s.logRetentionDays),
        alerts: s.failureAlertUsers.map((m) => m.userId),
      }}
      timezone={s.timezone}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
function SettingsForm({
  initial,
  timezone,
  onClose,
  onDone,
}: {
  initial: {
    quiet: boolean;
    start: string;
    end: string;
    dedupe: string;
    depth: string;
    threshold: string;
    minutes: string;
    retention: string;
    alerts: string[];
  };
  timezone: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState(initial);
  const team = useApiQuery([...AUTOMATIONS_KEY, 'members'], () => api.team.list());
  const members = (team.data ?? []).filter((m) => m.status === 'ACTIVE');
  const save = useApiMutation(
    () =>
      api.automations.saveSettings({
        quietHours: f.quiet ? { start: f.start, end: f.end } : null,
        defaultDedupeDays: Number(f.dedupe),
        maxDepth: Number(f.depth),
        safetyThreshold: Number(f.threshold),
        minutesSavedPerAction: Number(f.minutes),
        logRetentionDays: Number(f.retention),
        failureAlertUserIds: f.alerts,
      }),
    { invalidate: [...AUTOMATIONS_KEY] },
  );
  const num = (
    label: string,
    key: 'dedupe' | 'depth' | 'threshold' | 'minutes' | 'retention',
    hint: string,
  ) => (
    <div className="flex flex-col gap-1">
      <Input
        label={label}
        type="number"
        min={0}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
  return (
    <Modal
      open
      title="Automation Settings"
      subtitle={`Defaults for every rule · times use ${timezone}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onDone })}
          >
            Save Settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="settings-form">
        <Checkbox
          label="Do not contact clients during quiet hours"
          checked={f.quiet}
          onChange={(e) => setF({ ...f, quiet: e.target.checked })}
        />
        {f.quiet ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Quiet hours start"
              type="time"
              value={f.start}
              onChange={(e) => setF({ ...f, start: e.target.value })}
            />
            <Input
              label="Quiet hours end"
              type="time"
              value={f.end}
              onChange={(e) => setF({ ...f, end: e.target.value })}
            />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {num(
            'Prevent duplicates (days)',
            'dedupe',
            'The same action is not repeated for the same record within this time.',
          )}
          {num('Longest chain', 'depth', 'How many rules can start each other.')}
          {num('Safety threshold', 'threshold', 'Warn when more records than this match a rule.')}
          {num('Minutes saved per action', 'minutes', 'Used for the Time Saved card.')}
          {num('Keep logs (days)', 'retention', 'Between 30 and 2,555 days.')}
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium text-text">
            Tell these people when a rule fails
          </legend>
          {members.map((m) => (
            <Checkbox
              key={m.user.id}
              label={m.user.name}
              checked={f.alerts.includes(m.user.id)}
              onChange={(e) =>
                setF({
                  ...f,
                  alerts: e.target.checked
                    ? [...f.alerts, m.user.id]
                    : f.alerts.filter((x) => x !== m.user.id),
                })
              }
            />
          ))}
        </fieldset>
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, AUTOMATION_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Import Automation Templates: paste the exported file's text. */
export function ImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const send = useApiMutation(
    (body: Parameters<typeof api.automations.importTemplate>[0]) =>
      api.automations.importTemplate(body),
    { invalidate: [...AUTOMATIONS_KEY] },
  );
  return (
    <Modal
      open
      title="Import Automation Templates"
      subtitle="Paste the text of a template exported from Firmivra."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!text.trim() || send.isPending}
            onClick={() => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(text);
              } catch {
                return setError('That is not a valid template file.');
              }
              setError(undefined);
              send.mutate(parsed as Parameters<typeof api.automations.importTemplate>[0], {
                onSuccess: (t) => onDone(t.name),
                onError: (e) => setError(errorMessage(e, AUTOMATION_ERRORS)),
              });
            }}
          >
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" data-testid="import-form">
        <Textarea
          label="Template file"
          value={text}
          rows={8}
          onChange={(e) => setText(e.target.value)}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Duplicate Existing Rule: pick one, and its copy opens as a draft. */
export function DuplicateDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const list = useApiQuery([...AUTOMATIONS_KEY, 'pick'], () =>
    api.automations.rules({ pageSize: 100 }),
  );
  const [id, setId] = useState('');
  const dup = useApiMutation(() => api.automations.duplicateRule(id), {
    invalidate: [...AUTOMATIONS_KEY],
  });
  return (
    <Modal
      open
      title="Duplicate Existing Rule"
      subtitle="The copy is a draft with no history."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!id || dup.isPending}
            onClick={() =>
              dup.mutate(undefined, { onSuccess: (d) => router.push(`/automations/${d.id}/edit`) })
            }
          >
            Duplicate
          </Button>
        </>
      }
    >
      <Select
        label="Rule"
        value={id}
        onChange={(e) => setId(e.target.value)}
        options={[
          { value: '', label: 'Choose a rule' },
          ...(list.data?.items ?? []).map((r) => ({ value: r.id, label: r.name })),
        ]}
      />
      {dup.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(dup.error, AUTOMATION_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
