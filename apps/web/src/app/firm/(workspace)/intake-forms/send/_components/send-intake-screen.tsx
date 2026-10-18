'use client';

import { CaretRight } from '@phosphor-icons/react';
import {
  type FormDeliveryChannel,
  type SaveSendDraftRequest,
  SendIntakeFormRequest,
  type SendIntakeFormResult,
} from '@firmivra/types';
import { PageHeader } from '@firmivra/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { useMe } from '../../../../../../components/signed-in';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { DeliveryPanel } from './delivery-panel';
import { FormPanel } from './form-panel';
import { MessagePanel } from './message-panel';
import { RecipientPanel } from './recipient-panel';
import { ReviewPanel } from './review-panel';
import { ScheduleModal } from './schedule-modal';
import {
  defaultMessage,
  defaultSubject,
  draftBody,
  type FieldErrors,
  type FieldKey,
  missingSteps,
  type Recipient,
  type Schedule,
  type SendChoices,
  sendBody,
  today,
  usableChannel,
  validate,
} from './send-model';

/** The screen's own reads, under the module's key so a send refreshes the dashboard too. */
const INTAKE_KEY = ['intake-forms'];
const FORMS_KEY = ['intake-forms', 'send', 'forms'];

/** The API's codes for Send Form, in the words the screen shows. */
const SEND_ERRORS: Record<string, string> = {
  FORM_ALREADY_OPEN:
    'This recipient already has this form open. Open it from Intake Forms to resend it instead.',
  PORTAL_UNAVAILABLE: 'This recipient has no client portal access. Choose Email or SMS.',
  SMS_UNAVAILABLE:
    "Text messages can't be sent to this recipient right now. Choose Email or Client Portal.",
  FORM_PUBLISHED: 'This form is not published yet. Publish it before sending.',
};

const FIELD_KEYS: readonly string[] = [
  'recipient',
  'formId',
  'channel',
  'subject',
  'message',
  'dueOn',
  'expiresOn',
] satisfies FieldKey[];
const isFieldKey = (key: unknown): key is FieldKey =>
  typeof key === 'string' && FIELD_KEYS.includes(key);

/** Subject and message are null until edited: until then they follow the recipient and form. */
interface State extends Omit<SendChoices, 'subject' | 'message'> {
  subject: string | null;
  message: string | null;
}

const start = (formId: string): State => ({
  recipient: undefined,
  formId,
  channel: 'EMAIL',
  subject: null,
  message: null,
  dueOn: '',
  expiresOn: '',
  assignee: undefined,
  reminders: true,
  schedule: {},
  allowSave: true,
  sendMeCopy: true,
});

/**
 * Send Intake Form (Frame 2): pick a client or lead, a published form, the route, the message
 * and settings, then Send Form or Save as Draft. The summary follows every change. Each frame
 * loads its own data and keeps its frame with a quiet line when that data is missing or the API
 * is unreachable. Opened as /intake-forms/send?formId=... (Use Template, Save & Send) the form is
 * chosen already.
 */
