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
import {
  Button,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Textarea,
} from '@firmivra/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  mockAudienceSegments,
  type AudienceSegment,
  type AudienceSegmentIcon,
  type AudienceSegmentTone,
} from '../../../../../../../../mocks/admin-communications-audience';

type AudienceTab = 'saved' | 'filters' | 'upload' | 'individuals';
type AudienceSort = 'recent' | 'contacts' | 'name';

const DRAFT_KEY = 'firmivra.broadcast.audience';
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

const readDraftIds = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

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

function SummaryRow({
  icon: Glyph,
  label,
  value,
}: {
  icon: Icon;
  label: string;
  value: string;
}) {
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

function BroadcastSummary({ recipientCount }: { recipientCount: number }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-card">
      <h2 className="font-display text-xl font-bold text-heading">Broadcast Summary</h2>
      <p className="mt-1 text-sm text-muted">
        This summary will update as you complete each step.
      </p>
      <div className="mt-2">
        <SummaryRow icon={FileText} label="Broadcast Name" value="—" />
        <SummaryRow icon={EnvelopeSimple} label="Channel(s)" value="Email, SMS, In-App" />
        <SummaryRow icon={Tag} label="Category" value="—" />
        <SummaryRow
          icon={UsersThree}
          label="Audience"
          value={recipientCount.toLocaleString() + ' recipients'}
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
            className={'flex size-9 shrink-0 items-center justify-center rounded-xl ' + toneClass[segment.tone]}
          >
            <Glyph weight="fill" className="size-5" />
          </span>
          <span className="text-sm font-medium text-heading">{segment.name}</span>
        </div>
      </td>
      <td className="min-w-48 px-3 py-2 text-xs text-muted">{segment.description}</td>
      <td className="whitespace-nowrap px-3 py-2 text-center text-sm font-medium text-heading">
        {segment.contacts.toLocaleString()}
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
          Choose a CSV file to add contacts to this audience.
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

interface AudienceStepProps {
  initialSegments?: AudienceSegment[];
  hasLoadError?: boolean;
}

export function AudienceStep({
  initialSegments = mockAudienceSegments,
  hasLoadError = false,
}: AudienceStepProps = {}) {
  const router = useRouter();
  const [segments, setSegments] = useState<AudienceSegment[]>(initialSegments);
  const [activeTab, setActiveTab] = useState<AudienceTab>('saved');
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<AudienceSort>('recent');
  const [currentPage, setCurrentPage] = useState(1);
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSegmentName, setNewSegmentName] = useState('');
  const [newSegmentDescription, setNewSegmentDescription] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);

  useEffect(() => {
    setSelectedSegmentIds(readDraftIds(sessionStorage.getItem(DRAFT_KEY)));
    setIsDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (isDraftLoaded) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(selectedSegmentIds));
  }, [isDraftLoaded, selectedSegmentIds]);

  const sortedSegments = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return segments
      .filter((segment) =>
        (segment.name + ' ' + segment.description).toLowerCase().includes(normalizedSearch),
      )
      .sort((left, right) => {
        if (sortBy === 'contacts') return right.contacts - left.contacts;
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
  const recipientCount = selectedSegments.reduce((total, segment) => total + segment.contacts, 0);
  const allVisibleSelected =
    visibleSegments.length > 0 &&
    visibleSegments.every((segment) => selectedSegmentIds.includes(segment.id));

  const toggleSegment = (segmentId: string) => {
    setSelectionError('');
    setDraftSaved(false);
    setSelectedSegmentIds((current) =>
      current.includes(segmentId)
        ? current.filter((id) => id !== segmentId)
        : [...current, segmentId],
    );
  };

  const toggleVisibleSegments = () => {
    setSelectionError('');
    setDraftSaved(false);
    setSelectedSegmentIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleSegments.some((segment) => segment.id === id))
        : Array.from(new Set([...current, ...visibleSegments.map((segment) => segment.id)])),
    );
  };

  const createSegment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newSegmentName.trim();
    if (!name) return;

    const segment: AudienceSegment = {
      id: 'custom-' + Date.now().toString(),
      name,
      description: newSegmentDescription.trim() || 'Custom audience segment',
      contacts: 0,
      updatedAt: '2026-10-19',
      updatedLabel: 'Oct 19, 2026',
      icon: 'users',
      tone: 'blue',
    };
    setSegments((current) => [segment, ...current]);
    setActiveTab('saved');
    setSearchTerm('');
    setSortBy('recent');
    setCurrentPage(1);
    setSelectedSegmentIds((current) => [...current, segment.id]);
    setNewSegmentName('');
    setNewSegmentDescription('');
    setIsCreateOpen(false);
  };

  const saveDraft = () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(selectedSegmentIds));
    setDraftSaved(true);
    setSelectionError('');
  };

  const goNext = () => {
    if (selectedSegmentIds.length === 0) {
      setSelectionError('Select an audience before continuing.');
      return;
    }
    setSelectionError('');
    router.push('/communications/broadcasts/new/message');
  };

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
            <div aria-label="Audience selection method" className="flex min-w-0 flex-1 overflow-x-auto" role="tablist">
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

              <div className="grid min-w-0 grid-cols-1 items-start gap-3 px-3 pb-3 xl:grid-cols-[minmax(0,1fr)_15rem]">
                <div className="min-w-0">
                  <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-max border-collapse text-left" data-testid="audience-segments">
                      <thead className="bg-table-head text-sm font-bold text-heading">
                        <tr>
                          <th className="w-10 px-3 py-2.5">
                            <input
                              aria-label="Select all segments on this page"
                              checked={allVisibleSelected}
                              className="size-4 rounded border-border"
                              onChange={toggleVisibleSegments}
                              type="checkbox"
                            />
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
                              <span className="mx-auto flex max-w-sm flex-col items-center gap-2" role="alert">
                                <WarningCircle aria-hidden weight="fill" className="size-6 text-warning" />
                                <span>We couldn&apos;t load audience segments. Please try again.</span>
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
                    <Pagination
                      page={currentPage}
                      pageCount={pageCount}
                      onPage={setCurrentPage}
                    />
                  </div>
                </div>

                <aside className="flex min-w-0 flex-col gap-2">
                  <section className="flex min-h-72 flex-col items-center rounded-lg border border-border bg-surface p-3 text-center">
                    <h3 className="w-full text-left text-base font-bold text-heading">
                      Selected Audience
                    </h3>
                    <p className="mt-1 w-full text-left font-display text-3xl font-bold text-heading">
                      {recipientCount.toLocaleString()}
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
                        <p className="mt-4 text-sm font-semibold text-heading">No audience selected</p>
                        <p className="mt-2 text-xs leading-5 text-muted">
                          Select one or more segments, use filters, upload a list, or choose
                          individuals to see your estimated recipients here.
                        </p>
                      </>
                    )}
                  </section>

                  <section className="rounded-lg bg-info-soft p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-heading">
                      <span className="flex size-4 items-center justify-center rounded-full bg-action text-on-action">
                        <span aria-hidden="true" className="text-xs leading-none">i</span>
                      </span>
                      Audience Tips
                    </div>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-4 text-muted">
                      <li>Use segments to quickly target groups.</li>
                      <li>Create a new segment to save your filters for future use.</li>
                      <li>You can combine multiple segments.</li>
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
                onClick={() => router.push('/communications/broadcasts/new')}
                variant="secondary"
              >
                Back
              </Button>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button className="w-full sm:w-auto" onClick={saveDraft} variant="secondary">
                  <FloppyDisk aria-hidden weight="fill" className="size-4" />
                  Save as Draft
                </Button>
                <Button className="w-full min-w-36 sm:w-auto" onClick={goNext}>
                  Next
                  <ArrowRight aria-hidden weight="bold" className="size-4" />
                </Button>
              </div>
            </div>
          </footer>
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <BroadcastSummary recipientCount={recipientCount} />
          <NeedHelpCard />
        </aside>
      </div>

      <Modal
        footer={
          <>
            <Button onClick={() => setIsCreateOpen(false)} variant="secondary">
              Cancel
            </Button>
            <Button disabled={!newSegmentName.trim()} form="create-audience-segment" type="submit">
              Save Segment
            </Button>
          </>
        }
        onClose={() => setIsCreateOpen(false)}
        open={isCreateOpen}
        subtitle="Create a segment and add it to this broadcast audience."
        title="Create New Segment"
      >
        <form className="space-y-4" id="create-audience-segment" onSubmit={createSegment}>
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
        </form>
      </Modal>
    </div>
  );
}
