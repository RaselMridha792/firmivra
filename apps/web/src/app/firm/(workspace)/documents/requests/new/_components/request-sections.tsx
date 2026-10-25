'use client';

import type { RequestTemplate, TeamMember } from '@firmivra/types';
import { Button, Input, Modal, Select, Textarea, Toggle } from '@firmivra/ui';
import {
  FileText,
  Info,
  LinkSimple,
  ListBullets,
  ListNumbers,
  MagnifyingGlass,
  Plus,
  User,
  UserCircleDashed,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { RowMenu } from '../../../../team/_components/row-menu';
import { ClientPicker } from '../../../upload/_components/client-picker';
import {
  CUSTOM,
  type DraftErrors,
  type DraftItem,
  itemKey,
  MESSAGE_MAX,
  REMINDER_DAYS,
  type RequestDraft,
} from './request-draft';

export type Patch = (next: Partial<RequestDraft>) => void;

/** A numbered part of the form: "1. Recipient Information". */
export function Section({
  title,
  subtitle,
  action,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={id} className="font-display text-xl font-bold text-heading">
            {title}
          </h2>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A requested document has no file yet, so it shows one neutral icon (no guessed file type). */
export function DocIcon() {
  return (
    <span
      aria-hidden
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-info-soft"
    >
      <FileText weight="fill" className="size-5 text-action" />
    </span>
  );
}

const Alert = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="text-sm font-medium text-danger">
    {children}
  </p>
);

function RecipientCard({
  icon: Glyph,
  title,
  note,
  checked,
  disabled,
  onSelect,
}: {
  icon: Icon;
  title: string;
  note: string;
  checked: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <label
      className={`flex min-h-14 items-center gap-2 rounded-control border px-2.5 py-2 ${checked ? 'border-action bg-info-soft' : 'border-border bg-surface'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-action'}`}
    >
      <input
        type="radio"
        name="recipient"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="size-5 shrink-0 accent-action"
      />
      <Glyph aria-hidden weight="fill" className="size-6 shrink-0 text-heading" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-heading">{title}</span>
        <span className="block text-xs text-muted">{note}</span>
      </span>
    </label>
  );
}

/** 1. Recipient Information: a client, or a team member working on a client's request. */
export function RecipientSection({
  draft,
  onChange,
  team,
  errors,
  number = 1,
}: {
  draft: RequestDraft;
  onChange: Patch;
  /** Active members, or null when they cannot be listed (Staff, or the API is down). */
  team: TeamMember[] | null;
  errors: DraftErrors;
  number?: number;
}) {
  const member = draft.recipientKind === 'MEMBER';
  return (
    <Section
      title={`${number}. Recipient Information`}
      subtitle="Choose who will receive this document request."
      testId="recipient"
    >
      <div role="radiogroup" aria-label="Recipient" className="grid gap-3 md:grid-cols-3">
        <RecipientCard
          icon={User}
          title="Client"
          note="Send to an existing client"
          checked={!member}
          onSelect={() => onChange({ recipientKind: 'CLIENT' })}
        />
        <RecipientCard
          icon={UserCircleDashed}
          title="Lead"
          note="Convert to a client first"
          checked={false}
          disabled
        />
        <RecipientCard
          icon={Users}
          title="Team Member"
          note="Send to a staff member"
          checked={member}
          disabled={!team}
          onSelect={() => onChange({ recipientKind: 'MEMBER' })}
        />
      </div>
      <div className={`grid grid-cols-1 gap-4 ${member ? 'md:grid-cols-2' : ''}`}>
        {member ? (
          <Select
            label="Team Member *"
            value={draft.memberUserId}
            error={errors['member']}
            onChange={(e) => onChange({ memberUserId: e.target.value })}
            options={[
              { value: '', label: 'Choose a team member' },
              ...(team ?? []).map((m) => ({ value: m.user.id, label: m.user.name })),
            ]}
          />
        ) : null}
        <ClientPicker
          label={member ? 'About Client' : 'Client'}
          value={draft.client}
          onChange={(client) => onChange({ client })}
          error={errors['client']}
          disabled={false}
        />
      </div>
    </Section>
  );
}

/** 2. Request Details: title, type (the firm's request templates, or Custom) and due date. */
export function DetailsSection({
  draft,
  types,
  onType,
  onChange,
  errors,
  extra,
}: {
  draft: RequestDraft;
  /** The firm's request types; null when they could not be loaded. */
  types: RequestTemplate[] | null;
  onType: (typeId: string) => void;
  onChange: Patch;
  errors: DraftErrors;
  /** The client's service, when it has to be chosen. */
  extra?: ReactNode;
}) {
  return (
    <Section title="2. Request Details" testId="request-details">
      <div className="grid gap-4 md:grid-cols-3">
        <Input
          label="Request Title *"
          value={draft.title}
          maxLength={200}
          error={errors['title']}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <Select
          label="Request Type *"
          value={draft.typeId}
          error={errors['type'] ?? (types ? undefined : 'Request types could not be loaded.')}
          onChange={(e) => onType(e.target.value)}
          options={[
            { value: '', label: 'Choose a type' },
            ...(types ?? []).map((t) => ({ value: t.id, label: t.name })),
            { value: CUSTOM, label: 'Custom' },
          ]}
        />
        <Input
          label="Due Date *"
          type="date"
          value={draft.dueOn}
          error={errors['dueOn']}
          onChange={(e) => onChange({ dueOn: e.target.value })}
        />
      </div>
      {extra}
    </Section>
  );
}

export function moveItem(items: DraftItem[], key: string, to: number): DraftItem[] {
  const from = items.findIndex((i) => i.key === key);
  if (from < 0 || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** The row menu shared by both document tables. */
export function itemMenu(
  items: DraftItem[],
  item: DraftItem,
  onItems: (items: DraftItem[]) => void,
  onEdit: (item: DraftItem) => void,
) {
  const at = items.findIndex((i) => i.key === item.key);
  return (
    <RowMenu
      label={`Actions for ${item.title}`}
      items={[
        { label: 'Edit Details', onSelect: () => onEdit(item) },
        ...(at > 0
          ? [{ label: 'Move Up', onSelect: () => onItems(moveItem(items, item.key, at - 1)) }]
          : []),
        ...(at < items.length - 1
          ? [{ label: 'Move Down', onSelect: () => onItems(moveItem(items, item.key, at + 1)) }]
          : []),
        {
          label: 'Remove',
          danger: true,
          onSelect: () => onItems(items.filter((i) => i.key !== item.key)),
        },
      ]}
    />
  );
}

/** Add Custom Document, or Edit Details of one on the list. */
export function ItemDialog({
  item,
  onClose,
  onSave,
}: {
  /** null: closed; an item without a title: a new custom document. */
  item: DraftItem | null;
  onClose: () => void;
  onSave: (item: DraftItem) => void;
}) {
  return (
    <Modal
      open={item !== null}
      title={item?.title ? 'Edit Document' : 'Add Custom Document'}
      subtitle="Name the document as the client should see it."
      onClose={onClose}
    >
      {item ? <ItemForm key={item.key} item={item} onClose={onClose} onSave={onSave} /> : null}
    </Modal>
  );
}

function ItemForm({
  item,
  onClose,
  onSave,
}: {
  item: DraftItem;
  onClose: () => void;
  onSave: (item: DraftItem) => void;
}) {
  const [value, setValue] = useState(item);
  const [error, setError] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.title.trim()) return setError('Enter the document’s name.');
        onSave({ ...value, title: value.title.trim(), description: value.description.trim() });
      }}
    >
      <Input
        label="Document Name *"
        autoFocus
        maxLength={200}
        value={value.title}
        error={error || undefined}
        onChange={(e) => setValue({ ...value, title: e.target.value })}
      />
      <Textarea
        label="Description (optional)"
        rows={3}
        maxLength={1000}
        value={value.description}
        onChange={(e) => setValue({ ...value, description: e.target.value })}
      />
      <label className="flex items-center gap-3 text-sm text-heading">
        <Toggle
          label="Required"
          checked={value.required}
          onChange={(required) => setValue({ ...value, required })}
        />
        Required
      </label>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">{item.title ? 'Save' : 'Add Document'}</Button>
      </div>
    </form>
  );
}