export function SendIntakeScreen({ initialFormId }: { initialFormId: string }) {
  const { me } = useMe();
  const { firm } = useFirm();
  const forms = useApiQuery(FORMS_KEY, () =>
    api.intakeForms.forms({ templates: 'all', status: 'PUBLISHED' }),
  );
  const send = useApiMutation((body: SendIntakeFormRequest) => api.intakeForms.send(body), {
    invalidate: INTAKE_KEY,
  });
  const saveDraft = useApiMutation((input: { body: SaveSendDraftRequest; id?: string }) =>
    api.intakeForms.saveSendDraft(input.body, input.id),
  );

  const [kind, setKind] = useState<Recipient['kind']>('CLIENT');
  const [state, setState] = useState<State>(() => start(initialFormId));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [draftId, setDraftId] = useState<string>();
  const [result, setResult] = useState<SendIntakeFormResult>();
  /** The last Send Form attempt: a retry after a network failure keeps its idempotency key. */
  const attempt = useRef<{ key: string; body: string; retry: boolean } | undefined>(undefined);

  const form = forms.data?.find((f) => f.id === state.formId);
  const choices: SendChoices = {
    ...state,
    subject: state.subject ?? defaultSubject(form?.name),
    message: state.message ?? defaultMessage(state.recipient, form?.name, me.user.name, firm.name),
  };
  const notPublished =
    !!initialFormId && state.formId === initialFormId && forms.isSuccess && !form;

  /** Changes some choices and drops the errors of the fields that changed. */
  function set(patch: Partial<State>) {
    setState((s) => ({ ...s, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(patch)) if (isFieldKey(key)) delete next[key];
      return next;
    });
    setNotice(undefined);
  }

  function chooseKind(next: Recipient['kind']) {
    if (next === kind) return;
    setKind(next);
    set({ recipient: undefined });
  }

  function chooseRecipient(recipient: Recipient | undefined) {
    set(
      recipient
        ? { recipient, channel: usableChannel(recipient, state.channel) }
        : { recipient: undefined },
    );
  }

  function onSend() {
    const found = validate(choices, kind, !!form, today());
    const recipient = choices.recipient;
    if (!recipient || Object.keys(found).length > 0) {
      setErrors(found);
      setNotice({ text: 'Check the highlighted fields.', tone: 'error' });
      return;
    }
    const fingerprint = JSON.stringify(sendBody(choices, recipient, ''));
    const last = attempt.current;
    const key = last?.retry && last.body === fingerprint ? last.key : crypto.randomUUID();
    const body = sendBody(choices, recipient, key);
    const parsed = SendIntakeFormRequest.safeParse(body);
    if (!parsed.success) {
      const fromSchema: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (isFieldKey(field) && !fromSchema[field]) fromSchema[field] = issue.message;
      }
      setErrors(fromSchema);
      setNotice({ text: 'Check the highlighted fields.', tone: 'error' });
      return;
    }
    setErrors({});
    setNotice(undefined);
    attempt.current = { key, body: fingerprint, retry: false };
    send.mutate(body, {
      onSuccess: (sent) => {
        attempt.current = undefined;
        setResult(sent);
      },
      onError: (error) => {
        // fetch rejects with a TypeError when the API can't be reached: the send may have
        // happened, so the same request keeps its key and the API answers it only once.
        attempt.current = { key, body: fingerprint, retry: error instanceof TypeError };
        setNotice({ text: errorMessage(error, SEND_ERRORS), tone: 'error' });
      },
    });
  }

  function onDraft() {
    setNotice(undefined);
    saveDraft.mutate(
      { body: draftBody(choices), id: draftId },
      {
        onSuccess: (draft) => {
          setDraftId(draft.id);
          setNotice({ text: 'Draft saved. Nothing was sent.', tone: 'success' });
        },
        onError: (error) => setNotice({ text: errorMessage(error), tone: 'error' }),
      },
    );
  }

  function sendAnother() {
    setKind('CLIENT');
    setState(start(''));
    setErrors({});
    setNotice(undefined);
    setDraftId(undefined);
    setResult(undefined);
    attempt.current = undefined;
    send.reset();
  }

  function saveSchedule(schedule: Schedule) {
    set({ schedule });
    setScheduleOpen(false);
  }

  return (
    <div className="flex flex-col gap-6" data-testid="send-intake-page">
      <PageHeader
        title="Send Intake Form"
        subtitle="Choose a client or lead, select a form, customize your message, and send it via email, SMS, or client portal."
        above={
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-base">
            <Link href="/intake-forms" className="text-heading hover:underline">
              Intake Forms
            </Link>
            <CaretRight aria-hidden weight="bold" className="size-3.5 text-heading" />
            <span aria-current="page" className="font-semibold text-heading">
              Send Intake Form
            </span>
          </nav>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4">
          <RecipientPanel
            kind={kind}
            onKind={chooseKind}
            recipient={state.recipient}
            onRecipient={chooseRecipient}
            error={errors.recipient}
          />
          <FormPanel
            forms={forms}
            formId={state.formId}
            onForm={(formId) => set({ formId })}
            error={errors.formId}
            notPublished={notPublished}
          />
          <DeliveryPanel
            recipient={state.recipient}
            channel={state.channel}
            onChannel={(channel: FormDeliveryChannel) => set({ channel })}
            error={errors.channel}
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <MessagePanel
            values={choices}
            set={set}
            errors={errors}
            onEditSchedule={() => setScheduleOpen(true)}
          />
        </div>
        <div className="flex min-w-0 flex-col lg:col-span-2 xl:col-span-1">
          <ReviewPanel
            choices={choices}
            formName={form?.name}
            missing={missingSteps(choices, !!form)}
            myEmail={me.user.email}
            onSendMeCopy={(sendMeCopy) => set({ sendMeCopy })}
            onEditSchedule={() => setScheduleOpen(true)}
            onSend={onSend}
            onDraft={onDraft}
            sending={send.isPending}
            drafting={saveDraft.isPending}
            notice={notice}
            result={result}
            onAnother={sendAnother}
          />
        </div>
      </div>
      <ScheduleModal
        open={scheduleOpen}
        schedule={state.schedule}
        onSave={saveSchedule}
        onClose={() => setScheduleOpen(false)}
      />
    </div>
  );
}
