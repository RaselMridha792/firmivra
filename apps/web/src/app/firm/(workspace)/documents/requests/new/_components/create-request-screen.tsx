'use client';

import type { RequestPacketDetail, RequestTemplate } from '@firmivra/types';
import { Button, Modal, PageHeader, Select, Stepper } from '@firmivra/ui';
import { ArrowLeft, ArrowRight, CaretRight, CheckCircle } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useFirm } from '../../../../../../../components/firm-context';
import { useMe } from '../../../../../../../components/signed-in';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { engagementLabel } from '../../../upload/_components/upload-steps';
import { ChooseDocumentsStep } from './choose-documents';
import {
  check,
  type CheckPoint,
  defaultMessage,
  defaultSubject,
  type DraftErrors,
  EMPTY_DRAFT,
  packetBody,
  type RequestDraft,
  todayIso,
  withTemplate,
  withType,
} from './request-draft';
import {
  DetailsSection,
  DocumentsSection,
  MessageSection,
  OptionsSection,
  RecipientSection,
} from './request-sections';
import { PreviewDialog, ReviewStep, type StepId } from './review-step';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'details', label: 'Request Details' },
  { id: 'documents', label: 'Select Documents' },
  { id: 'message', label: 'Message & Settings' },
  { id: 'review', label: 'Review & Send' },
];
const SUBTITLES: Record<StepId, string> = {
  details: 'Request specific documents from clients or team members.',
  documents: 'Select the documents you need from a template or add custom items.',
  message: 'Write the message and choose how the recipient hears of the request.',
  review: 'Check the request, then send it or save it as a draft.',
};
/** The fields each step holds, to open the first step with a missing one. */
const FIELDS: Record<StepId, string[]> = {
  details: ['client', 'member', 'service', 'title', 'type', 'dueOn'],
  documents: ['items'],
  message: ['subject', 'message', 'expiresOn'],
  review: [],
};
const REQUEST_ERRORS: Record<string, string> = {
  NO_ENGAGEMENT: 'Choose the service this request is for.',
  REQUEST_INCOMPLETE:
    'Add a due date, a subject, a message and at least one document before sending.',
  NOT_A_MEMBER: 'That team member is no longer active. Choose another.',
  NOT_FOUND: 'The client, service or template is no longer available. Check the request.',
};

/**
 * Create Document Request (Documents design, Frame 4): Request Details holds the whole request
 * as the first image draws it, and its Next goes straight to Review & Send; Select Documents
 * (the second image) and Message & Settings give each part more room, and Previous walks back
 * through them. Nothing is saved until Save as Draft or Send Request (the library API's
 * `createRequest`, retry-safe by its idempotency key).
 */
