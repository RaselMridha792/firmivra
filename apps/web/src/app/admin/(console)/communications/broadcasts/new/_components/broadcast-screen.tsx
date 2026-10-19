'use client';

import {
  Button,
  Card,
  FormField,
  Input,
  Modal,
  PageHeader,
  Radio,
  Select,
  Textarea,
  Toggle,
} from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  ChatCircleDots,
  Check,
  EnvelopeSimple,
  Eye,
  FileText,
  Info,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { PageState } from '../../../../../../../components/page-state';
import { ADMIN_COMM_BROADCAST_ERRORS } from '@firmivra/types';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';
import {
  broadcastChannels,
  channelLabels,
  initialBroadcastDraft,
  readBroadcastDraft,
  saveBroadcastDraft,
  stepHref,
  type BroadcastChannel,
  type BroadcastDraft,
} from './broadcast-draft';
import { BroadcastPanels, BroadcastProgress } from './broadcast-panels';

const channelIcons: Record<BroadcastChannel, Icon> = {
  EMAIL: EnvelopeSimple,
  SMS: ChatCircleDots,
  IN_APP: Bell,
};

/** Step 1. Without `broadcastId` Next makes the draft; with it, the draft's name is saved. */
export function BroadcastScreen({ broadcastId }: { broadcastId?: string }) {
  const router = useRouter();
  // The template categories and the active templates (B6): a template seeds step 3's message.
  const options = useApiQuery(['admin-communications', 'broadcast-options'], async () => {
    const [categories, templates] = await Promise.all([
      api.adminCommunications.categories.list(),
      api.adminCommunications.templates.list({ status: 'ACTIVE', sort: 'NAME', pageSize: 100 }),
    ]);
    return {
      categories: categories.items
        .filter((c) => c.isActive)
        .map((c) => ({ value: c.id, label: c.name })),
      templates: templates.items.map((t) => ({
        id: t.id,
        name: t.name,
        subject: t.subject ?? '',
        message: t.body,
      })),
    };
  });
  const existing = useApiQuery(
    ['admin-communications', 'broadcasts', 'one', broadcastId ?? 'new'],
    () => (broadcastId ? api.adminBroadcasts.broadcasts.get(broadcastId) : Promise.resolve(null)),
  );
  const {
    register,
    control,
    setValue,
    getValues,
    reset,
    handleSubmit,
    formState: { errors, isSubmitted },
  } = useForm<BroadcastDraft>({ defaultValues: initialBroadcastDraft });
  const draft = useWatch({ control }) as BroadcastDraft;
  const allSelected = draft.channels.length === broadcastChannels.length;
  const categories = options.data?.categories ?? [];
  const templates = options.data?.templates ?? [];
  const selectedTemplate = templates.find((template) => template.id === draft.templateId);
  const [dialog, setDialog] = useState<'preview' | 'browse' | null>(null);
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false);
  const loaded = existing.data;
  const segmentId = loaded?.segment?.id ?? '';
  const count = useApiQuery(['admin-communications', 'segment-count', segmentId || 'none'], () =>
    segmentId ? api.adminBroadcasts.segments.count(segmentId) : Promise.resolve(null),
  );

  // An opened draft: its name and channels are the API's; the rest is this tab's (B6 keeps none).
  useEffect(() => {
    const saved = readBroadcastDraft(broadcastId ?? null);
    if (!saved && !loaded) return;
    reset({
      ...initialBroadcastDraft,
      ...saved,
      name: loaded?.name ?? saved?.name ?? '',
      channels: loaded?.channels.length
        ? loaded.channels.map((c) => c.channel)
        : (saved?.channels ?? initialBroadcastDraft.channels),
    });
  }, [reset, broadcastId, loaded]);

  /** Makes the draft (or saves its name) and keeps step 1's other choices; returns its id. */
  async function persist(values: BroadcastDraft): Promise<string | null> {
    const name = values.name.trim();
    setBusy(true);
    try {
      let id = broadcastId ?? null;
      if (id) {
        if (loaded && loaded.name !== name)
          await api.adminBroadcasts.broadcasts.update(id, { name });
      } else id = (await api.adminBroadcasts.broadcasts.create({ name })).id;
      saveBroadcastDraft({ ...values, name }, id);
      setStorageError('');
      return id;
    } catch (error) {
      setStorageError(errorMessage(error, ADMIN_COMM_BROADCAST_ERRORS));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function selectAll(checked: boolean) {
    setValue('channels', checked ? [...broadcastChannels] : [], {
      shouldDirty: true,
      shouldValidate: isSubmitted,
    });
  }

  return (
    <div className="space-y-5 xl:-mt-4" data-testid="broadcast-basic-information">
      <header>
        <Link
          href="/communications/broadcasts"
          aria-label="Cancel and back to broadcasts"
          className="mb-4 inline-flex items-center gap-2 text-sm text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="fill" className="size-4" />
          Back to Broadcasts
        </Link>
        <div data-testid="page-title">
          <PageHeader
            title="Create Broadcast"
            subtitle="Send a message to multiple recipients using email, SMS, or in-app notifications."
          />
        </div>
      </header>

      <BroadcastProgress />

      <div className="grid items-start gap-4 xl:grid-cols-10">
        <Card className="min-w-0 p-0! shadow-none! xl:col-span-7">
          <form
            noValidate
            onSubmit={handleSubmit(async (values) => {
              const id = await persist(values);
              if (id) router.push(stepHref('audience', id));
            })}
          >
            <div className="space-y-4 p-4 sm:p-6">
              <div>
                <h2 className="font-display text-2xl font-bold text-heading">Basic Information</h2>
                <p className="mt-1 text-sm text-muted">
                  Give your broadcast a name and choose how you want to send it.
                </p>
              </div>

              <FormField label="Broadcast Name" htmlFor="broadcast-name" required>
                <Input
                  id="broadcast-name"
                  label="Broadcast Name"
                  hideLabel
                  required
                  placeholder="e.g. Monthly Newsletter, Holiday Update"
                  className="h-11 text-sm! xl:h-9 xl:min-h-9"
                  error={errors.name?.message}
                  {...register('name', {
                    validate: (value) => value.trim().length > 0 || 'Enter a broadcast name.',
                  })}
                />
              </FormField>

              <Textarea
                label="Description (Optional)"
                placeholder="Brief description of this broadcast..."
                rows={2}
                className="h-14 resize-y text-sm!"
                {...register('description')}
              />

              <fieldset
                aria-describedby={
                  errors.channels ? 'broadcast-channels-error' : 'broadcast-channels-hint'
                }
              >
                <legend className="sr-only">Channels (required)</legend>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-heading">
                    Channel(s) <span className="text-danger">*</span>
                  </span>
                  <div className="flex items-center gap-3">
                    <Toggle label="Select All" checked={allSelected} onChange={selectAll} />
                    <div>
                      <span className="block text-sm text-heading">Select All</span>
                      <span className="block text-xs text-muted">
                        Select all channels (Email, SMS, and In-App)
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex">
                  <label className="relative flex min-h-14 min-w-0 cursor-pointer items-center gap-2 rounded-control border border-action bg-info-soft px-3 py-2 text-action xl:flex-5">
                    <UsersThree aria-hidden weight="fill" className="size-6 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">All Channels</span>
                      <span className="block text-xs text-muted">Email + SMS + In-App</span>
                    </span>
                    <input
                      type="checkbox"
                      aria-label="All Channels"
                      checked={allSelected}
                      onChange={(event) => selectAll(event.target.checked)}
                      className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                    <span
                      aria-hidden
                      className={`flex size-4 shrink-0 items-center justify-center rounded-sm border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus ${allSelected ? 'border-action bg-action text-on-action' : 'border-control-border bg-surface'}`}
                    >
                      {allSelected ? <Check weight="bold" className="size-3" /> : null}
                    </span>
                  </label>
                  {broadcastChannels.map((channel) => {
                    const Glyph = channelIcons[channel];
                    const checked = draft.channels.includes(channel);
                    return (
                      <label
                        key={channel}
                        className={`relative flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-control border px-3 py-2 xl:flex-4 ${checked ? 'border-action bg-info-soft text-action' : 'border-border bg-surface text-muted'}`}
                      >
                        <Glyph aria-hidden weight="fill" className="size-6 shrink-0" />
                        <span className="flex-1 text-sm font-semibold">
                          {channelLabels[channel]}
                        </span>
                        <input
                          type="checkbox"
                          value={channel}
                          aria-label={channelLabels[channel]}
                          aria-invalid={errors.channels ? true : undefined}
                          aria-describedby={
                            errors.channels ? 'broadcast-channels-error' : undefined
                          }
                          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          {...register('channels', {
                            validate: (channels) =>
                              channels.length > 0 || 'Select at least one channel.',
                          })}
                        />
                        <span
                          aria-hidden
                          className={`flex size-4 shrink-0 items-center justify-center rounded-sm border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus ${checked ? 'border-action bg-action text-on-action' : 'border-control-border bg-surface'}`}
                        >
                          {checked ? <Check weight="bold" className="size-3" /> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {errors.channels ? (
                  <p
                    id="broadcast-channels-error"
                    role="alert"
                    className="mt-2 text-xs text-danger"
                  >
                    {errors.channels.message}
                  </p>
                ) : null}
                <div
                  id="broadcast-channels-hint"
                  className="mt-2 flex items-start gap-3 rounded-control bg-info-soft px-4 py-3 text-xs text-heading"
                >
                  <Info aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0 text-action" />
                  <p>
                    You can select one or more channels. Selecting “All Channels” will automatically
                    choose Email, SMS, and In-App. You can still deselect any channel if needed.
                  </p>
                </div>
              </fieldset>

              <PageState
                query={options}
                empty="No categories or saved templates yet."
                isEmpty={(data) => data.categories.length === 0 && data.templates.length === 0}
              >
                {() => null}
              </PageState>
              <div className="lg:w-1/2">
                <Select
                  label="Category (Optional)"
                  className="h-11 text-sm! xl:h-9 xl:min-h-9"
                  disabled={categories.length === 0}
                  options={[{ value: '', label: 'Select a category' }, ...categories]}
                  {...register('category')}
                />
              </div>

              <fieldset>
                <legend className="mb-1 text-sm text-heading">
                  Use a Template? <span className="text-muted">(Optional)</span>
                </legend>
                <div className="rounded-control border border-divider px-4 pb-2">
                  <div className="grid gap-2 lg:grid-cols-2">
                    <div>
                      <Radio
                        label="Start with a template"
                        value="template"
                        className="min-h-7! gap-2! text-heading"
                        {...register('messageSource')}
                      />
                      <p className="pl-6 text-xs text-muted">
                        Choose from your saved templates to get started.
                      </p>
                    </div>
                    <div>
                      <Radio
                        label="Create a custom message"
                        value="custom"
                        className="min-h-7! gap-2! text-heading"
                        {...register('messageSource')}
                      />
                      <p className="pl-6 text-xs text-muted">Build a new message from scratch.</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="w-full lg:w-1/3">
                      <Select
                        label="Template"
                        hideLabel
                        className="h-11 text-sm! xl:h-9 xl:min-h-9"
                        disabled={templates.length === 0 || draft.messageSource === 'custom'}
                        options={[
                          { value: '', label: 'Select a template' },
                          ...templates.map((template) => ({
                            value: template.id,
                            label: template.name,
                          })),
                        ]}
                        {...register('templateId')}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      className="min-h-9! px-1! text-xs!"
                      disabled={!selectedTemplate || draft.messageSource === 'custom'}
                      onClick={() => setDialog('preview')}
                    >
                      <Eye aria-hidden weight="fill" className="size-4" />
                      Preview Template
                    </Button>
                    <Button
                      variant="ghost"
                      className="min-h-9! bg-info-soft text-xs! sm:ml-auto"
                      disabled={templates.length === 0}
                      onClick={() => setDialog('browse')}
                    >
                      <FileText aria-hidden weight="fill" className="size-4" />
                      Browse Templates
                    </Button>
                  </div>
                </div>
              </fieldset>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-4 py-4 sm:px-6">
              <Button
                variant="ghost"
                className="bg-info-soft px-8!"
                disabled={busy}
                onClick={() =>
                  void persist(getValues()).then((id) => {
                    if (!id) return;
                    setNotice('Draft saved.');
                    if (!broadcastId) router.replace(stepHref('', id));
                  })
                }
              >
                Save as Draft
              </Button>
              <Button type="submit" className="min-w-36" disabled={busy}>
                Next <ArrowRight aria-hidden weight="fill" className="size-4" />
              </Button>
              {notice ? (
                <p role="status" className="w-full text-sm text-muted">
                  {notice}
                </p>
              ) : null}
              {storageError ? (
                <p role="alert" className="w-full text-sm text-danger">
                  {storageError}
                </p>
              ) : null}
            </footer>
          </form>
        </Card>

        <div className="min-w-0 xl:col-span-3">
          <BroadcastPanels
            draft={draft}
            categoryLabel={
              categories.find((category) => category.value === draft.category)?.label ?? ''
            }
            audience={
              loaded?.segment
                ? `${loaded.segment.name}${count.data ? ` · ${count.data.total.toLocaleString('en-US')} recipients` : ''}`
                : undefined
            }
            message={loaded?.channels.find((channel) => channel.body)?.body.slice(0, 80)}
          />
        </div>
      </div>

      <Modal
        open={dialog !== null}
        title={
          dialog === 'browse' ? 'Browse Templates' : (selectedTemplate?.name ?? 'Preview Template')
        }
        onClose={() => setDialog(null)}
      >
        {dialog === 'browse' ? (
          <ul className="space-y-3">
            {templates.map((template) => (
              <li key={template.id}>
                <Button
                  variant="secondary"
                  className="w-full justify-start!"
                  onClick={() => {
                    setValue('templateId', template.id, { shouldDirty: true });
                    setValue('messageSource', 'template', { shouldDirty: true });
                    setDialog(null);
                  }}
                >
                  {template.name}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-heading">{selectedTemplate?.subject}</p>
            <p className="text-muted">{selectedTemplate?.message}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
