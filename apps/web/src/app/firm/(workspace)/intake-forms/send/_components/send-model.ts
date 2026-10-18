import type {
  FormDeliveryChannel,
  QuestionType,
  ReminderSchedule,
  SaveSendDraftRequest,
  SendIntakeFormRequest,
} from '@firmivra/types';

/** Who the form goes to: a client or a lead from the firm's own lists. */
export interface Recipient {
  kind: 'CLIENT' | 'LEAD';
  id: string;
  name: string;
  /** For "Hi <first name>," in the default message. */
  firstName: string;
  email: string | null;
  phone: string | null;
  /** True for a client with an active portal login; a lead has no portal access. */
  portal: boolean;
}

/** A firm member for Assign To. */
export interface Member {
  userId: string;
  name: string;
}

/** Edit Schedule: left out values use the firm's defaults. */
export type Schedule = Omit<ReminderSchedule, 'enabled'>;

export type FieldKey =
  'recipient' | 'formId' | 'channel' | 'subject' | 'message' | 'dueOn' | 'expiresOn';
export type FieldErrors = Partial<Record<FieldKey, string>>;

export const MESSAGE_MAX = 500;

export const CHANNEL_LABELS: Record<FormDeliveryChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  PORTAL: 'Client Portal',
};

export interface ChannelState {
  available: boolean;
  /** The address under the option: the email, the phone, or why it can't be used. */
  detail: string;
}

/** Whether the chosen recipient can receive the form this way, and the address shown. */
export function channelState(
  recipient: Recipient | undefined,
  channel: FormDeliveryChannel,
): ChannelState {
  if (channel === 'PORTAL') {
    if (!recipient) return { available: true, detail: 'Send via client portal' };
    return recipient.portal
      ? { available: true, detail: 'Send via client portal' }
      : { available: false, detail: 'No portal access' };
  }
  if (channel === 'SMS') {
    if (!recipient) return { available: true, detail: 'Mobile number' };
    return recipient.phone
      ? { available: true, detail: recipient.phone }
      : { available: false, detail: 'No mobile number' };
  }
  if (!recipient) return { available: true, detail: 'Email address' };
  return recipient.email
    ? { available: true, detail: recipient.email }
    : { available: false, detail: 'No email on file' };
}

/** The channel to keep after choosing a recipient: the current one if it works, else the first that does. */
export function usableChannel(
  recipient: Recipient,
  current: FormDeliveryChannel,
): FormDeliveryChannel {
  if (channelState(recipient, current).available) return current;
  const order: FormDeliveryChannel[] = ['EMAIL', 'SMS', 'PORTAL'];
  return order.find((c) => channelState(recipient, c).available) ?? current;
}

/** "Email (name@example.test)" for the summary. */
export function deliverySummary(
  recipient: Recipient | undefined,
  channel: FormDeliveryChannel,
): string {
  const state = channelState(recipient, channel);
  if (channel === 'PORTAL' || !recipient || !state.available) return CHANNEL_LABELS[channel];
  return `${CHANNEL_LABELS[channel]} (${state.detail})`;
}

/** The Ready to Send line for the chosen route. */
export function routeLine(recipient: Recipient | undefined, channel: FormDeliveryChannel): string {
  const who = recipient?.kind === 'LEAD' ? 'The lead' : 'The client';
  if (channel === 'SMS')
    return `${who} will receive a text message with a secure link to access and complete the form.`;
  if (channel === 'PORTAL')
    return `${who} will find the form in their client portal and complete it after signing in.`;
  return `${who} will receive an email with a secure link to access and complete the form.`;
}

export const defaultSubject = (formName: string | undefined) =>
  formName ? `Your ${formName}` : '';

/** A short default message; the staff member can rewrite it. */
export function defaultMessage(
  recipient: Recipient | undefined,
  formName: string | undefined,
  sender: string,
  firm: string,
): string {
  const hello = `Hi ${recipient?.firstName ?? 'there'},`;
  const ask = `Please complete your ${formName ?? 'intake form'} at your earliest convenience. It helps us prepare everything we need for you.`;
  return [
    hello,
    '',
    ask,
    '',
    'If you have any questions, feel free to reach out.',
    '',
    'Thank you,',
    sender,
    firm,
  ].join('\n');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-10" as "Oct 10, 2026" (no time zone shift: the date is a calendar day). */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const month = m ? MONTHS[m - 1] : undefined;
  return y && month && d ? `${month} ${d}, ${y}` : day;
}

