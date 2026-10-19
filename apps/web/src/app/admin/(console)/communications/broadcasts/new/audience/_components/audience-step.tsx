'use client';

import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Briefcase,
  CalendarBlank,
  ChatCircleDots,
  Check,
  Clock,
  DotsThree,
  EnvelopeSimple,
  FileText,
  FloppyDisk,
  Funnel,
  Lightbulb,
  MagnifyingGlass,
  Plus,
  Tag,
  UsersThree,
  UserCircle,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import { Button, Input, Modal, PageHeader, Pagination, Select, Textarea } from '@firmivra/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';
import {
  ADMIN_COMM_BROADCAST_ERRORS,
  type AdminCommSegment,
  type AdminCommSegmentDefinition,
} from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../../lib/query';
import { channelLabels, readBroadcastDraft, stepHref } from '../../_components/broadcast-draft';

type AudienceSegmentIcon =
  'users' | 'user' | 'briefcase' | 'clock' | 'funnel' | 'file' | 'warning' | 'tag';
type AudienceSegmentTone = 'blue' | 'green' | 'navy' | 'amber' | 'purple' | 'red';
/** A saved segment as the table shows it. */
interface AudienceSegment {
  id: string;
  name: string;
  description: string;
  /** The last count; null until the segment is counted. */
  contacts: number | null;
  updatedAt: string;
  updatedLabel: string;
  icon: AudienceSegmentIcon;
  tone: AudienceSegmentTone;
}
type ContactType = AdminCommSegmentDefinition['contactTypes'][number];
const reachLabels: Record<ContactType, string> = {
  FIRM: 'Firm owners',
  LEAD: 'Sales leads',
  TEAM: 'Firmivra team',
};
const tones: AudienceSegmentTone[] = ['blue', 'green', 'navy', 'amber', 'purple', 'red'];
/** Who a segment reaches, in words (a firm's clients are never reached, B6). */
const describe = (d: AdminCommSegmentDefinition) =>
  d.contactTypes.map((t) => reachLabels[t]).join(', ') +
  (d.firmStatuses?.length
    ? ` (${d.firmStatuses.map((x) => x.toLowerCase()).join(', ')} firms)`
    : '') +
  (d.firmIds?.length ? ` (${d.firmIds.length} firms)` : '') +
  (d.salesContactIds?.length ? ` (${d.salesContactIds.length} leads)` : '');
