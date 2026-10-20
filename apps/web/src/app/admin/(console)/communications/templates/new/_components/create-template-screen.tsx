'use client';

import {
  ArrowLeft,
  ArrowsOut,
  CaretDown,
  ChatCircleDots,
  Check,
  CloudArrowUp,
  Copy,
  EnvelopeSimple,
  FloppyDisk,
  Image as ImageIcon,
  LinkSimple,
  ListBullets,
  ListNumbers,
  Paperclip,
  PaperPlaneTilt,
  TextB,
  TextItalic,
  TextUnderline,
  type Icon,
  X,
} from '@phosphor-icons/react';
import { Badge, Button, Card, Input, Select } from '@firmivra/ui';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import firmivraLogoWhite from '../../../../../../../components/app-shell/firmivra-logo-white.png';
import {
  ADMIN_COMM_ERRORS,
  ADMIN_COMM_MERGE_FIELDS,
  type AdminCommMedia,
  type AdminCommTemplate,
} from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';

type Channel = 'EMAIL' | 'SMS';
type ActivePopup = 'status' | 'subject-merge' | 'body-merge' | 'image' | 'save' | null;
type Notice = { tone: 'info' | 'success' | 'error'; text: string };
type FieldError = Partial<Record<'name' | 'category' | 'subject' | 'body', string>>;

interface TemplateForm {
  name: string;
  categoryId: string;
  subject: string;
  body: string;
}
const blankForm: TemplateForm = { name: '', categoryId: '', subject: '', body: '' };

/** The contract's merge fields, as the editor inserts them. */
const MERGE_FIELDS = Object.entries(ADMIN_COMM_MERGE_FIELDS).map(([key, field]) => ({
  token: `{{${key}}}`,
  label: field.label,
  sample: field.sample,
}));
const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A saved template's text in the editor: one paragraph per blank line. */
const htmlFromText = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br />')}</p>`)
    .join('');
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** Puts an image in the communications library (B6): a ticket, then the file to storage. */
async function uploadLibraryImage(file: File): Promise<AdminCommMedia> {
  const sha256 = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const ticket = await api.adminBroadcasts.media.create({
    kind: 'INLINE_IMAGE',
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    sha256,
  });
  // The mock's ticket has no storage behind it.
  if (!ticket.uploadUrl.startsWith('mock:')) {
    const stored = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: file,
    });
    if (!stored.ok) throw new Error('The image could not be stored. Try again.');
  }
  return ticket.media;
}

const textFromHtml = (html: string) =>
  html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();

function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-text">
      {children} <span className="text-danger">*</span>
    </label>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-control text-text hover:bg-info-soft hover:text-action focus-visible:outline-2 focus-visible:outline-focus"
    >
      <Icon aria-hidden weight="fill" className="size-4" />
    </button>
  );
}

function LibraryThumbnail({ image }: { image: AdminCommMedia }) {
  return (
    <span className="flex h-13 flex-col items-center justify-center gap-0.5 rounded-control bg-info-soft px-1 text-action">
      <ImageIcon aria-hidden weight="fill" className="size-6" />
      <span className="w-full truncate text-center text-xs text-text">{image.fileName}</span>
    </span>
  );
}

