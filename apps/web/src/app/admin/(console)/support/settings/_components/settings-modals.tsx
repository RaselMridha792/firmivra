'use client';

import { Button, Checkbox, IconButton, Modal, Radio, Toggle } from '@firmivra/ui';
import { Trash } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import {
  NOTIFICATION_CHANNELS,
  PRIORITY_COLORS,
  TIME_ZONES,
  WEEKDAYS,
  type AssignmentRules,
  type CannedResponse,
  type DayHours,
  type EscalationRules,
  type NotificationChannel,
  type PriorityColor,
  type SupportCategory,
  type SupportPriority,
  type SupportSettings,
  type TargetUnit,
} from '../../../../../../mocks/admin-support';
import { adminSupport } from '../../_components/support-api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { AreaField, SelectField, TextField } from '../../_components/fields';
import { formatDate, PRIORITY_DOTS, SUPPORT, SUPPORT_ERRORS } from '../../_components/support-data';

export type Editing =
  | { kind: 'category'; item: SupportCategory | null }
  | { kind: 'priority'; item: SupportPriority | null }
  | { kind: 'canned'; item: CannedResponse | null }
  | { kind: 'hours' }
  | { kind: 'holidays' }
  | { kind: 'assignment' }
  | { kind: 'escalation' };

interface ModalProps {
  settings: SupportSettings;
  onClose: () => void;
  onDone: (message: string) => void;
}

const UNITS: { value: TargetUnit; label: string }[] = [
  { value: 'HOURS', label: 'Hours' },
  { value: 'BUSINESS_DAYS', label: 'Business days' },
];

function Actions({
  onClose,
  onSave,
  busy,
  label = 'Save',
}: {
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  label?: string;
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button onClick={onSave} disabled={busy}>
        {busy ? 'Saving…' : label}
      </Button>
    </>
  );
}

function Failure({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className="mt-4 text-sm text-danger">
      {errorMessage(error, SUPPORT_ERRORS)}
    </p>
  ) : null;
}

/** One of the settings modals; none has a route (docx §4). */
export function SettingsModal({ editing, ...props }: ModalProps & { editing: Editing }) {
  switch (editing.kind) {
    case 'category':
      return <CategoryModal item={editing.item} {...props} />;
    case 'priority':
      return <PriorityModal item={editing.item} {...props} />;
    case 'canned':
      return <CannedModal item={editing.item} {...props} />;
    case 'hours':
      return <HoursModal {...props} />;
    case 'holidays':
      return <HolidaysModal {...props} />;
    case 'assignment':
      return <AssignmentModal {...props} />;
    case 'escalation':
      return <EscalationModal {...props} />;
  }
}