export const newItem = (): DraftItem => ({
  key: itemKey(),
  title: '',
  description: '',
  required: true,
  categoryId: null,
  selected: true,
  templateId: null,
});

/** 3. Documents Requested (Frame 1): tick what to request, mark it required or optional. */
export function DocumentsSection({
  draft,
  templates,
  onItems,
  onUseTemplate,
  errors,
}: {
  draft: RequestDraft;
  templates: RequestTemplate[] | null;
  onItems: (items: DraftItem[]) => void;
  onUseTemplate: (id: string) => void;
  errors: DraftErrors;
}) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<DraftItem | null>(null);
  const items = draft.items;
  const term = search.trim().toLowerCase();
  const shown = term ? items.filter((i) => i.title.toLowerCase().includes(term)) : items;
  const allOn = shown.length > 0 && shown.every((i) => i.selected);
  const set = (key: string, next: Partial<DraftItem>) =>
    onItems(items.map((i) => (i.key === key ? { ...i, ...next } : i)));

  return (
    <Section
      title="3. Documents Requested"
      subtitle="Select the documents you need. You can choose from a template or add custom items."
      testId="documents-requested"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label="Use a Template (Optional)"
          hideLabel
          value=""
          disabled={!templates?.length}
          onChange={(e) => e.target.value && onUseTemplate(e.target.value)}
          options={[
            {
              value: '',
              label: !templates
                ? 'Templates could not be loaded'
                : templates.length
                  ? 'Use a Template (Optional)'
                  : 'No templates yet',
            },
            ...(templates ?? []).map((t) => ({
              value: t.id,
              label: t.owner === 'MINE' ? `${t.name} (my list)` : t.name,
            })),
          ]}
        />
        <label className="flex min-h-11 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm">
          <MagnifyingGlass aria-hidden weight="bold" className="size-4 text-muted" />
          <span className="sr-only">Search documents</span>
          <input
            type="search"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            className="min-h-0 w-full bg-transparent text-text outline-none"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="bg-canvas text-left text-xs font-semibold text-heading">
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Request every document shown"
                  checked={allOn}
                  disabled={!shown.length}
                  onChange={() => {
                    const keys = new Set(shown.map((i) => i.key));
                    onItems(items.map((i) => (keys.has(i.key) ? { ...i, selected: !allOn } : i)));
                  }}
                  className="size-4 accent-action"
                />
              </th>
              <th scope="col" className="px-3 py-2">
                Document Name
              </th>
              <th scope="col" className="w-24 px-3 py-2">
                Required
              </th>
              <th scope="col" className="w-20 px-3 py-2 text-center">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted">
                  {items.length
                    ? 'No documents match your search.'
                    : 'No documents yet. Choose a request type or a template, or add a custom document.'}
                </td>
              </tr>
            ) : (
              shown.map((item) => (
                <tr key={item.key} data-testid="request-item" className="border-b border-divider">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Request ${item.title}`}
                      checked={item.selected}
                      onChange={() => set(item.key, { selected: !item.selected })}
                      className="size-4 accent-action"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-3">
                      <DocIcon />
                      <span className="text-heading">{item.title}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Toggle
                      label={`${item.title} is required`}
                      checked={item.required}
                      onChange={(required) => set(item.key, { required })}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {itemMenu(items, item, onItems, setEditing)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {errors['items'] ? <Alert>{errors['items']}</Alert> : null}
      <button
        type="button"
        onClick={() => setEditing(newItem())}
        className="inline-flex items-center gap-2 self-start font-medium text-action underline"
      >
        <Plus aria-hidden weight="bold" className="size-4" />
        Add Custom Document
      </button>
      <ItemDialog
        item={editing}
        onClose={() => setEditing(null)}
        onSave={(saved) => {
          onItems(
            items.some((i) => i.key === saved.key)
              ? items.map((i) => (i.key === saved.key ? saved : i))
              : [...items, saved],
          );
          setEditing(null);
        }}
      />
    </Section>
  );
}

/** Puts `before` and `after` around the selected lines (a list) or at the cursor. */
function insertAround(
  area: HTMLTextAreaElement,
  value: string,
  make: (selected: string) => string,
): { text: string; cursor: number } {
  const { selectionStart: start, selectionEnd: end } = area;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const replaced = make(value.slice(lineStart, end));
  return {
    text: value.slice(0, lineStart) + replaced + value.slice(end),
    cursor: lineStart + replaced.length,
  };
}

/**
 * 4. Message to Recipient. The message is plain text (the API keeps it as written), so the
 * toolbar offers what plain text can hold: bulleted and numbered lines, and a link.
 */
export function MessageSection({
  draft,
  onChange,
  onPreview,
  errors,
  number = 4,
}: {
  draft: RequestDraft;
  onChange: Patch;
  onPreview: () => void;
  errors: DraftErrors;
  number?: number;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const write = (message: string, cursor?: number) => {
    onChange({ message, messageEdited: true });
    if (cursor !== undefined)
      requestAnimationFrame(() => areaRef.current?.setSelectionRange(cursor, cursor));
  };
  const list = (numbered: boolean) => {
    if (!areaRef.current) return;
    const { text, cursor } = insertAround(areaRef.current, draft.message, (lines) =>
      lines
        .split('\n')
        .map((line, n) => `${numbered ? `${n + 1}.` : '•'} ${line.replace(/^(•|\d+\.)\s/, '')}`)
        .join('\n'),
    );
    write(text, cursor);
    areaRef.current.focus();
  };
  const tool =
    'inline-flex size-9 items-center justify-center rounded-control text-heading hover:bg-canvas';

  return (
    <Section title={`${number}. Message to Recipient`} testId="message">
      <Input
        label="Subject Line *"
        value={draft.subject}
        maxLength={200}
        error={errors['subject']}
        onChange={(e) => onChange({ subject: e.target.value, subjectEdited: true })}
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="request-message" className="text-sm font-semibold text-heading">
            Message<span className="text-danger"> *</span>
          </label>
          <button
            type="button"
            onClick={onPreview}
            className="text-sm font-medium text-action underline"
          >
            Preview
          </button>
        </div>
        <div
          className={`rounded-control border bg-surface ${errors['message'] ? 'border-danger' : 'border-border'}`}
        >
          <div
            role="toolbar"
            aria-label="Message tools"
            className="flex gap-1 border-b border-divider p-1"
          >
            <button
              type="button"
              className={tool}
              aria-label="Bulleted list"
              onClick={() => list(false)}
            >
              <ListBullets aria-hidden weight="bold" className="size-5" />
            </button>
            <button
              type="button"
              className={tool}
              aria-label="Numbered list"
              onClick={() => list(true)}
            >
              <ListNumbers aria-hidden weight="bold" className="size-5" />
            </button>
            <button
              type="button"
              className={tool}
              aria-label="Insert link"
              onClick={() => {
                setUrl('');
                setUrlError('');
                setLinking(true);
              }}
            >
              <LinkSimple aria-hidden weight="bold" className="size-5" />
            </button>
          </div>
          <textarea
            id="request-message"
            ref={areaRef}
            rows={14}
            value={draft.message}
            aria-invalid={Boolean(errors['message'])}
            aria-describedby="request-message-count"
            onChange={(e) => write(e.target.value)}
            className="block w-full resize-y bg-transparent px-3 py-2 text-sm leading-6 text-text outline-none"
          />
        </div>
        <div className="flex justify-between gap-2 text-xs">
          <span className="font-medium text-danger">{errors['message'] ?? ''}</span>
          <span
            id="request-message-count"
            className={draft.message.length > MESSAGE_MAX ? 'text-danger' : 'text-muted'}
          >
            {draft.message.length}/{MESSAGE_MAX}
          </span>
        </div>
      </div>
      <Modal
        open={linking}
        title="Insert Link"
        onClose={() => setLinking(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLinking(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const clean = url.trim();
                if (!/^https:\/\/[^\s]+\.[^\s]+$/.test(clean))
                  return setUrlError('Enter a full link that starts with https://');
                const at = areaRef.current?.selectionStart ?? draft.message.length;
                const text = `${draft.message.slice(0, at)}${clean}${draft.message.slice(at)}`;
                write(text, at + clean.length);
                setLinking(false);
              }}
            >
              Insert
            </Button>
          </>
        }
      >
        <Input
          label="Link"
          type="url"
          autoFocus
          value={url}
          maxLength={500}
          error={urlError || undefined}
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
        />
      </Modal>
    </Section>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex text-heading">
      <Info aria-hidden weight="bold" className="size-5" />
      <span className="sr-only">{text}</span>
    </span>
  );
}

function OptionRow({
  label,
  checked,
  onChange,
  hint,
  children,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
  hint?: string;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-h-10 items-center gap-3">
      <Toggle checked={checked} onChange={onChange} label="" aria-labelledby={id} />
      <span id={id} className="min-w-0 text-sm text-heading">
        {label}
      </span>
      {hint ? <Hint text={hint} /> : null}
      {children ? <span className="ml-auto w-56 max-w-[55%] shrink-0">{children}</span> : null}
    </div>
  );
}

/** 5. Additional Options. */
export function OptionsSection({
  draft,
  onChange,
  errors,
  number = 5,
}: {
  draft: RequestDraft;
  onChange: Patch;
  errors: DraftErrors;
  number?: number;
}) {
  return (
    <Section title={`${number}. Additional Options`} testId="options">
      <div className="flex flex-col gap-1">
        <OptionRow
          label="Send email notification"
          checked={draft.notifyEmail}
          onChange={(notifyEmail) => onChange({ notifyEmail })}
        />
        <OptionRow
          label="Send portal notification"
          checked={draft.notifyPortal}
          onChange={(notifyPortal) => onChange({ notifyPortal })}
        />
        <OptionRow
          label={
            <>
              Send SMS notification <span className="text-muted">(if available)</span>
            </>
          }
          hint="Only when the client can receive texts from your firm."
          checked={draft.notifySms}
          onChange={(notifySms) => onChange({ notifySms })}
        />
        <OptionRow
          label="Set reminder"
          checked={draft.reminder}
          onChange={(reminder) => onChange({ reminder })}
        >
          <Select
            label="Reminder"
            hideLabel
            disabled={!draft.reminder}
            value={String(draft.reminderDays)}
            onChange={(e) => onChange({ reminderDays: Number(e.target.value) })}
            options={[...new Set<number>([...REMINDER_DAYS, draft.reminderDays])]
              .sort((a, b) => a - b)
              .map((d) => ({
                value: String(d),
                label: `${d} ${d === 1 ? 'day' : 'days'} before due date`,
              }))}
          />
        </OptionRow>
        <OptionRow
          label="Allow multiple file uploads"
          checked={draft.allowMultipleFiles}
          onChange={(allowMultipleFiles) => onChange({ allowMultipleFiles })}
        />
        <OptionRow
          label="Allow comments from client"
          checked={draft.allowClientComments}
          onChange={(allowClientComments) => onChange({ allowClientComments })}
        />
        <OptionRow
          label="Set request expiration (optional)"
          hint="After this date the request shows as Expired."
          checked={draft.expires}
          onChange={(expires) => onChange({ expires })}
        />
        {draft.expires ? (
          <div className="pl-14">
            <Input
              label="Expires On"
              type="date"
              value={draft.expiresOn}
              error={errors['expiresOn']}
              onChange={(e) => onChange({ expiresOn: e.target.value })}
            />
          </div>
        ) : null}
      </div>
    </Section>
  );
}
