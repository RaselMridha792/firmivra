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
  Laptop,
  LinkSimple,
  ListBullets,
  ListNumbers,
  Paperclip,
  PaperPlaneTilt,
  Plant,
  TextB,
  TextItalic,
  TextUnderline,
  type Icon,
  X,
} from '@phosphor-icons/react';
import { ApiRequestError } from '@firmivra/types';
import { Badge, Button, Card, Input, Select } from '@firmivra/ui';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import firmivraLogoWhite from '../../../../../../../components/app-shell/firmivra-logo-white.png';
import {
  createTemplateMock,
  getTemplateCategoryOptions,
  getTemplateLibraryImages,
  getTemplateMergeFields,
  type CreateTemplateMock,
  type TemplateLibraryImageMock,
} from '../../../../../../../mocks/admin-communications-create-template';
import {
  listCommunicationTemplates,
  type CommunicationTemplate,
} from '../../../../../../../mocks/admin-communications-templates';

type Channel = 'EMAIL' | 'SMS';
type ActivePopup = 'status' | 'subject-merge' | 'body-merge' | 'image' | 'save' | null;
type Notice = { tone: 'info' | 'success' | 'error'; text: string };
type FieldError = Partial<Record<'name' | 'category' | 'subject' | 'body', string>>;
type TemplateEditorMode = 'create' | 'edit';
type EditLoadState = 'loading' | 'ready' | 'not-found' | 'unavailable' | 'forbidden';

const blankTemplate = (): CreateTemplateMock => ({
  ...createTemplateMock(),
  name: '',
  category: '',
  subject: '',
  body: '',
});

const templateToForm = (template: CommunicationTemplate): CreateTemplateMock => ({
  ...createTemplateMock(),
  name: template.name,
  category: template.category,
  subject: template.subject,
  body: template.body.replaceAll('\n', '<br />'),
});

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

function LibraryThumbnail({ image }: { image: TemplateLibraryImageMock }) {
  if (image.kind === 'brand') {
    return (
      <span className="flex h-13 items-center justify-center rounded-control bg-navigation px-2">
        <Image src={firmivraLogoWhite} alt="" className="h-auto w-16" />
      </span>
    );
  }
  if (image.kind === 'workspace') {
    return (
      <span className="flex h-13 items-center justify-center rounded-control bg-info-soft text-action">
        <Laptop aria-hidden weight="fill" className="size-7" />
      </span>
    );
  }
  if (image.kind === 'plant') {
    return (
      <span className="flex h-13 items-center justify-center rounded-control bg-success-soft text-success">
        <Plant aria-hidden weight="fill" className="size-7" />
      </span>
    );
  }
  return (
    <span className="flex h-13 items-center justify-center rounded-control border border-border bg-surface text-base font-semibold italic text-heading">
      Welcome
    </span>
  );
}