export function CreateRequestScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { firm, role } = useFirm();
  const { me } = useMe();
  const manager = role === 'OWNER' || role === 'ADMIN';

  const templates = useQuery({
    queryKey: ['document-request-templates'],
    queryFn: () => api.documentLibrary.templates(),
  });
  const categories = useQuery({
    queryKey: ['document-categories'],
    queryFn: () => api.documents.categories(),
  });
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.team.list(), enabled: manager });
  const members = team.data?.filter((m) => m.status === 'ACTIVE' && !m.isYou) ?? null;
  const types = templates.data?.filter((t) => t.owner === 'FIRM') ?? null;
  const saved = templates.data?.filter((t) => t.owner === 'MINE') ?? null;

  const fill = (d: RequestDraft): RequestDraft => {
    const name =
      d.recipientKind === 'MEMBER'
        ? (members?.find((m) => m.user.id === d.memberUserId)?.user.name ?? '')
        : (d.client?.displayName ?? '');
    return {
      ...d,
      subject: d.subjectEdited ? d.subject : defaultSubject(d.title),
      message: d.messageEdited
        ? d.message
        : defaultMessage({ name, dueOn: d.dueOn, sender: me.user.name, firm: firm.name }),
    };
  };
  const [draft, setDraft] = useState<RequestDraft>(() => fill(EMPTY_DRAFT));
  const [step, setStep] = useState<StepId>('details');
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [done, setDone] = useState<RequestPacketDetail | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // Opened from a client's profile (`?clientId=`): that client is chosen until another is.
  const presetId = params.get('clientId');
  const preset = useQuery({
    queryKey: ['create-request', 'client', presetId],
    queryFn: () => api.clients.get(presetId ?? ''),
    enabled: Boolean(presetId),
  });
  // The firm's default reminder (Document Settings) until one is chosen here.
  const defaults = useQuery({
    queryKey: ['document-settings'],
    queryFn: () => api.documentLibrary.settings(),
  });
  const [reminderChosen, setReminderChosen] = useState(false);
  const days = defaults.data?.requestReminderDaysBefore;
  const withDefaults: RequestDraft =
    reminderChosen || days === undefined
      ? draft
      : { ...draft, reminder: days !== null, reminderDays: days ?? draft.reminderDays };
  const view: RequestDraft =
    withDefaults.client || !preset.data
      ? withDefaults
      : fill({ ...withDefaults, client: preset.data });
  const clientId = view.client?.id;
  const engagements = useQuery({
    queryKey: ['engagements', clientId, 'ACTIVE'],
    queryFn: () => api.engagements.listForClient(clientId ?? '', { status: 'ACTIVE' }),
    enabled: Boolean(clientId),
  });
  const services = engagements.data ?? null;

  const patch = (next: Partial<RequestDraft>) => {
    if ('reminder' in next || 'reminderDays' in next) setReminderChosen(true);
    setDraft((current) => {
      const d =
        reminderChosen || days === undefined
          ? current
          : { ...current, reminder: days !== null, reminderDays: days ?? current.reminderDays };
      const base = d.client || !preset.data ? d : { ...d, client: preset.data };
      // Another client's services differ: the service is chosen again.
      const service = next.client && next.client.id !== base.client?.id ? { serviceId: '' } : {};
      return fill({ ...base, ...next, ...service });
    });
  };
  const typeOf = (id: string) => types?.find((t) => t.id === id);
  const setType = (typeId: string) => patch(withType(view, typeId, typeOf(typeId)));
  const addTemplate = (id: string) => {
    const t: RequestTemplate | undefined = templates.data?.find((x) => x.id === id);
    if (t) patch({ items: withTemplate(view.items, t) });
  };

  const today = todayIso();
  function verify(at: CheckPoint): DraftErrors {
    const found = check(view, at, today);
    if (at !== 'documents' && at !== 'message' && view.client) {
      if (services && services.length === 0)
        found['service'] =
          'This client has no open service. Start one on the client’s profile first.';
      else if (services && services.length > 1 && !view.serviceId)
        found['service'] = 'Choose the service this request is for.';
    }
    setErrors(found);
    return found;
  }
  const firstStepWith = (found: DraftErrors) =>
    STEPS.find((s) => FIELDS[s.id].some((f) => found[f]))?.id;

  function next() {
    const at: Record<StepId, CheckPoint> = {
      details: 'details',
      documents: 'documents',
      message: 'message',
      review: 'send',
    };
    if (Object.keys(verify(at[step])).length) return;
    // Request Details holds the whole request, so it goes straight to Review & Send.
    setStep(step === 'details' ? 'review' : step === 'documents' ? 'message' : 'review');
  }
  function previous() {
    const index = STEPS.findIndex((s) => s.id === step);
    setStep(STEPS[index - 1]?.id ?? step);
  }

  async function save(send: boolean) {
    setFailure('');
    const found = verify(send ? 'send' : 'draft');
    if (Object.keys(found).length) {
      const where = firstStepWith(found);
      if (where && step !== 'details') setStep(where);
      return;
    }
    setBusy(true);
    try {
      const packet = await api.documentLibrary.createRequest(
        packetBody(view, { idempotencyKey, send, type: typeOf(view.typeId) }),
      );
      setDone(packet);
      void queryClient.invalidateQueries({ queryKey: ['document-requests'] });
    } catch (error) {
      setFailure(errorMessage(error, REQUEST_ERRORS));
    } finally {
      setBusy(false);
    }
  }

  const dirty = view.client !== null || view.title.trim() !== '' || view.items.length > 0;
  function leave() {
    if (dirty && !done) setLeaving(true);
    else router.push('/documents/requests');
  }

  const serviceField =
    view.client && services && services.length > 1 ? (
      <Select
        label="Service *"
        value={view.serviceId}
        error={errors['service']}
        onChange={(e) => patch({ serviceId: e.target.value })}
        options={[
          { value: '', label: 'Choose a service' },
          ...services.map((s) => ({ value: s.id, label: engagementLabel(s) })),
        ]}
      />
    ) : errors['service'] ? (
      <p role="alert" className="rounded-control bg-warning-soft px-4 py-3 text-sm text-heading">
        {errors['service']}
      </p>
    ) : null;

  const actions =
    step === 'details' ? (
      <Button variant="outline" onClick={leave}>
        <ArrowLeft aria-hidden weight="bold" className="size-5" />
        Back to Document Requests
      </Button>
    ) : (
      <>
        <Button variant="outline" onClick={leave}>
          <ArrowLeft aria-hidden weight="bold" className="size-5" />
          Back
        </Button>
        {done ? null : (
          <Button disabled={busy} onClick={() => void save(false)}>
            Save as Draft
          </Button>
        )}
      </>
    );

  return (
    <div data-testid="create-document-request" className="flex min-w-0 flex-col gap-5">
      <PageHeader
        above={
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2 text-sm">
              <li>
                <Link href="/documents" className="text-text hover:text-action hover:underline">
                  Documents
                </Link>
              </li>
              <li aria-hidden>
                <CaretRight weight="bold" className="size-3 text-muted" />
              </li>
              <li>
                <Link
                  href="/documents/requests"
                  className="text-text hover:text-action hover:underline"
                >
                  Document Requests
                </Link>
              </li>
              <li aria-hidden>
                <CaretRight weight="bold" className="size-3 text-muted" />
              </li>
              <li aria-current="page" className="font-medium text-heading">
                Create Document Request
              </li>
            </ol>
          </nav>
        }
        title="Create Document Request"
        subtitle={SUBTITLES[step]}
        actions={actions}
      />

      <div className="flex min-w-0 flex-col gap-5 rounded-card bg-surface p-4 shadow-card sm:p-6">
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[36rem]">
            <Stepper steps={STEPS} current={step} variant="wizard" label="Request steps" />
          </div>
        </div>

        {done ? (
          <div
            role="status"
            data-testid="request-saved"
            className="flex flex-col items-start gap-4 rounded-card bg-success-soft p-5"
          >
            <p className="flex items-center gap-3 text-heading">
              <CheckCircle aria-hidden weight="fill" className="size-7 text-success" />
              <span>
                {done.status === 'DRAFT'
                  ? `${done.reference} was saved as a draft.`
                  : `${done.reference} was sent to ${done.recipient.name}.`}
              </span>
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setDone(null);
                  setDraft(fill(EMPTY_DRAFT));
                  setStep('details');
                  setErrors({});
                  router.replace('/documents/requests/new');
                }}
              >
                Create Another Request
              </Button>
              <Button variant="secondary" onClick={() => router.push('/documents/requests')}>
                Back to Document Requests
              </Button>
              <Button onClick={() => router.push(`/documents/requests/${done.id}`)}>
                View Request
              </Button>
            </div>
          </div>
        ) : step === 'details' ? (
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <RecipientSection draft={view} onChange={patch} team={members} errors={errors} />
              <DetailsSection
                draft={view}
                types={templates.isError ? null : (types ?? [])}
                onType={setType}
                onChange={patch}
                errors={errors}
                extra={serviceField}
              />
              <DocumentsSection
                draft={view}
                templates={templates.isError ? null : (templates.data ?? [])}
                onItems={(items) => patch({ items })}
                onUseTemplate={addTemplate}
                errors={errors}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <MessageSection
                draft={view}
                onChange={patch}
                onPreview={() => setPreview(true)}
                errors={errors}
              />
              <OptionsSection draft={view} onChange={patch} errors={errors} />
            </div>
          </div>
        ) : step === 'documents' ? (
          <ChooseDocumentsStep
            draft={view}
            types={templates.isError ? null : (types ?? [])}
            saved={templates.isError ? null : (saved ?? [])}
            categories={categories.isError ? null : (categories.data ?? [])}
            loading={templates.isPending}
            onType={setType}
            onUseTemplate={addTemplate}
            onItems={(items) => patch({ items })}
            errors={errors}
          />
        ) : step === 'message' ? (
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <MessageSection
              draft={view}
              onChange={patch}
              onPreview={() => setPreview(true)}
              errors={errors}
              number={1}
            />
            <OptionsSection draft={view} onChange={patch} errors={errors} number={2} />
          </div>
        ) : (
          <ReviewStep draft={view} types={types ?? []} team={members} onEdit={setStep} />
        )}

        {failure ? (
          <p role="alert" className="rounded-card bg-danger-soft px-4 py-3 text-sm text-heading">
            {failure}
          </p>
        ) : step === 'review' && Object.keys(errors).length ? (
          <p role="alert" className="rounded-card bg-danger-soft px-4 py-3 text-sm text-heading">
            Some details are missing. Edit the parts above, then send.
          </p>
        ) : null}

        {done ? null : (
          <div className="flex flex-wrap justify-end gap-3">
            {step === 'details' ? (
              <Button variant="secondary" disabled={busy} onClick={() => void save(false)}>
                Save as Draft
              </Button>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={previous}>
                <ArrowLeft aria-hidden weight="bold" className="size-4" />
                Previous
              </Button>
            )}
            {step === 'review' ? (
              <Button disabled={busy} onClick={() => void save(true)}>
                {busy ? 'Sending…' : 'Send Request'}
                <ArrowRight aria-hidden weight="bold" className="size-4" />
              </Button>
            ) : (
              <Button disabled={busy} onClick={next}>
                Next: {step === 'documents' ? 'Message & Settings' : 'Review & Send'}
                <ArrowRight aria-hidden weight="bold" className="size-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      <PreviewDialog open={preview} onClose={() => setPreview(false)} draft={view} team={members} />
      <Modal
        open={leaving}
        title="Leave without saving?"
        onClose={() => setLeaving(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeaving(false)}>
              Keep Editing
            </Button>
            <Button onClick={() => router.push('/documents/requests')}>Leave</Button>
          </>
        }
      >
        <p className="text-sm text-text">
          This request is not saved. Save it as a draft to finish it later, or leave to discard it.
        </p>
      </Modal>
    </div>
  );
}