const segmentView = (seg: AdminCommSegment, index: number): AudienceSegment => {
  const [only] = seg.definition.contactTypes;
  return {
    id: seg.id,
    name: seg.name,
    description: seg.description ?? describe(seg.definition),
    contacts: seg.lastCount,
    updatedAt: seg.updatedAt,
    updatedLabel: new Date(seg.updatedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    icon:
      seg.definition.contactTypes.length > 1
        ? 'users'
        : only === 'FIRM'
          ? 'briefcase'
          : only === 'LEAD'
            ? 'funnel'
            : 'user',
    tone: tones[index % tones.length] ?? 'blue',
  };
};

type AudienceTab = 'saved' | 'filters' | 'upload' | 'individuals';
type AudienceSort = 'recent' | 'contacts' | 'name';

const PAGE_SIZE = 8;

const iconForSegment: Record<AudienceSegmentIcon, Icon> = {
  users: UsersThree,
  user: UserCircle,
  briefcase: Briefcase,
  clock: Clock,
  funnel: Funnel,
  file: FileText,
  warning: WarningCircle,
  tag: Tag,
};

const toneClass: Record<AudienceSegmentTone, string> = {
  blue: 'bg-info-soft text-action',
  green: 'bg-success-soft text-success',
  navy: 'bg-subtle text-heading',
  amber: 'bg-warning-soft text-warning',
  purple: 'bg-purple-soft text-purple',
  red: 'bg-danger-soft text-danger',
};

const tabs: { id: AudienceTab; label: string }[] = [
  { id: 'saved', label: 'Saved Segments' },
  { id: 'filters', label: 'Advanced Filters' },
  { id: 'upload', label: 'Upload List' },
  { id: 'individuals', label: 'Select Individually' },
];

function AudienceProgress() {
  const steps = [
    { title: 'Basic Information', description: 'Set up your broadcast', state: 'complete' },
    { title: 'Audience', description: 'Choose recipients', state: 'current' },
    { title: 'Message', description: 'Create your content', state: 'future' },
    { title: 'Review & Send', description: 'Confirm and send', state: 'future' },
  ] as const;

  return (
    <ol aria-label="Broadcast creation progress" className="grid grid-cols-4">
      {steps.map((step, index) => (
        <li
          key={step.title}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className="relative flex min-w-0 flex-col items-center gap-1 text-center sm:flex-row sm:items-start sm:gap-3 sm:text-left"
        >
          {index > 0 ? (
            <span
              aria-hidden="true"
              className={
                'absolute left-0 top-5 hidden h-px w-5 -translate-x-6 sm:block lg:w-12 lg:-translate-x-14 ' +
                (step.state === 'future' ? 'bg-border' : 'bg-action')
              }
            />
          ) : null}
          <span
            aria-hidden="true"
            className={
              'relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full text-base font-semibold sm:size-11 ' +
              (step.state === 'current'
                ? 'bg-action text-on-action'
                : step.state === 'complete'
                  ? 'bg-info-soft text-action'
                  : 'bg-disabled text-heading')
            }
          >
            {step.state === 'complete' ? <Check weight="bold" className="size-5" /> : index + 1}
          </span>
          <span className="min-w-0 pt-0.5">
            <span
              className={
                'block text-xs font-semibold leading-tight sm:text-sm ' +
                (step.state === 'future' ? 'text-heading' : 'text-action')
              }
            >
              {step.title}
            </span>
            <span className="mt-1 hidden text-xs text-muted sm:block">{step.description}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function SummaryRow({ icon: Glyph, label, value }: { icon: Icon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-divider py-3 last:border-b-0">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-info-soft text-action">
        <Glyph aria-hidden weight="fill" className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-heading">{label}</p>
        <p className="mt-0.5 break-words text-sm text-muted">{value}</p>
      </div>
    </div>
  );
}

function BroadcastSummary({
  recipientCount,
  name,
  channels,
  category,
}: {
  recipientCount: number | null;
  name: string;
  channels: string;
  category: string;
}) {
  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-card">
      <h2 className="font-display text-xl font-bold text-heading">Broadcast Summary</h2>
      <p className="mt-1 text-sm text-muted">This summary will update as you complete each step.</p>
      <div className="mt-2">
        <SummaryRow icon={FileText} label="Broadcast Name" value={name || '—'} />
        <SummaryRow icon={EnvelopeSimple} label="Channel(s)" value={channels || '—'} />
        <SummaryRow icon={Tag} label="Category" value={category || '—'} />
        <SummaryRow
          icon={UsersThree}
          label="Audience"
          value={recipientCount === null ? '—' : recipientCount.toLocaleString() + ' recipients'}
        />
        <SummaryRow icon={ChatCircleDots} label="Message" value="—" />
        <SummaryRow icon={CalendarBlank} label="Schedule" value="Send immediately" />
      </div>
    </section>
  );
}

function NeedHelpCard() {
  const resources = [
    'How to Create an Audience Segment',
    'Using Advanced Filters',
    'Uploading a Contact List',
    'Best Practices for Broadcasts',
  ];

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2">
        <Lightbulb aria-hidden weight="fill" className="size-6 text-action" />
        <h2 className="font-display text-lg font-bold text-heading">Need Help?</h2>
      </div>
      <p className="mt-1 pl-8 text-sm text-muted">
        Check out these resources before sending your broadcast.
      </p>
      <ul className="mt-3 space-y-2 pl-1">
        {resources.map((resource) => (
          <li key={resource}>
            <span className="inline-flex items-start gap-2 text-sm text-link">
              <ArrowSquareOut aria-hidden weight="bold" className="mt-0.5 size-4 shrink-0" />
              {resource}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SegmentRow({
  segment,
  checked,
  onChange,
}: {
  segment: AudienceSegment;
  checked: boolean;
  onChange: () => void;
}) {
  const Glyph = iconForSegment[segment.icon];
  return (
    <tr className="border-b border-divider last:border-b-0 hover:bg-canvas">
      <td className="w-10 px-3 py-2">
        <input
          aria-label={'Select ' + segment.name}
          checked={checked}
          className="size-4 rounded border-border"
          onChange={onChange}
          type="checkbox"
        />
      </td>
      <td className="min-w-48 px-3 py-2">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={
              'flex size-9 shrink-0 items-center justify-center rounded-xl ' +
              toneClass[segment.tone]
            }
          >
            <Glyph weight="fill" className="size-5" />
          </span>
          <span className="text-sm font-medium text-heading">{segment.name}</span>
        </div>
      </td>
      <td className="min-w-48 px-3 py-2 text-xs text-muted">{segment.description}</td>
      <td className="whitespace-nowrap px-3 py-2 text-center text-sm font-medium text-heading">
        {segment.contacts === null ? '—' : segment.contacts.toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{segment.updatedLabel}</td>
      <td className="px-3 py-2 text-center text-action">
        <DotsThree aria-hidden weight="bold" className="mx-auto size-5" />
      </td>
    </tr>
  );
}

function EmptyTab({
  tab,
  fileName,
  onFileChange,
}: {
  tab: AudienceTab;
  fileName: string;
  onFileChange: (name: string) => void;
}) {
  if (tab === 'upload') {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-info-soft text-action">
          <FileText aria-hidden weight="fill" className="size-6" />
        </span>
        <h3 className="font-display text-lg font-bold text-heading">Upload a contact list</h3>
        <p className="max-w-md text-sm text-muted">
          A broadcast reaches a saved segment: an uploaded list is not kept yet. Choose or create a
          segment instead.
        </p>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-info-soft">
          <Plus aria-hidden weight="bold" className="size-4" />
          {fileName || 'Choose CSV file'}
          <input
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => onFileChange(event.target.files?.[0]?.name ?? '')}
            type="file"
          />
        </label>
      </div>
    );
  }

  const filterMode = tab === 'filters';
  const Glyph = filterMode ? Funnel : UsersThree;
  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-info-soft text-action">
        <Glyph aria-hidden weight="fill" className="size-6" />
      </span>
      <h3 className="font-display text-lg font-bold text-heading">
        {filterMode ? 'Advanced Filters' : 'Select Individually'}
      </h3>
      <p className="max-w-md text-sm text-muted">
        {filterMode
          ? 'No filters have been applied. Choose a saved segment or create a new segment to continue.'
          : 'No individual contacts have been selected. Choose a saved segment or upload a contact list.'}
      </p>
    </div>
  );
}

/** Step 2: one saved segment for the broadcast (B6), counted when chosen. */
export function AudienceStep({ broadcastId }: { broadcastId?: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const [activeTab, setActiveTab] = useState<AudienceTab>('saved');
  const broadcast = useApiQuery(
    ['admin-communications', 'broadcasts', 'one', broadcastId ?? 'new'],
    () => (broadcastId ? api.adminBroadcasts.broadcasts.get(broadcastId) : Promise.resolve(null)),
  );
  const segmentsQuery = useApiQuery(['admin-communications', 'segments'], () =>
    api.adminBroadcasts.segments.list({ pageSize: 100 }),
  );
  const categories = useApiQuery(['admin-communications', 'categories'], () =>
    api.adminCommunications.categories.list(),
  );
  const hasLoadError = segmentsQuery.isError;
  const segments = useMemo(
    () => (segmentsQuery.data?.items ?? []).map(segmentView),
    [segmentsQuery.data],
  );
  // '' is "none chosen"; null is "as saved on the broadcast".
  const [chosen, setChosen] = useState<string | null>(null);
  const selectedId = chosen ?? broadcast.data?.segment?.id ?? '';
  const selectedSegmentIds = selectedId ? [selectedId] : [];
  const count = useApiQuery(['admin-communications', 'segment-count', selectedId || 'none'], () =>
    selectedId ? api.adminBroadcasts.segments.count(selectedId) : Promise.resolve(null),
  );
  const draft = broadcastId ? readBroadcastDraft(broadcastId) : null;
  const [busy, setBusy] = useState(false);
  const [newReach, setNewReach] = useState<ContactType[]>(['FIRM']);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<AudienceSort>('recent');
  const [currentPage, setCurrentPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSegmentName, setNewSegmentName] = useState('');
  const [newSegmentDescription, setNewSegmentDescription] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);

  const sortedSegments = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return segments
      .filter((segment) =>
        (segment.name + ' ' + segment.description).toLowerCase().includes(normalizedSearch),
      )
      .sort((left, right) => {
        if (sortBy === 'contacts') return (right.contacts ?? 0) - (left.contacts ?? 0);
        if (sortBy === 'name') return left.name.localeCompare(right.name);
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [segments, searchTerm, sortBy]);

  const pageCount = Math.max(1, Math.ceil(sortedSegments.length / PAGE_SIZE));
  const visibleSegments = sortedSegments.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const selectedSegments = segments.filter((segment) => selectedSegmentIds.includes(segment.id));
  const recipientCount = selectedId
    ? (count.data?.total ?? selectedSegments[0]?.contacts ?? null)
    : 0;

  const toggleSegment = (segmentId: string) => {
    setSelectionError('');
    setDraftSaved(false);
    setChosen(selectedId === segmentId ? '' : segmentId);
  };

  const createSegment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newSegmentName.trim();
    if (!name || !newReach.length) return;
    setBusy(true);
    try {
      const made = await api.adminBroadcasts.segments.create({
        name,
        ...(newSegmentDescription.trim() ? { description: newSegmentDescription.trim() } : {}),
        definition: { contactTypes: newReach },
      });
      await client.invalidateQueries({ queryKey: ['admin-communications', 'segments'] });
      setChosen(made.id);
      setActiveTab('saved');
      setSearchTerm('');
      setSortBy('recent');
      setCurrentPage(1);
      setNewSegmentName('');
      setNewSegmentDescription('');
      setNewReach(['FIRM']);
      setIsCreateOpen(false);
    } catch (error) {
      setSelectionError(errorMessage(error, ADMIN_COMM_BROADCAST_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  /** Saves the chosen segment on the broadcast; returns false when it could not. */
  const saveSegment = async () => {
    if (!broadcastId) {
      setSelectionError('Start the broadcast with its basic information first.');
      return false;
    }
    setBusy(true);
    try {
      await api.adminBroadcasts.broadcasts.update(broadcastId, { segmentId: selectedId || null });
      await client.invalidateQueries({ queryKey: ['admin-communications', 'broadcasts'] });
      setSelectionError('');
      return true;
    } catch (error) {
      setSelectionError(errorMessage(error, ADMIN_COMM_BROADCAST_ERRORS));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (await saveSegment()) setDraftSaved(true);
  };

  const goNext = async () => {
    if (!selectedId) {
      setSelectionError('Select an audience before continuing.');
      return;
    }
    if ((await saveSegment()) && broadcastId) router.push(stepHref('message', broadcastId));
  };

  const categoryName = categories.data?.items.find((c) => c.id === draft?.category)?.name ?? '';
  const channelNames = broadcast.data?.channels.length
    ? broadcast.data.channels.map((c) => channelLabels[c.channel]).join(', ')
    : (draft?.channels ?? []).map((c) => channelLabels[c]).join(', ');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5">
        <PageHeader
          above={
            <Link
              className="inline-flex w-fit items-center gap-2 text-sm font-medium text-link hover:underline"
              href="/communications/broadcasts"
            >
              <ArrowLeft aria-hidden weight="bold" className="size-4" />
              Back to Broadcasts
            </Link>
          }
          title="Create Broadcast"
          subtitle="Send a message to multiple recipients using email, SMS, or in-app notifications."
        />
        <AudienceProgress />
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <div className="px-5 pt-4">
            <h2 className="font-display text-xl font-bold text-heading">Audience</h2>
            <p className="mt-1 text-sm text-muted">
              Choose who will receive this broadcast. You can use a saved segment, create a new
              segment, apply filters, upload a list, or select individuals.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-divider px-3">
            <div
              aria-label="Audience selection method"
              className="flex min-w-0 flex-1 overflow-x-auto"
              role="tablist"
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  aria-selected={activeTab === tab.id}
                  className={
                    'min-h-11 shrink-0 border-b-2 px-3 text-xs font-medium transition-colors sm:px-4 sm:text-sm ' +
                    (activeTab === tab.id
                      ? 'border-action bg-folder-surface text-action'
                      : 'border-transparent text-heading hover:bg-canvas')
                  }
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <Button
              className="min-h-9 shrink-0 px-3 text-xs sm:text-sm"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus aria-hidden weight="bold" className="size-4" />
              Create New Segment
            </Button>
          </div>

          {activeTab === 'saved' ? (
            <>
              <div className="flex flex-col items-stretch justify-between gap-3 px-3 py-3 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <MagnifyingGlass
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted"
                    weight="regular"
                  />
                  <Input
                    className="min-h-9 py-1.5 pl-9 text-sm"
                    hideLabel
                    label="Search segments"
                    onChange={(event) => {
                      setSearchTerm(event.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Search segments..."
                    value={searchTerm}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:w-52">
                  <label className="shrink-0 text-xs text-muted" htmlFor="audience-sort">
                    Sort by
                  </label>
                  <div className="min-w-0 flex-1">
                    <Select
                      className="min-h-9 py-1.5 text-sm"
                      hideLabel
                      id="audience-sort"
                      label="Sort by"
                      onChange={(event) => setSortBy(event.target.value as AudienceSort)}
                      options={[
                        { value: 'recent', label: 'Most Recent' },
                        { value: 'contacts', label: 'Most Contacts' },
                        { value: 'name', label: 'Name A-Z' },
                      ]}
                      value={sortBy}
                    />
                  </div>
                </div>
              </div>

              <div className="grid min-w-0 grid-cols-1 items-start gap-3 px-3 pb-3 2xl:grid-cols-[minmax(0,1fr)_15rem]">
                <div className="min-w-0">
                  <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
                    <table
                      className="w-full min-w-max border-collapse text-left"
                      data-testid="audience-segments"
                    >
                      <thead className="bg-table-head text-sm font-bold text-heading">
                        <tr>
                          <th className="w-10 px-3 py-2.5">
                            <span className="sr-only">Selected</span>
                          </th>
                          <th className="px-3 py-2.5">Segment Name</th>
                          <th className="px-3 py-2.5">Description</th>
                          <th className="px-3 py-2.5 text-center">Contacts</th>
                          <th className="px-3 py-2.5">Last Updated</th>
                          <th className="px-3 py-2.5 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hasLoadError ? (
                          <tr>
                            <td className="px-4 py-12 text-center text-sm text-muted" colSpan={6}>
                              <span
                                className="mx-auto flex max-w-sm flex-col items-center gap-2"
                                role="alert"
                              >
                                <WarningCircle
                                  aria-hidden
                                  weight="fill"
                                  className="size-6 text-warning"
                                />
                                <span>
                                  We couldn&apos;t load audience segments. Please try again.
                                </span>
                              </span>
                            </td>
                          </tr>
                        ) : visibleSegments.length > 0 ? (
                          visibleSegments.map((segment) => (
                            <SegmentRow
                              key={segment.id}
                              checked={selectedSegmentIds.includes(segment.id)}
                              onChange={() => toggleSegment(segment.id)}
                              segment={segment}
                            />
                          ))
                        ) : (
                          <tr>
                            <td className="px-4 py-12 text-center text-sm text-muted" colSpan={6}>
                              {segments.length === 0
                                ? 'No audience segments found.'
                                : 'No audience segments match your search.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 w-fit">
                    <Pagination page={currentPage} pageCount={pageCount} onPage={setCurrentPage} />
                  </div>
                </div>

                {/* Beside the segments from 2xl; below them, side by side, on narrower screens. */}
                <aside className="grid min-w-0 gap-2 sm:grid-cols-2 2xl:flex 2xl:flex-col">
                  <section className="flex min-h-72 flex-col items-center rounded-lg border border-border bg-surface p-3 text-center">
                    <h3 className="w-full text-left text-base font-bold text-heading">
                      Selected Audience
                    </h3>
                    <p className="mt-1 w-full text-left font-display text-3xl font-bold text-heading">
                      {recipientCount === null ? '—' : recipientCount.toLocaleString()}
                    </p>
                    <p className="w-full text-left text-xs text-muted">recipients selected</p>
                    {selectedSegments.length > 0 ? (
                      <ul className="mt-3 w-full space-y-2 text-left">
                        {selectedSegments.map((segment) => (
                          <li
                            key={segment.id}
                            className="flex items-center justify-between gap-2 rounded-control bg-canvas px-2 py-1.5 text-xs text-heading"
                          >
                            <span className="min-w-0 truncate">{segment.name}</span>
                            <button
                              aria-label={'Remove ' + segment.name}
                              className="shrink-0 text-muted hover:text-danger"
                              onClick={() => toggleSegment(segment.id)}
                              type="button"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <>
                        <span className="mt-5 flex size-20 items-center justify-center rounded-full bg-canvas text-chart-grey">
                          <UsersThree aria-hidden weight="fill" className="size-10" />
                        </span>
                        <p className="mt-4 text-sm font-semibold text-heading">
                          No audience selected
                        </p>
                        <p className="mt-2 text-xs leading-5 text-muted">
                          Select a segment, or create one, to see how many people it reaches.
                        </p>
                      </>
                    )}
                  </section>

                  <section className="rounded-lg bg-info-soft p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-heading">
                      <span className="flex size-4 items-center justify-center rounded-full bg-action text-on-action">
                        <span aria-hidden="true" className="text-xs leading-none">
                          i
                        </span>
                      </span>
                      Audience Tips
                    </div>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-4 text-muted">
                      <li>Use segments to quickly target groups.</li>
                      <li>Create a new segment to save your filters for future use.</li>
                      <li>To reach several groups at once, create a segment with them all.</li>
                      <li>Estimated recipient count will update as you make selections.</li>
                    </ul>
                  </section>
                </aside>
              </div>
            </>
          ) : (
            <div role="tabpanel" className="px-3 pb-3">
              <EmptyTab
                fileName={selectedFileName}
                onFileChange={setSelectedFileName}
                tab={activeTab}
              />
            </div>
          )}

          <footer className="border-t border-divider px-3 py-3">
            {selectionError ? (
              <p className="mb-3 text-sm text-danger" role="alert">
                {selectionError}
              </p>
            ) : null}
            {draftSaved ? (
              <p className="mb-3 text-sm text-success" role="status">
                Draft saved.
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                className="w-full sm:w-auto"
                onClick={() =>
                  router.push(
                    broadcastId ? stepHref('', broadcastId) : '/communications/broadcasts/new',
                  )
                }
                variant="secondary"
              >
                Back
              </Button>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  className="w-full sm:w-auto"
                  disabled={busy}
                  onClick={() => void saveDraft()}
                  variant="secondary"
                >
                  <FloppyDisk aria-hidden weight="fill" className="size-4" />
                  Save as Draft
                </Button>
                <Button
                  className="w-full min-w-36 sm:w-auto"
                  disabled={busy}
                  onClick={() => void goNext()}
                >
                  Next
                  <ArrowRight aria-hidden weight="bold" className="size-4" />
                </Button>
              </div>
            </div>
          </footer>
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <BroadcastSummary
            recipientCount={recipientCount}
            name={broadcast.data?.name ?? draft?.name ?? ''}
            channels={channelNames}
            category={categoryName}
          />
          <NeedHelpCard />
        </aside>
      </div>

      <Modal
        footer={
          <>
            <Button onClick={() => setIsCreateOpen(false)} variant="secondary">
              Cancel
            </Button>
            <Button
              disabled={busy || !newSegmentName.trim() || !newReach.length}
              form="create-audience-segment"
              type="submit"
            >
              Save Segment
            </Button>
          </>
        }
        onClose={() => setIsCreateOpen(false)}
        open={isCreateOpen}
        subtitle="Create a segment and add it to this broadcast audience."
        title="Create New Segment"
      >
        <form
          className="space-y-4"
          id="create-audience-segment"
          onSubmit={(event) => void createSegment(event)}
        >
          <Input
            autoFocus
            label="Segment Name"
            onChange={(event) => setNewSegmentName(event.target.value)}
            placeholder="Enter segment name"
            required
            value={newSegmentName}
          />
          <Textarea
            label="Description (Optional)"
            onChange={(event) => setNewSegmentDescription(event.target.value)}
            placeholder="Describe this audience segment"
            rows={3}
            value={newSegmentDescription}
          />
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-heading">Who it reaches</legend>
            <div className="flex flex-wrap gap-3">
              {(Object.keys(reachLabels) as ContactType[]).map((type) => (
                <label key={type} className="inline-flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-border"
                    checked={newReach.includes(type)}
                    onChange={(event) =>
                      setNewReach((current) =>
                        event.target.checked
                          ? [...current, type]
                          : current.filter((t) => t !== type),
                      )
                    }
                  />
                  {reachLabels[type]}
                </label>
              ))}
            </div>
          </fieldset>
        </form>
      </Modal>
    </div>
  );
}