function InsertImagePopover({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (imageId: string, file?: File) => void;
}) {
  const [tab, setTab] = useState<'upload' | 'library'>('upload');
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
          <LibraryGrid selected={selectedImage} onSelect={setSelectedImage} compact />
        </div>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-xs text-muted">Choose a recently used image to insert.</p>
          <LibraryGrid selected={selectedImage} onSelect={setSelectedImage} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <Button variant="outline" className="min-h-9 px-3 py-1.5" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="min-h-9 px-3 py-1.5"
          disabled={!selectedImage}
          onClick={() => onInsert(selectedImage, selectedFile)}
        >
          Insert Image
          <CaretDown aria-hidden weight="bold" className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function LibraryGrid({
  selected,
  onSelect,
  compact = false,
}: {
  selected: string;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`mt-2 grid grid-cols-4 gap-2 ${compact ? '' : 'gap-3'}`}>
      {getTemplateLibraryImages().map((image) => (
        <button
          key={image.id}
          type="button"
          aria-label={`Select ${image.name} image`}
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

export function CreateTemplateScreen({
  mode = 'create',
  templateId,
}: {
  mode?: TemplateEditorMode;
  templateId?: string;
}) {
  const searchParams = useSearchParams();
  const mockState = searchParams.get('mockState');
  const isEdit = mode === 'edit';
  const [editLoadState, setEditLoadState] = useState<EditLoadState>(() =>
    isEdit ? (templateId ? 'loading' : 'not-found') : 'ready',
  );
  const isEmpty = mockState === 'empty' || (isEdit && editLoadState === 'not-found');
  const apiUnavailable =
    mockState === 'api-unavailable' || (isEdit && editLoadState === 'unavailable');
  const noPermission =
    mockState === 'no-permission' ||
    mockState === 'forbidden' ||
    (isEdit && editLoadState === 'forbidden');
  const [form, setForm] = useState<CreateTemplateMock>(() =>
    isEdit || isEmpty || noPermission ? blankTemplate() : createTemplateMock(),
  );
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [errors, setErrors] = useState<FieldError>({});
  const [notice, setNotice] = useState<Notice>();
  const [previewTab, setPreviewTab] = useState<'preview' | 'fields'>('preview');
  const [activePopup, setActivePopup] = useState<ActivePopup>(null);
  const [mergeTarget, setMergeTarget] = useState<'subject' | 'body'>('body');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [savedAttachments, setSavedAttachments] = useState<string[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const initialSubjectCursorRef = useRef(0);

  useEffect(() => {
    if (!isEdit || !templateId) return;

    let isCurrent = true;
    void listCommunicationTemplates()
      .then((templates) => {
        if (!isCurrent) return;
        const template = templates.find((item) => item.id === templateId);
        if (!template) {
          setForm(blankTemplate());
          setSavedAttachments([]);
          setEditLoadState('not-found');
          return;
        }

        setForm(templateToForm(template));
        setChannel(template.channel);
        setStatus(template.status === 'Archived' ? 'ARCHIVED' : 'ACTIVE');
        setSavedAttachments(template.attachments.map((attachment) => attachment.name));
        setEditLoadState('ready');
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        setForm(blankTemplate());
        setSavedAttachments([]);
        setEditLoadState(
          error instanceof ApiRequestError && error.status === 403 ? 'forbidden' : 'unavailable',
        );
      });

    return () => {
      isCurrent = false;
    };
  }, [isEdit, templateId]);

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

  const updateForm = <K extends keyof CreateTemplateMock>(key: K, value: CreateTemplateMock[K]) =>
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

  const insertImage = (imageId: string, file?: File) => {
    const source = imageId === 'firmivra' ? firmivraLogoWhite.src : undefined;
    if (source) {
      bodyRef.current?.focus();
      document.execCommand('insertImage', false, source);
      if (bodyRef.current) updateForm('body', bodyRef.current.innerHTML);
    } else if (file) {
      setNotice({
        tone: 'info',
        text: `${file.name} is selected for inline placement in the preview.`,
      });
    } else {
      const image = getTemplateLibraryImages().find((item) => item.id === imageId);
      if (image) applyFormat('insertText', `[${image.name} image]`);
    }
    setActivePopup(null);
  };

  const addAttachments = (files: FileList | null) => {
    const accepted = Array.from(files ?? []).filter((file) => file.size <= 10 * 1024 * 1024);
    if (accepted.length) setAttachedFiles((current) => [...current, ...accepted]);
    if (files?.length && accepted.length !== files.length) {
      setNotice({ tone: 'error', text: 'Attachments must be 10 MB or smaller.' });
    }
  };

  const saveTemplate = () => {
    setActivePopup(null);
    const nextErrors: FieldError = {};
    if (!form.name.trim()) nextErrors.name = 'Enter a template name.';
    if (!form.category) nextErrors.category = 'Choose a category.';
    if (channel === 'EMAIL' && !form.subject.trim()) nextErrors.subject = 'Enter a subject.';
    if (!textFromHtml(form.body)) nextErrors.body = 'Enter a message body.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setNotice({
      tone: 'error',
      text: apiUnavailable
        ? 'The Super Admin template service is unavailable. Your work is still on this page.'
        : isEdit
          ? 'Template updates are not connected for the Super Admin console yet. Your work is still on this page.'
          : 'Template saving is not connected for the Super Admin console yet. Your work is still on this page.',
    });
  };

  const copyAllMergeFields = () => {
    void navigator.clipboard?.writeText(
      getTemplateMergeFields()
        .map((field) => field.token)
        .join('\n'),
    );
    setNotice({ tone: 'success', text: 'Merge field tokens copied.' });
  };

  const previewBody = textFromHtml(form.body)
    .replaceAll('{{contact_name}}', createTemplateMock().previewName)
    .replaceAll('{{first_name}}', 'John')
    .replaceAll('{{firm_name}}', 'Firmivra');

  return (
    <main
      data-testid={isEdit ? 'edit-template-screen' : 'create-template-screen'}
      className="flex min-w-0 flex-col gap-4"
    >
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
            {isEdit ? 'Edit Template' : 'Create Template'}
          </h1>
          <p className="text-base text-muted">
            {isEdit
              ? 'Update this reusable message template for email or SMS communications.'
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
          The Super Admin template service is unavailable. The editor and preview remain available.
        </div>
      ) : null}
      {noPermission ? (
        <div
          role="alert"
          data-testid="template-no-permission"
          className="rounded-control border border-warning bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          You don&apos;t have permission to {isEdit ? 'edit' : 'create'} templates. The form layout
          remains available for review.
        </div>
      ) : null}
      {isEmpty ? (
        <p
          data-testid={isEdit ? 'edit-template-empty-state' : 'template-empty-state'}
          className="text-xs text-muted"
        >
          {isEdit
            ? 'This template could not be found. The editor remains available with a blank form.'
            : 'Start with a blank template. Required fields are marked with an asterisk.'}
        </p>
      ) : null}
      {isEdit && editLoadState === 'loading' ? (
        <p role="status" className="text-xs text-muted">
          Loading template details…
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
        <Card
          className={`relative z-20 flex min-w-0 flex-col gap-4 overflow-visible p-5 ${isEdit ? 'self-start' : ''}`}
        >
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
                value={form.category}
                error={errors.category}
                onChange={(event) => updateForm('category', event.currentTarget.value)}
                options={[
                  { value: '', label: 'Select a category' },
                  ...getTemplateCategoryOptions().map((value) => ({ value, label: value })),
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
                  onClick={() => setChannel('EMAIL')}
                  className={`min-h-10 px-3 py-1.5 ${channel === 'EMAIL' ? 'border-action bg-info-soft text-action' : 'border-border bg-surface text-text'}`}
                >
                  <EnvelopeSimple aria-hidden weight="fill" className="size-5" /> Email
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-pressed={channel === 'SMS'}
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
                    {status === 'ACTIVE'
                      ? 'Active'
                      : status === 'ARCHIVED'
                        ? 'Archived'
                        : 'Inactive'}
                  </Badge>
                  <CaretDown aria-hidden weight="bold" className="size-4 text-muted" />
                </Button>
                {activePopup === 'status' ? (
                  <div
                    role="listbox"
                    aria-label="Status options"
                    className="absolute top-full left-0 z-30 mt-1 w-full rounded-card border border-border bg-surface p-1 shadow-lg"
                  >
                    {(isEdit
                      ? (['ACTIVE', 'ARCHIVED'] as const)
                      : (['ACTIVE', 'INACTIVE'] as const)
                    ).map((option) => (
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
                        {option === 'ACTIVE'
                          ? 'Active'
                          : option === 'ARCHIVED'
                            ? 'Archived'
                            : 'Inactive'}
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
            <label className="flex min-h-20 cursor-pointer items-center gap-3 rounded-control border border-dashed border-control-border bg-subtle px-4 py-3 text-sm text-muted hover:bg-info-soft">
              <Paperclip aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
              <span>
                Drag and drop files here, or <span className="text-link">click to upload</span>
                <span className="mt-1 block text-xs">PDF, DOC, DOCX, PNG, JPG (Max 10 MB)</span>
              </span>
              <input
                type="file"
                multiple
                aria-label="Upload attachments"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={(event) => addAttachments(event.currentTarget.files)}
                className="sr-only"
              />
            </label>
            {savedAttachments.length || attachedFiles.length ? (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Selected attachments">
                {savedAttachments.map((name) => (
                  <li
                    key={`saved-${name}`}
                    className="rounded-control bg-info-soft px-2 py-1 text-xs text-text"
                  >
                    {name}
                  </li>
                ))}
                {attachedFiles.map((file) => (
                  <li
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    className="rounded-control bg-info-soft px-2 py-1 text-xs text-text"
                  >
                    {file.name}
                  </li>
                ))}
              </ul>
            ) : null}
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
                onClick={saveTemplate}
                className="w-full rounded-r-none sm:w-auto"
                disabled={noPermission}
              >
                <FloppyDisk aria-hidden weight="fill" className="size-4" />
                Save Template
              </Button>
              <Button
                variant="secondary"
                aria-label="More save options"
                aria-expanded={activePopup === 'save'}
                onClick={() => setActivePopup((popup) => (popup === 'save' ? null : 'save'))}
                disabled={noPermission}
                className="min-h-11 rounded-l-none border-l-0 px-3"
              >
                <CaretDown aria-hidden weight="bold" className="size-4" />
              </Button>
              {activePopup === 'save' ? (
                <div className="absolute right-0 bottom-full z-20 mb-1 w-48 rounded-card border border-border bg-surface p-1 shadow-lg">
                  {(isEdit
                    ? ['Save Changes', 'Save and Archive']
                    : ['Save as Draft', 'Save and Activate']
                  ).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={saveTemplate}
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
                  onClick={() =>
                    setNotice({
                      tone: 'info',
                      text: 'Test sending is not connected for this Super Admin screen.',
                    })
                  }
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
                      {form.subject || <span className="text-muted">No subject added</span>}
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
                    <p className="mt-2 text-right text-xs text-muted">Preview for John Doe</p>
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
      {getTemplateMergeFields().map((field) => (
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
        {getTemplateMergeFields().map((field) => (
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