/** Today in the browser's time zone, as YYYY-MM-DD. Call it from an event handler. */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SHORT_ANSWER: 'Short answer',
  PARAGRAPH: 'Paragraph',
  MULTIPLE_CHOICE: 'Multiple choice',
  CHECKBOXES: 'Checkboxes',
  DROPDOWN: 'Dropdown',
  DATE: 'Date',
  FILE_UPLOAD: 'File upload',
  NUMBER: 'Number',
  CURRENCY: 'Currency',
  EMAIL: 'Email',
  PHONE: 'Phone',
  YES_NO: 'Yes / No',
  SIGNATURE: 'Signature',
  SECTION_BREAK: 'Section break',
  INSTRUCTION_TEXT: 'Instructions',
};

/** Everything the screen has chosen, in one place for the request bodies. */
export interface SendChoices {
  recipient: Recipient | undefined;
  formId: string;
  channel: FormDeliveryChannel;
  subject: string;
  message: string;
  dueOn: string;
  expiresOn: string;
  assignee: Member | undefined;
  reminders: boolean;
  schedule: Schedule;
  allowSave: boolean;
  sendMeCopy: boolean;
}

const recipientRef = (r: Recipient) =>
  r.kind === 'CLIENT' ? { kind: 'CLIENT' as const, id: r.id } : { kind: 'LEAD' as const, id: r.id };

const reminderBody = (c: SendChoices): ReminderSchedule =>
  c.reminders ? { enabled: true, ...c.schedule } : { enabled: false };

/** POST /business/intakes/send. Call only after `validate` found nothing. */
export function sendBody(
  c: SendChoices,
  recipient: Recipient,
  idempotencyKey: string,
): SendIntakeFormRequest {
  return {
    idempotencyKey,
    recipient: recipientRef(recipient),
    formId: c.formId,
    channel: c.channel,
    subject: c.subject.trim(),
    message: c.message.trim(),
    dueOn: c.dueOn || null,
    expiresOn: c.expiresOn || null,
    assignedUserId: c.assignee?.userId ?? null,
    reminders: reminderBody(c),
    allowSaveAndContinue: c.allowSave,
    sendMeCopy: c.channel === 'EMAIL' && c.sendMeCopy,
  };
}

/** Save as Draft: whatever is filled in so far; nothing is sent. */
export function draftBody(c: SendChoices): SaveSendDraftRequest {
  const subject = c.subject.trim();
  const message = c.message.trim();
  return {
    ...(c.recipient ? { recipient: recipientRef(c.recipient) } : {}),
    ...(c.formId ? { formId: c.formId } : {}),
    channel: c.channel,
    ...(subject ? { subject } : {}),
    ...(message ? { message } : {}),
    dueOn: c.dueOn || null,
    expiresOn: c.expiresOn || null,
    assignedUserId: c.assignee?.userId ?? null,
    reminders: reminderBody(c),
    allowSaveAndContinue: c.allowSave,
    sendMeCopy: c.channel === 'EMAIL' && c.sendMeCopy,
  };
}

/** What is still missing before Send Form, for the summary's "not ready" note. */
export function missingSteps(c: SendChoices, formChosen: boolean): string[] {
  const missing: string[] = [];
  if (!c.recipient) missing.push('choose a recipient');
  if (!formChosen) missing.push('choose a form');
  if (c.recipient && !channelState(c.recipient, c.channel).available)
    missing.push('choose a delivery method this recipient can receive');
  if (!c.subject.trim()) missing.push('add a subject');
  if (!c.message.trim()) missing.push('write a message');
  return missing;
}

/** The checks before Send Form; the request schema then catches what is left (length, characters). */
export function validate(
  c: SendChoices,
  kind: Recipient['kind'],
  formChosen: boolean,
  day: string,
): FieldErrors {
  const e: FieldErrors = {};
  if (!c.recipient) e.recipient = kind === 'CLIENT' ? 'Choose a client' : 'Choose a lead';
  if (!formChosen) e.formId = 'Choose a form';
  if (c.recipient && !channelState(c.recipient, c.channel).available)
    e.channel = 'Choose a delivery method this recipient can receive';
  if (!c.subject.trim()) e.subject = 'Enter a subject';
  if (!c.message.trim()) e.message = 'Enter a message';
  if (c.dueOn && c.dueOn < day) e.dueOn = 'Choose today or a later date';
  if (c.expiresOn && c.expiresOn < day) e.expiresOn = 'Choose today or a later date';
  else if (c.dueOn && c.expiresOn && c.expiresOn < c.dueOn)
    e.expiresOn = 'Choose a date on or after the due date';
  return e;
}