function InsertImagePopover({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (fileName: string) => void;
}) {
  const [tab, setTab] = useState<'upload' | 'library'>('upload');
  const [uploading, setUploading] = useState(false);
  const library = useApiQuery(['admin-communications', 'media', 'INLINE_IMAGE'], () =>
    api.adminBroadcasts.media.list({ kind: 'INLINE_IMAGE', pageSize: 24 }),
  );
  const images = (library.data?.items ?? []).filter((m) => m.scanStatus === 'CLEAN');
  const insert = async () => {
    if (selectedFile && selectedImage === 'uploaded') {
      setUploading(true);
      try {
        const media = await uploadLibraryImage(selectedFile);
        onInsert(media.fileName);
      } catch (e) {
        setError(errorMessage(e, ADMIN_COMM_ERRORS));
      } finally {
        setUploading(false);
      }
      return;
    }
    const image = images.find((m) => m.id === selectedImage);
    if (image) onInsert(image.fileName);
  };
  const [selectedImage, setSelectedImage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File>();
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const acceptFile = (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPG, GIF, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Images must be 5 MB or smaller.');
      return;
    }
    setError('');
    setSelectedFile(file);
    setSelectedImage('uploaded');
  };

  const dropImage = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    acceptFile(event.dataTransfer.files.item(0) ?? undefined);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="insert-image-title"
      aria-modal="false"
      className="absolute top-full left-1/2 z-30 mt-1 w-96 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-card border border-border bg-surface p-4 text-text shadow-lg max-sm:fixed max-sm:top-1/2 max-sm:left-1/2 max-sm:mt-0 max-sm:w-[calc(100vw-2rem)] max-sm:max-w-md max-sm:-translate-y-1/2"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="insert-image-title" className="font-display text-base font-bold text-heading">
          Insert Image
        </h3>
        <button
          type="button"
          aria-label="Close image dialog"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-info-soft hover:text-action"
        >
          <X aria-hidden weight="bold" className="size-4" />
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Image source"
        className="mt-3 grid grid-cols-2 border-b border-border"
      >
        {(['upload', 'library'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`min-h-9 border-b-2 px-2 text-xs font-medium ${tab === value ? 'border-action text-action' : 'border-transparent text-muted hover:text-action'}`}
          >
            {value === 'upload' ? 'Upload Image' : 'Choose from Library'}
          </button>
        ))}
      </div>

      {tab === 'upload' ? (
        <div className="mt-3">
          <input
            ref={fileRef}
            id="template-inline-image"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            aria-label="Upload image"
            className="sr-only"
            onChange={(event) => acceptFile(event.currentTarget.files?.[0])}
          />
          <label
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropImage}
            htmlFor="template-inline-image"
            className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-control border border-dashed border-control-border bg-subtle px-3 py-3 text-center hover:bg-info-soft"
          >
            <CloudArrowUp aria-hidden weight="fill" className="size-7 text-action" />
            <span className="mt-1 text-xs font-medium text-text">Drag and drop an image here</span>
            <span className="text-xs text-muted">
              or <span className="text-link">click to upload</span>
            </span>
            <span className="mt-1 text-xs text-muted">PNG, JPG, GIF, or WebP (Max 5 MB)</span>
          </label>
          {selectedFile ? (
            <p className="mt-1 truncate text-xs text-muted">{selectedFile.name}</p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-between">
            <h4 className="text-xs font-medium text-text">Recently Used Images</h4>
            <button
              type="button"
              onClick={() => setTab('library')}
              className="text-xs font-medium text-link hover:underline"
            >
              View All <span aria-hidden>›</span>
            </button>
          </div>
          <LibraryGrid
            images={images.slice(0, 4)}
            selected={selectedImage}
            onSelect={setSelectedImage}
            compact
          />
        </div>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted">Choose a recently used image to insert.</p>
          <LibraryGrid images={images} selected={selectedImage} onSelect={setSelectedImage} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <Button variant="outline" className="min-h-9 px-3 py-1.5" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="min-h-9 px-3 py-1.5"
          disabled={!selectedImage || uploading}
          onClick={() => void insert()}
        >
          Insert Image
          <CaretDown aria-hidden weight="bold" className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function LibraryGrid({
  images,
  selected,
  onSelect,
  compact = false,
}: {
  images: AdminCommMedia[];
  selected: string;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`mt-2 grid grid-cols-4 gap-2 ${compact ? '' : 'gap-3'}`}>
      {!images.length ? (
        <p className="col-span-4 py-2 text-xs text-muted">No images in the library yet.</p>
      ) : null}
      {images.map((image) => (
        <button
          key={image.id}
          type="button"
          aria-label={`Select ${image.fileName} image`}
          aria-pressed={selected === image.id}
          onClick={() => onSelect(image.id)}
          className={`min-w-0 rounded-control p-0.5 text-left focus-visible:outline-2 focus-visible:outline-focus ${selected === image.id ? 'ring-2 ring-action' : 'hover:bg-info-soft'}`}
        >
          <LibraryThumbnail image={image} />
        </button>
      ))}
    </div>
  );
}

/** Create Template, or Edit Template with `templateId` (the editor opens once it has loaded). */
export function CreateTemplateScreen({ templateId }: { templateId?: string } = {}) {
  const existing = useApiQuery(
    ['admin-communications', 'templates', 'one', templateId ?? 'new'],
    () => (templateId ? api.adminCommunications.templates.get(templateId) : Promise.resolve(null)),
  );
  if (templateId && !existing.data)
    return (
      <main data-testid="create-template-screen" className="flex min-w-0 flex-col gap-4">
        <h1 className="font-display text-3xl font-bold text-heading">Edit Template</h1>
        <p role={existing.isError ? 'alert' : 'status'} className="text-sm text-muted">
          {existing.isError
            ? errorMessage(existing.error, ADMIN_COMM_ERRORS)
            : 'Loading the template…'}
        </p>
      </main>
    );
  return <TemplateEditor key={existing.data?.id ?? 'new'} template={existing.data ?? null} />;
}

function TemplateEditor({ template }: { template: AdminCommTemplate | null }) {
  const router = useRouter();
  const client = useQueryClient();
  const searchParams = useSearchParams();
  const editing = template !== null;
  const categories = useApiQuery(['admin-communications', 'categories'], () =>
    api.adminCommunications.categories.list(),
  );
  const apiUnavailable = categories.isError;
  const [form, setForm] = useState<TemplateForm>(() =>
    template
      ? {
          name: template.name,
          categoryId: template.category.id,
          subject: template.subject ?? '',
          body: template.channel === 'EMAIL' ? htmlFromText(template.body) : template.body,
        }
      : blankForm,
  );
  const [channel, setChannel] = useState<Channel>(
    template?.channel ?? (searchParams.get('channel') === 'SMS' ? 'SMS' : 'EMAIL'),
  );
  const [status, setStatus] = useState(template?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldError>({});
  const [notice, setNotice] = useState<Notice>();
  const [previewTab, setPreviewTab] = useState<'preview' | 'fields'>('preview');
  const [activePopup, setActivePopup] = useState<ActivePopup>(null);
  const [mergeTarget, setMergeTarget] = useState<'subject' | 'body'>('body');
  const [fullscreen, setFullscreen] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const initialSubjectCursorRef = useRef(0);

  useEffect(() => {
    const editor = bodyRef.current;
    if (editor && editor.innerHTML !== form.body) editor.innerHTML = form.body;
  }, [form.body]);

  useEffect(() => {
    const closePopupOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-template-popup]')) {
        return;
      }
      setActivePopup(null);
    };

    document.addEventListener('pointerdown', closePopupOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closePopupOnOutsideClick);
  }, []);

  const updateForm = <K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const insertMergeField = (token: string) => {
    setActivePopup(null);
    if (mergeTarget === 'subject' && subjectRef.current) {
      const input = subjectRef.current;
      const start = input.selectionStart ?? initialSubjectCursorRef.current;
      const end = input.selectionEnd ?? start;
      const next = `${form.subject.slice(0, start)}${token}${form.subject.slice(end)}`;
      updateForm('subject', next);
      initialSubjectCursorRef.current = start + token.length;
      input.focus();
      return;
    }
    bodyRef.current?.focus();
    document.execCommand('insertText', false, token);
    if (bodyRef.current) updateForm('body', bodyRef.current.innerHTML);
  };

  const applyFormat = (command: string, value?: string) => {
    bodyRef.current?.focus();
    document.execCommand(command, false, value);
    if (bodyRef.current) updateForm('body', bodyRef.current.innerHTML);
  };

  /** A template is text (B6): an image goes in as a reference to its library file. */
  const insertImage = (fileName: string) => {
    applyFormat('insertText', `[Image: ${fileName}]`);
    setActivePopup(null);
  };

  const saveTemplate = async (nextStatus = status) => {
    setActivePopup(null);
    const nextErrors: FieldError = {};
    const body = channel === 'EMAIL' ? textFromHtml(form.body) : form.body.trim();
    if (!form.name.trim()) nextErrors.name = 'Enter a template name.';
    if (!form.categoryId) nextErrors.category = 'Choose a category.';
    if (channel === 'EMAIL' && !form.subject.trim()) nextErrors.subject = 'Enter a subject.';
    if (!body) nextErrors.body = 'Enter a message body.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      const fields = {
        categoryId: form.categoryId,
        name: form.name.trim(),
        body,
        status: nextStatus as 'ACTIVE' | 'INACTIVE',
      };
      if (template)
        await api.adminCommunications.templates.update(template.id, {
          ...fields,
          subject: channel === 'EMAIL' ? form.subject.trim() : null,
        });
      else
        await api.adminCommunications.templates.create({
          ...fields,
          channel,
          ...(channel === 'EMAIL' ? { subject: form.subject.trim() } : {}),
        });
      await client.invalidateQueries({ queryKey: ['admin-communications'] });
      router.push('/communications/templates');
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error, ADMIN_COMM_ERRORS) });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!template) {
      setNotice({ tone: 'info', text: 'Save the template first, then send yourself a test.' });
      return;
    }
    try {
      const sent = await api.adminCommunications.templates.test(template.id);
      setNotice({ tone: 'success', text: `Test sent to ${sent.sentTo}.` });
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error, ADMIN_COMM_ERRORS) });
    }
  };

  const copyAllMergeFields = () => {
    void navigator.clipboard?.writeText(MERGE_FIELDS.map((field) => field.token).join('\n'));
    setNotice({ tone: 'success', text: 'Merge field tokens copied.' });
  };

  const fill = (text: string) =>
    MERGE_FIELDS.reduce((out, field) => out.replaceAll(field.token, field.sample), text);
  const previewBody = fill(channel === 'EMAIL' ? textFromHtml(form.body) : form.body);
  const previewName = ADMIN_COMM_MERGE_FIELDS['contact.name'].sample;

  return (
    <main data-testid="create-template-screen" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1.5">
        <Link
          href="/communications/templates"
          className="flex w-fit items-center gap-1.5 text-sm font-medium text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Templates
        </Link>
        <div>
          <h1 className="font-display text-3xl font-bold text-heading">
            {editing ? 'Edit Template' : 'Create Template'}
          </h1>
          <p className="text-base text-muted">
            {editing
              ? 'Change a reusable message template. Its channel stays as it was created.'
              : 'Create a reusable message template for email or SMS communications.'}
          </p>
        </div>
      </header>

      {apiUnavailable ? (
        <div
          role="alert"
          data-testid="template-api-error"
          className="rounded-control border border-danger bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          The template service is unavailable. The editor and preview remain available.
        </div>
      ) : null}
      {!editing ? (
        <p data-testid="template-empty-state" className="text-xs text-muted">
          Start with a blank template. Required fields are marked with an asterisk.
        </p>
      ) : null}
      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-control px-3 py-2 text-sm ${notice.tone === 'error' ? 'bg-danger-soft text-danger' : notice.tone === 'success' ? 'bg-success-soft text-success' : 'bg-info-soft text-info'}`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.33fr)_minmax(0,1fr)]">
        <Card className="relative z-20 flex min-w-0 flex-col gap-4 overflow-visible p-5">
          <div className="grid min-w-0 gap-x-4 gap-y-4 sm:grid-cols-2">
            <div className="min-w-0">
              <FieldLabel htmlFor="template-name">Template Name</FieldLabel>
              <Input
                id="template-name"
                label="Template Name"
                hideLabel
                value={form.name}
                maxLength={200}
                placeholder="Enter a template name"
                error={errors.name}
                onChange={(event) => updateForm('name', event.currentTarget.value)}
              />
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor="template-category">Category</FieldLabel>
              <Select
                id="template-category"
                label="Category"
                hideLabel
                value={form.categoryId}
                error={errors.category}
                onChange={(event) => updateForm('categoryId', event.currentTarget.value)}
                options={[
                  { value: '', label: 'Select a category' },
                  ...(categories.data?.items ?? [])
                    .filter((c) => c.isActive || c.id === form.categoryId)
                    .map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>

            <fieldset className="min-w-0">
              <legend className="mb-1 text-sm font-medium text-text">
                Channel <span className="text-danger">*</span>
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="outline"
                  aria-pressed={channel === 'EMAIL'}
                  disabled={editing && channel !== 'EMAIL'}
                  onClick={() => setChannel('EMAIL')}
                  className={`min-h-10 px-3 py-1.5 ${channel === 'EMAIL' ? 'border-action bg-info-soft text-action' : 'border-border bg-surface text-text'}`}
                >
                  <EnvelopeSimple aria-hidden weight="fill" className="size-5" /> Email
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-pressed={channel === 'SMS'}
                  disabled={editing && channel !== 'SMS'}
                  onClick={() => setChannel('SMS')}
                  className={`min-h-10 px-3 py-1.5 ${channel === 'SMS' ? 'border-action bg-info-soft text-action' : 'border-border bg-surface text-text'}`}
                >
                  <ChatCircleDots aria-hidden weight="fill" className="size-5" /> SMS
                </Button>
              </div>
            </fieldset>

            <div className="min-w-0">
              <label htmlFor="template-status" className="mb-1 block text-sm font-medium text-text">
                Status
              </label>
              <div
                data-template-popup
                className={`relative ${activePopup === 'status' ? 'z-50' : activePopup ? 'z-40' : ''}`}
              >
                <Button
                  id="template-status"
                  type="button"
                  variant="outline"
                  aria-label="Status"
                  aria-haspopup="listbox"
                  aria-expanded={activePopup === 'status'}
                  onClick={() => setActivePopup((popup) => (popup === 'status' ? null : 'status'))}
                  className="h-10 w-full !justify-between px-3 py-1.5 text-sm"
                >
                  <Badge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </Badge>
                  <CaretDown aria-hidden weight="bold" className="size-4 text-muted" />
                </Button>
                {activePopup === 'status' ? (
                  <div
                    role="listbox"
                    aria-label="Status options"
                    className="absolute top-full left-0 z-30 mt-1 w-full rounded-card border border-border bg-surface p-1 shadow-lg"
                  >
                    {(['ACTIVE', 'INACTIVE'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={status === option}
                        onClick={() => {
                          setStatus(option);
                          setActivePopup(null);
                        }}
                        className="flex min-h-9 w-full items-center rounded-control px-3 text-left text-sm text-text hover:bg-info-soft hover:text-action focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        {option === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {channel === 'EMAIL' ? (
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <FieldLabel htmlFor="template-subject">Subject</FieldLabel>
                  <input
                    id="template-subject"
                    ref={subjectRef}
                    value={form.subject}
                    maxLength={200}
                    placeholder="Enter an email subject"
                    aria-invalid={!!errors.subject}
                    aria-describedby={errors.subject ? 'template-subject-error' : undefined}
                    onFocus={() => setMergeTarget('subject')}
                    onSelect={(event) => {
                      initialSubjectCursorRef.current =
                        event.currentTarget.selectionStart ?? form.subject.length;
                    }}
                    onChange={(event) => updateForm('subject', event.currentTarget.value)}
                    className={`min-h-10 min-w-0 w-full rounded-control border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-focus ${errors.subject ? 'border-danger' : 'border-border'}`}
                  />
                  {errors.subject ? (
                    <p id="template-subject-error" className="text-xs text-danger">
                      {errors.subject}
                    </p>
                  ) : null}
                </div>
                <div
                  data-template-popup
                  className={`relative shrink-0 ${activePopup ? 'z-40' : ''}`}
                >
                  <Button
                    variant="secondary"
                    aria-expanded={activePopup === 'subject-merge'}
                    onClick={() => {
                      setMergeTarget('subject');
                      setActivePopup((popup) =>
                        popup === 'subject-merge' ? null : 'subject-merge',
                      );
                    }}
                    className="min-h-10 w-full px-3 py-1.5 text-sm sm:w-auto"
                  >
                    Insert Merge Field
                    <CaretDown aria-hidden weight="bold" className="size-4" />
                  </Button>
                  {activePopup === 'subject-merge' ? (
                    <MergeFieldMenu onSelect={insertMergeField} />
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <section className="min-w-0" aria-labelledby="message-body-label">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 id="message-body-label" className="text-sm font-medium text-text">
                Message Body <span className="text-danger">*</span>
              </h2>
              {errors.body ? <span className="text-xs text-danger">{errors.body}</span> : null}
            </div>
            <div
              className={`relative overflow-visible rounded-control border bg-surface ${errors.body ? 'border-danger' : 'border-border'} ${fullscreen ? 'fixed inset-4 z-40 flex flex-col bg-surface p-3 shadow-lg' : ''}`}
            >
              {channel === 'EMAIL' ? (
                <div
                  role="toolbar"
                  aria-label="Message body formatting"
                  className="relative flex min-w-0 flex-wrap items-center gap-0 border-b border-border bg-subtle px-1.5 py-1"
                >
                  <select
                    aria-label="Text style"
                    defaultValue="p"
                    onChange={(event) => applyFormat('formatBlock', event.currentTarget.value)}
                    className="h-7 max-w-24 rounded-control border border-border bg-surface px-1.5 text-xs text-text"
                  >
                    <option value="p">Paragraph</option>
                    <option value="h3">Heading</option>
                    <option value="h4">Subheading</option>
                  </select>
                  <span className="mx-0.5 h-5 border-l border-border" />
                  <ToolbarButton icon={TextB} label="Bold" onClick={() => applyFormat('bold')} />
                  <ToolbarButton
                    icon={TextItalic}
                    label="Italic"
                    onClick={() => applyFormat('italic')}
                  />
                  <ToolbarButton
                    icon={TextUnderline}
                    label="Underline"
                    onClick={() => applyFormat('underline')}
                  />
                  <span className="mx-0.5 h-5 border-l border-border" />
                  <ToolbarButton
                    icon={ListBullets}
                    label="Bulleted list"
                    onClick={() => applyFormat('insertUnorderedList')}
                  />
                  <ToolbarButton
                    icon={ListNumbers}
                    label="Numbered list"
                    onClick={() => applyFormat('insertOrderedList')}
                  />
                  <ToolbarButton
                    icon={ListBullets}
                    label="Increase indent"
                    onClick={() => applyFormat('indent')}
                  />
                  <span className="mx-0.5 h-5 border-l border-border" />
                  <ToolbarButton
                    icon={LinkSimple}
                    label="Insert link"
                    onClick={() => {
                      const url = window.prompt('Enter a secure https:// link');
                      if (url?.startsWith('https://')) applyFormat('createLink', url);
                    }}
                  />
                  <span data-template-popup className={`relative ${activePopup ? 'z-40' : ''}`}>
                    <ToolbarButton
                      icon={ImageIcon}
                      label="Insert image"
                      onClick={() =>
                        setActivePopup((popup) => (popup === 'image' ? null : 'image'))
                      }
                    />
                    {activePopup === 'image' ? (
                      <InsertImagePopover
                        onClose={() => setActivePopup(null)}
                        onInsert={insertImage}
                      />
                    ) : null}
                  </span>
                  <div data-template-popup className={`relative ${activePopup ? 'z-40' : ''}`}>
                    <Button
                      variant="secondary"
                      aria-expanded={activePopup === 'body-merge'}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setMergeTarget('body');
                        setActivePopup((popup) => (popup === 'body-merge' ? null : 'body-merge'));
                      }}
                      className="min-h-7 px-1.5 py-1 text-xs"
                    >
                      Insert Merge Field{' '}
                      <CaretDown aria-hidden weight="bold" className="size-3.5" />
                    </Button>
                    {activePopup === 'body-merge' ? (
                      <MergeFieldMenu onSelect={insertMergeField} />
                    ) : null}
                  </div>
                  <ToolbarButton
                    icon={ArrowsOut}
                    label={fullscreen ? 'Exit full screen' : 'Full screen'}
                    onClick={() => setFullscreen((open) => !open)}
                  />
                </div>
              ) : null}
              {channel === 'EMAIL' ? (
                <div className="relative">
                  {!form.body ? (
                    <span className="pointer-events-none absolute top-3 left-4 text-sm text-muted">
                      Start typing your message here...
                    </span>
                  ) : null}
                  <div
                    ref={bodyRef}
                    role="textbox"
                    aria-label="Message Body *"
                    aria-multiline="true"
                    aria-required="true"
                    contentEditable
                    suppressContentEditableWarning
                    onFocus={() => setMergeTarget('body')}
                    onInput={(event) => updateForm('body', event.currentTarget.innerHTML)}
                    onPaste={(event) => {
                      event.preventDefault();
                      document.execCommand(
                        'insertText',
                        false,
                        event.clipboardData.getData('text/plain'),
                      );
                      updateForm('body', event.currentTarget.innerHTML);
                    }}
                    className={`min-h-56 overflow-auto px-4 py-3 text-sm leading-6 text-text focus:outline-none ${fullscreen ? 'flex-1' : ''} [&_a]:text-link [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6`}
                  />
                </div>
              ) : (
                <textarea
                  aria-label="Message Body *"
                  aria-required="true"
                  value={textFromHtml(form.body)}
                  onChange={(event) => updateForm('body', event.currentTarget.value)}
                  placeholder="Type your SMS message here..."
                  className="min-h-56 w-full resize-y rounded-control px-4 py-3 text-sm leading-6 text-text placeholder:text-muted focus:outline-none"
                />
              )}
            </div>
          </section>

          <section className="min-w-0" aria-labelledby="attachments-label">
            <h2 id="attachments-label" className="mb-1 text-sm font-medium text-text">
              Attachments (Optional)
            </h2>
            <div className="flex min-h-20 items-center gap-3 rounded-control border border-dashed border-control-border bg-subtle px-4 py-3 text-sm text-muted">
              <Paperclip aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
              <span>
                A template is the message text. Files are added to a broadcast when it is sent.
              </span>
            </div>
          </section>

          <footer className="mt-auto flex flex-col-reverse items-stretch justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
            <Link
              href="/communications/templates"
              className="inline-flex min-h-11 items-center justify-center rounded-control border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-canvas"
            >
              Cancel
            </Link>
            <div
              data-template-popup
              className={`relative flex w-full sm:w-auto ${activePopup ? 'z-40' : ''}`}
            >
              <Button
                onClick={() => void saveTemplate()}
                className="w-full rounded-r-none sm:w-auto"
                disabled={saving}
              >
                <FloppyDisk aria-hidden weight="fill" className="size-4" /> Save Template
              </Button>
              <Button
                variant="secondary"
                aria-label="More save options"
                aria-expanded={activePopup === 'save'}
                onClick={() => setActivePopup((popup) => (popup === 'save' ? null : 'save'))}
                disabled={saving}
                className="min-h-11 rounded-l-none border-l-0 px-3"
              >
                <CaretDown aria-hidden weight="bold" className="size-4" />
              </Button>
              {activePopup === 'save' ? (
                <div className="absolute right-0 bottom-full z-20 mb-1 w-48 rounded-card border border-border bg-surface p-1 shadow-lg">
                  {(['Save as Inactive', 'Save and Activate'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        void saveTemplate(option === 'Save as Inactive' ? 'INACTIVE' : 'ACTIVE')
                      }
                      className="w-full rounded-control px-3 py-2 text-left text-sm text-text hover:bg-info-soft"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </footer>
        </Card>

        <aside className="flex min-w-0 flex-col gap-3">
          <div
            role="tablist"
            aria-label="Template details"
            className="grid grid-cols-2 rounded-card border border-border bg-surface px-3"
          >
            {(['preview', 'fields'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={previewTab === tab}
                onClick={() => setPreviewTab(tab)}
                className={`min-h-12 border-b-2 px-3 text-sm font-medium ${previewTab === tab ? 'border-action text-action' : 'border-transparent text-text hover:text-action'}`}
              >
                {tab === 'preview' ? 'Preview' : 'Merge Fields'}
              </button>
            ))}
          </div>

          {previewTab === 'preview' ? (
            <Card className="flex min-w-0 flex-col gap-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-bold text-heading">
                  {channel === 'EMAIL' ? 'Email Preview' : 'SMS Preview'}
                </h2>
                <Button
                  variant="secondary"
                  onClick={() => void sendTest()}
                  className="min-h-9 px-3 py-1.5 text-xs"
                >
                  <PaperPlaneTilt aria-hidden weight="fill" className="size-4" /> Send Test
                </Button>
              </div>
              <div className="overflow-hidden rounded-control border border-border bg-surface">
                {channel === 'EMAIL' ? (
                  <>
                    <div className="bg-info-soft px-3 py-3 text-sm text-text">
                      <span className="font-semibold">Subject:</span>{' '}
                      {form.subject ? (
                        fill(form.subject)
                      ) : (
                        <span className="text-muted">No subject added</span>
                      )}
                    </div>
                    <div className="space-y-4 px-4 py-4 text-sm leading-6 text-text">
                      <div className="flex h-20 items-center justify-center rounded-control bg-navigation px-4">
                        <Image
                          src={firmivraLogoWhite}
                          alt="Firmivra Super Admin Portal"
                          className="h-auto max-h-14 w-48 object-contain"
                        />
                      </div>
                      {previewBody ? (
                        <div className="space-y-3 whitespace-pre-line">{previewBody}</div>
                      ) : (
                        <p className="text-muted">
                          Your email preview will appear here as you write.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="bg-subtle p-4">
                    <div className="ml-auto max-w-[85%] rounded-card bg-info-soft p-3 text-sm leading-6 text-text">
                      {previewBody || 'Your SMS preview will appear here as you write.'}
                    </div>
                    <p className="mt-2 text-right text-xs text-muted">Preview for {previewName}</p>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <MergeFieldsCard onCopy={copyAllMergeFields} onSelect={insertMergeField} />
          )}

          {previewTab === 'preview' ? (
            <MergeFieldsCard onCopy={copyAllMergeFields} onSelect={insertMergeField} />
          ) : (
            <Card className="flex min-h-28 items-center gap-3 p-4 text-sm text-muted">
              <EnvelopeSimple aria-hidden weight="fill" className="size-5 text-info" />
              Select Preview to return to the message preview.
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}

function MergeFieldMenu({ onSelect }: { onSelect: (token: string) => void }) {
  return (
    <div
      data-testid="template-merge-field-menu"
      className="absolute top-full right-0 z-30 mt-1 max-h-64 w-64 overflow-auto rounded-card border border-border bg-surface p-2 shadow-lg"
    >
      {MERGE_FIELDS.map((field) => (
        <button
          key={field.token}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(field.token)}
          className="flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-xs hover:bg-info-soft"
        >
          <span className="font-mono text-link">{field.token}</span>
          <span className="truncate text-muted">{field.label}</span>
        </button>
      ))}
    </div>
  );
}

function MergeFieldsCard({
  onCopy,
  onSelect,
}: {
  onCopy: () => void;
  onSelect: (token: string) => void;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold text-heading">Available Merge Fields</h2>
        <Button variant="secondary" onClick={onCopy} className="min-h-9 px-3 py-1.5 text-xs">
          <Copy aria-hidden weight="fill" className="size-4" /> Copy All
        </Button>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
        {MERGE_FIELDS.map((field) => (
          <button
            key={field.token}
            type="button"
            onClick={() => onSelect(field.token)}
            className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-center gap-2 rounded-control text-left hover:bg-info-soft"
          >
            <span className="truncate rounded-control bg-info-soft px-2 py-1 text-xs font-medium text-link">
              {field.token}
            </span>
            <span className="truncate text-xs text-text">{field.label}</span>
          </button>
        ))}
      </div>
      <p className="flex items-start gap-2 rounded-control bg-info-soft px-3 py-2 text-xs text-info">
        <Check aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
        Click on any merge field to insert it into your message.
      </p>
    </Card>
  );
}