function CategoryModal({ item, onClose, onDone }: ModalProps & { item: SupportCategory | null }) {
  const id = useId();
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [missing, setMissing] = useState(false);
  const save = useApiMutation(
    () => adminSupport.saveCategory({ ...(item ? { id: item.id } : {}), name, description }),
    { invalidate: SUPPORT },
  );
  return (
    <Modal
      open
      title={item ? 'Edit Category' : 'Add Category'}
      subtitle="Active categories can be chosen for new tickets."
      onClose={onClose}
      footer={
        <Actions
          onClose={onClose}
          busy={save.isPending}
          label={item ? 'Save' : 'Add Category'}
          onSave={() => {
            if (!name.trim()) {
              setMissing(true);
              return;
            }
            save.mutate(undefined, {
              onSuccess: (saved) => onDone(`Category "${saved.name}" saved.`),
            });
          }}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          id={`${id}-name`}
          label="Category Name"
          required
          maxLength={80}
          value={name}
          error={missing && !name.trim() ? 'Enter a category name.' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        <AreaField
          id={`${id}-description`}
          label="Description"
          rows={3}
          maxLength={200}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <Failure error={save.error} />
    </Modal>
  );
}

function PriorityModal({ item, onClose, onDone }: ModalProps & { item: SupportPriority | null }) {
  const id = useId();
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [color, setColor] = useState<PriorityColor>(item?.color ?? 'blue');
  const [amount, setAmount] = useState(String(item?.target.amount ?? 1));
  const [unit, setUnit] = useState<TargetUnit>(item?.target.unit ?? 'HOURS');
  const [missing, setMissing] = useState(false);
  const save = useApiMutation(
    () =>
      adminSupport.savePriority({
        ...(item ? { id: item.id } : {}),
        name,
        description,
        color,
        target: { amount: Number(amount), unit },
      }),
    { invalidate: SUPPORT },
  );
  const badAmount = !/^\d{1,3}$/.test(amount) || Number(amount) < 1;
  return (
    <Modal
      open
      title={item ? 'Edit Priority' : 'Add Priority'}
      subtitle="Colour, sorting and response target feed ticket creation, SLA and escalation."
      onClose={onClose}
      footer={
        <Actions
          onClose={onClose}
          busy={save.isPending}
          label={item ? 'Save' : 'Add Priority'}
          onSave={() => {
            if (!name.trim() || badAmount) {
              setMissing(true);
              return;
            }
            save.mutate(undefined, {
              onSuccess: (saved) => onDone(`Priority "${saved.name}" saved.`),
            });
          }}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${id}-name`}
          label="Priority Name"
          required
          maxLength={80}
          value={name}
          error={missing && !name.trim() ? 'Enter a priority name.' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        <SelectField
          id={`${id}-color`}
          label="Color"
          required
          dot={PRIORITY_DOTS[color]}
          options={(Object.keys(PRIORITY_COLORS) as PriorityColor[]).map((c) => ({
            value: c,
            label: PRIORITY_COLORS[c],
          }))}
          value={color}
          onChange={(event) => setColor(event.target.value as PriorityColor)}
        />
        <div className="sm:col-span-2">
          <AreaField
            id={`${id}-description`}
            label="Description"
            rows={2}
            maxLength={200}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <TextField
          id={`${id}-amount`}
          label="Response Target"
          required
          inputMode="numeric"
          maxLength={3}
          value={amount}
          error={missing && badAmount ? 'Enter a number from 1 to 999.' : undefined}
          onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))}
        />
        <SelectField
          id={`${id}-unit`}
          label="Unit"
          required
          options={UNITS}
          value={unit}
          onChange={(event) => setUnit(event.target.value as TargetUnit)}
        />
      </div>
      <Failure error={save.error} />
    </Modal>
  );
}

function CannedModal({
  item,
  settings,
  onClose,
  onDone,
}: ModalProps & { item: CannedResponse | null }) {
  const id = useId();
  const [title, setTitle] = useState(item?.title ?? '');
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [missing, setMissing] = useState(false);
  const save = useApiMutation(
    () =>
      adminSupport.saveCanned({
        ...(item ? { id: item.id } : {}),
        title,
        body,
        categoryId: categoryId || null,
      }),
    { invalidate: SUPPORT },
  );
  return (
    <Modal
      open
      title={item ? 'Edit Response' : 'Add Response'}
      subtitle="Staff insert it into a reply and edit it before sending."
      onClose={onClose}
      footer={
        <Actions
          onClose={onClose}
          busy={save.isPending}
          label={item ? 'Save' : 'Add Response'}
          onSave={() => {
            if (!title.trim() || !body.trim()) {
              setMissing(true);
              return;
            }
            save.mutate(undefined, {
              onSuccess: (saved) => onDone(`Canned response "${saved.title}" saved.`),
            });
          }}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${id}-title`}
          label="Title"
          required
          maxLength={80}
          value={title}
          error={missing && !title.trim() ? 'Enter a title.' : undefined}
          onChange={(event) => setTitle(event.target.value)}
        />
        <SelectField
          id={`${id}-category`}
          label="Category (Optional)"
          placeholder="Any category"
          options={settings.categories.map((c) => ({
            value: c.id,
            label: c.active ? c.name : `${c.name} (inactive)`,
          }))}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        />
        <div className="sm:col-span-2">
          <AreaField
            id={`${id}-body`}
            label="Message"
            required
            rows={6}
            maxLength={5000}
            value={body}
            error={missing && !body.trim() ? 'Write the message.' : undefined}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>
      </div>
      <Failure error={save.error} />
    </Modal>
  );
}

/** Monday first, as the design lists the week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function HoursModal({ settings, onClose, onDone }: ModalProps) {
  const id = useId();
  const hours = settings.businessHours;
  const [timeZone, setTimeZone] = useState(hours.timeZone);
  const [clock, setClock] = useState(hours.clock);
  const [days, setDays] = useState<DayHours[]>(hours.days);
  const save = useApiMutation(() => adminSupport.saveBusinessHours({ timeZone, clock, days }), {
    invalidate: SUPPORT,
  });
  const setDay = (day: number, change: Partial<DayHours>) =>
    setDays(days.map((d) => (d.day === day ? { ...d, ...change } : d)));
  return (
    <Modal
      open
      title="SLA & Business Hours"
      subtitle="SLA clocks count these hours unless calendar time is chosen. Holidays pause them."
      onClose={onClose}
      footer={
        <Actions
          onClose={onClose}
          busy={save.isPending}
          onSave={() =>
            save.mutate(undefined, { onSuccess: () => onDone('Business hours saved.') })
          }
        />
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField
          id={`${id}-zone`}
          label="Time Zone"
          required
          options={TIME_ZONES.map((z) => ({ value: z.value, label: `${z.label} (${z.short})` }))}
          value={timeZone}
          onChange={(event) => setTimeZone(event.target.value)}
        />
        <fieldset className="flex flex-col">
          <legend className="text-sm font-medium text-text">SLA clock</legend>
          <Radio
            name={`${id}-clock`}
            label="Count business hours only"
            checked={clock === 'BUSINESS'}
            onChange={() => setClock('BUSINESS')}
          />
          <Radio
            name={`${id}-clock`}
            label="Count calendar time (every hour)"
            checked={clock === 'CALENDAR'}
            onChange={() => setClock('CALENDAR')}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-text">Working days</legend>
          {WEEK_ORDER.map((number) => {
            const day = days.find((d) => d.day === number);
            if (!day) return null;
            const name = WEEKDAYS[number] ?? '';
            return (
              <div key={number} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-4">
                <span className="text-sm text-heading">{name}</span>
                <span className="flex items-center gap-2 text-sm text-muted">
                  <Toggle
                    label={`${name} open`}
                    checked={day.open}
                    onChange={(open) => setDay(number, { open })}
                  />
                  {day.open ? 'Open' : 'Closed'}
                </span>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <span className="sr-only">{name} opens</span>
                  <input
                    type="time"
                    value={day.start}
                    disabled={!day.open}
                    onChange={(event) => setDay(number, { start: event.target.value })}
                    className="w-full rounded-control border border-border bg-surface px-2 py-1.5 text-sm text-text disabled:bg-disabled"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <span className="sr-only">{name} closes</span>
                  <input
                    type="time"
                    value={day.end}
                    disabled={!day.open}
                    onChange={(event) => setDay(number, { end: event.target.value })}
                    className="w-full rounded-control border border-border bg-surface px-2 py-1.5 text-sm text-text disabled:bg-disabled"
                  />
                </label>
              </div>
            );
          })}
        </fieldset>
      </div>
      <Failure error={save.error} />
    </Modal>
  );
}

function HolidaysModal({ settings, onClose, onDone }: ModalProps) {
  const id = useId();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [missing, setMissing] = useState(false);
  const add = useApiMutation(() => adminSupport.addHoliday({ date, name }), {
    invalidate: SUPPORT,
  });
  const remove = useApiMutation((holidayId: string) => adminSupport.removeHoliday(holidayId), {
    invalidate: SUPPORT,
  });
  const holidays = settings.businessHours.holidays;
  return (
    <Modal
      open
      title="Holiday Calendar"
      subtitle="Business-hour SLA clocks pause on these days."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={() => onDone('Holiday calendar updated.')}>
          Done
        </Button>
      }
    >
      {holidays.length === 0 ? (
        <p className="py-3 text-sm text-muted">No holidays yet.</p>
      ) : (
        <ul aria-label="Holidays" className="mb-4 flex flex-col divide-y divide-divider">
          {holidays.map((holiday) => (
            <li key={holiday.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-medium text-heading">{holiday.name}</span>{' '}
                <span className="text-muted">{formatDate(`${holiday.date}T12:00:00`)}</span>
              </span>
              <IconButton
                icon={Trash}
                tone="danger"
                label={`Remove ${holiday.name}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(holiday.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="grid items-end gap-3 sm:grid-cols-3">
        <TextField
          id={`${id}-date`}
          label="Date"
          type="date"
          required
          value={date}
          error={missing && !date ? 'Choose a date.' : undefined}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          id={`${id}-name`}
          label="Holiday Name"
          required
          maxLength={80}
          value={name}
          error={missing && !name.trim() ? 'Enter a name.' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="pb-5">
          <Button
            variant="outline"
            disabled={add.isPending}
            onClick={() => {
              if (!date || !name.trim()) {
                setMissing(true);
                return;
              }
              add.mutate(undefined, {
                onSuccess: () => {
                  setDate('');
                  setName('');
                  setMissing(false);
                },
              });
            }}
          >
            Add Holiday
          </Button>
        </div>
      </div>
      <Failure error={add.error ?? remove.error} />
    </Modal>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  children,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-divider p-3">
      <div className="flex items-start justify-between gap-3">
        <span>
          <span className="block text-sm font-semibold text-heading">{label}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        <Toggle label={label} checked={checked} onChange={onChange} />
      </div>
      {checked && children ? <div className="grid gap-3 sm:grid-cols-2">{children}</div> : null}
    </div>
  );
}

function AssignmentModal({ settings, onClose, onDone }: ModalProps) {
  const id = useId();
  const [rules, setRules] = useState<AssignmentRules>(settings.assignment);
  const [after, setAfter] = useState(String(settings.assignment.reassignAfterHours));
  const badAfter = !/^\d{1,2}$/.test(after) || Number(after) < 1 || Number(after) > 72;
  const save = useApiMutation(
    () => adminSupport.saveAssignment({ ...rules, reassignAfterHours: Number(after) || 4 }),
    { invalidate: SUPPORT },
  );
  return (
    <Modal
      open
      title="Assignment Rules"
      subtitle="How new tickets find an owner."
      onClose={onClose}
      footer={
        <Actions
          onClose={onClose}
          busy={save.isPending}
          onSave={() => {
            if (rules.reassign && badAfter) return;
            save.mutate(undefined, { onSuccess: () => onDone('Assignment rules saved.') });
          }}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <ToggleRow
          label="Default to the Support Team queue"
          hint="New tickets without an assignee wait in the queue, visible to eligible staff."
          checked={rules.defaultQueue}
          onChange={(defaultQueue) => setRules({ ...rules, defaultQueue })}
        />
        <ToggleRow
          label="Round robin"
          hint="Share new tickets among available members; inactive or away members are skipped."
          checked={rules.roundRobin}
          onChange={(roundRobin) => setRules({ ...rules, roundRobin })}
        />
        <ToggleRow
          label="Reassign when not accepted"
          hint="Hand the ticket to the next available member when the assignee doesn't take it."
          checked={rules.reassign}
          onChange={(reassign) => setRules({ ...rules, reassign })}
        >
          <TextField
            id={`${id}-after`}
            label="Reassign after (hours)"
            required
            inputMode="numeric"
            maxLength={2}
            value={after}
            error={badAfter ? 'Enter 1 to 72 hours.' : undefined}
            onChange={(event) => setAfter(event.target.value.replace(/\D/g, ''))}
          />
        </ToggleRow>
      </div>
      <Failure error={save.error} />
    </Modal>
  );
}

function EscalationModal({ settings, onClose, onDone }: ModalProps) {
  const id = useId();
  const [rules, setRules] = useState<EscalationRules>(settings.escalation);
  const [amount, setAmount] = useState(String(settings.escalation.highPriority.target.amount));
  const badAmount = !/^\d{1,3}$/.test(amount) || Number(amount) < 1;
  const save = useApiMutation(
    () =>
      adminSupport.saveEscalation({
        ...rules,
        highPriority: {
          ...rules.highPriority,
          target: { ...rules.highPriority.target, amount: Number(amount) || 1 },
        },
      }),
    { invalidate: SUPPORT },
  );
  const priorities = [...settings.priorities]
    .sort((a, b) => a.rank - b.rank)
    .map((p) => ({ value: p.id, label: p.name }));
  const toggleChannel = (channel: NotificationChannel, on: boolean) =>
    setRules({
      ...rules,
      critical: {
        ...rules.critical,
        channels: on
          ? [...rules.critical.channels, channel]
          : rules.critical.channels.filter((c) => c !== channel),
      },
    });
  return (
    <Modal
      open
      title="Escalation Rules"
      subtitle="Rules run automatically and record each escalation in the ticket's history."
      onClose={onClose}
      footer={
        <Actions
          onClose={onClose}
          busy={save.isPending}
          onSave={() => {
            if (rules.highPriority.enabled && badAmount) return;
            save.mutate(undefined, { onSuccess: () => onDone('Escalation rules saved.') });
          }}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <ToggleRow
          label="SLA Breach"
          hint="Escalate when the response time passes its target."
          checked={rules.slaBreach.enabled}
          onChange={(enabled) => setRules({ ...rules, slaBreach: { ...rules.slaBreach, enabled } })}
        >
          <SelectField
            id={`${id}-breach`}
            label="Notify"
            options={[
              { value: 'LEAD', label: 'Team lead' },
              { value: 'ADMINS', label: 'Admins' },
            ]}
            value={rules.slaBreach.notify}
            onChange={(event) =>
              setRules({
                ...rules,
                slaBreach: { ...rules.slaBreach, notify: event.target.value as 'LEAD' | 'ADMINS' },
              })
            }
          />
        </ToggleRow>
        <ToggleRow
          label="High Priority"
          hint="Escalate to an admin when a ticket of this priority is not resolved in time."
          checked={rules.highPriority.enabled}
          onChange={(enabled) =>
            setRules({ ...rules, highPriority: { ...rules.highPriority, enabled } })
          }
        >
          <SelectField
            id={`${id}-high`}
            label="Priority"
            options={priorities}
            value={rules.highPriority.priorityId}
            onChange={(event) =>
              setRules({
                ...rules,
                highPriority: { ...rules.highPriority, priorityId: event.target.value },
              })
            }
          />
          <span className="grid grid-cols-2 gap-2">
            <TextField
              id={`${id}-high-amount`}
              label="Within"
              required
              inputMode="numeric"
              maxLength={3}
              value={amount}
              error={badAmount ? '1 to 999.' : undefined}
              onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))}
            />
            <SelectField
              id={`${id}-high-unit`}
              label="Unit"
              options={UNITS}
              value={rules.highPriority.target.unit}
              onChange={(event) =>
                setRules({
                  ...rules,
                  highPriority: {
                    ...rules.highPriority,
                    target: {
                      ...rules.highPriority.target,
                      unit: event.target.value as TargetUnit,
                    },
                  },
                })
              }
            />
          </span>
        </ToggleRow>
        <ToggleRow
          label="Critical"
          hint="Notify admins at once when a ticket of this priority comes in."
          checked={rules.critical.enabled}
          onChange={(enabled) => setRules({ ...rules, critical: { ...rules.critical, enabled } })}
        >
          <SelectField
            id={`${id}-critical`}
            label="Priority"
            options={priorities}
            value={rules.critical.priorityId}
            onChange={(event) =>
              setRules({
                ...rules,
                critical: { ...rules.critical, priorityId: event.target.value },
              })
            }
          />
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium text-text">Channels</legend>
            {(Object.keys(NOTIFICATION_CHANNELS) as NotificationChannel[]).map((channel) => (
              <Checkbox
                key={channel}
                label={NOTIFICATION_CHANNELS[channel]}
                checked={rules.critical.channels.includes(channel)}
                onChange={(event) => toggleChannel(channel, event.target.checked)}
              />
            ))}
          </fieldset>
        </ToggleRow>
      </div>
      <Failure error={save.error} />
    </Modal>
  );
}
