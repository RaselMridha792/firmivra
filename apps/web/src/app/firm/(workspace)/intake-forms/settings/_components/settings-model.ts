import {
  ApiRequestError,
  INTAKE_FILE_SIZE_CHOICES,
  type IntakeSettings,
  type PortalInfo,
  UpdateIntakeSettingsRequest,
} from '@firmivra/types';

// Intake Form Settings (intake-form-settings.jpg; guide Frame 5): what the page edits, what it
// sends, and the numbers and checks it derives. Pure functions, so the screen stays small.

/** Every query of the Intake Forms pages starts with ['intake-forms'], so one invalidate refreshes all. */
export const INTAKE_KEY = ['intake-forms'] as const;
export const SETTINGS_KEY = [...INTAKE_KEY, 'settings'] as const;
export const CHANGES_KEY = [...SETTINGS_KEY, 'changes'] as const;

/** The eight categories of the left nav. Submission Rules and Integrations have no card. */
export type SectionId =
  | 'general'
  | 'client'
  | 'notifications'
  | 'automation'
  | 'submission'
  | 'branding'
  | 'security'
  | 'integrations';

/** The DOM id of a category's card, for the nav, the Edit links and the checklist. */
export const sectionDomId = (id: SectionId) => `intake-settings-${id}`;

type SecurityInput = NonNullable<UpdateIntakeSettingsRequest['security']>;
export type FileType = NonNullable<SecurityInput['acceptedFileTypes']>[number];
/** The upload types the API accepts (UpdateIntakeSettingsRequest), in its order. */
export const FILE_TYPES: readonly FileType[] = [
  'PDF',
  'JPG',
  'PNG',
  'HEIC',
  'DOC',
  'DOCX',
  'XLS',
  'XLSX',
  'CSV',
];
const isFileType = (code: string): code is FileType =>
  (FILE_TYPES as readonly string[]).includes(code);

/** What the cards edit: the settings with ids for the owners and '' for empty text. */
export interface Draft {
  general: {
    defaultExpirationDays: number | null;
    allowSaveAndResume: boolean;
    requireSignature: boolean;
    autoSubmissionId: boolean;
    defaultOwnerUserId: string | null;
  };
  clientExperience: {
    showProgressBar: boolean;
    mobileFriendly: boolean;
    thankYouMessage: string;
    redirectAfterCompletion: boolean;
    redirectUrl: string;
  };
  notifications: IntakeSettings['notifications'];
  automation: {
    autoCreateClient: boolean;
    autoCreateFollowUpTask: boolean;
    routeByServiceType: boolean;
    defaultFollowUpOwnerUserId: string | null;
  };
  branding: IntakeSettings['branding'];
  security: { acceptedFileTypes: FileType[]; maxFileSizeMb: number; consentRequired: boolean };
}
export type Group = keyof Draft;
const GROUPS: Group[] = [
  'general',
  'clientExperience',
  'notifications',
  'automation',
  'branding',
  'security',
];

export function toDraft(s: IntakeSettings): Draft {
  return {
    general: {
      defaultExpirationDays: s.general.defaultExpirationDays,
      allowSaveAndResume: s.general.allowSaveAndResume,
      requireSignature: s.general.requireSignature,
      autoSubmissionId: s.general.autoSubmissionId,
      defaultOwnerUserId: s.general.defaultOwner?.userId ?? null,
    },
    clientExperience: {
      showProgressBar: s.clientExperience.showProgressBar,
      mobileFriendly: s.clientExperience.mobileFriendly,
      thankYouMessage: s.clientExperience.thankYouMessage ?? '',
      redirectAfterCompletion: s.clientExperience.redirectAfterCompletion,
      redirectUrl: s.clientExperience.redirectUrl ?? '',
    },
    notifications: { ...s.notifications },
    automation: {
      autoCreateClient: s.automation.autoCreateClient,
      autoCreateFollowUpTask: s.automation.autoCreateFollowUpTask,
      routeByServiceType: s.automation.routeByServiceType,
      defaultFollowUpOwnerUserId: s.automation.defaultFollowUpOwner?.userId ?? null,
    },
    branding: { ...s.branding },
    security: {
      acceptedFileTypes: s.security.acceptedFileTypes.filter(isFileType),
      maxFileSizeMb: s.security.maxFileSizeMb,
      consentRequired: s.security.consentRequired,
    },
  };
}

/** Text goes out trimmed, and '' clears it (null). */
const wire = (value: unknown) =>
  typeof value === 'string' ? value.trim() || null : Array.isArray(value) ? [...value] : value;
const same = (a: unknown, b: unknown) => JSON.stringify(wire(a)) === JSON.stringify(wire(b));

type Changes = Omit<UpdateIntakeSettingsRequest, 'version'>;

/** Only the fields that changed, by group ("only the groups sent change"). */
export function changesOf(next: Draft, before: Draft): Changes {
  const body: Record<string, Record<string, unknown>> = {};
  for (const group of GROUPS) {
    const a: Record<string, unknown> = { ...next[group] };
    const b: Record<string, unknown> = { ...before[group] };
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(a)) {
      // The client pages always fit a phone: the API refuses false, so it is never sent.
      if (group === 'clientExperience' && key === 'mobileFriendly') continue;
      if (!same(a[key], b[key])) changed[key] = wire(a[key]);
    }
    if (Object.keys(changed).length) body[group] = changed;
  }
  // Checked against the contract before sending (UpdateIntakeSettingsRequest.safeParse).
  return body as Changes;
}

export type FieldErrors = Record<string, string>;

/** The rules the API checks too, so the message shows next to its field before a round trip. */
export function validate(draft: Draft, body: UpdateIntakeSettingsRequest): FieldErrors {
  const errors: FieldErrors = {};
  const c = draft.clientExperience;
  const url = c.redirectUrl.trim();
  if (c.redirectAfterCompletion && !url)
    errors['clientExperience.redirectUrl'] = 'Add the address to send clients to';
  else if (url && !/^https:\/\/\S+$/i.test(url))
    errors['clientExperience.redirectUrl'] = 'Use a web address that starts with https://';
  const n = draft.notifications;
  if (
    n.firstReminderAfterDays !== null &&
    n.finalReminderAfterDays !== null &&
    n.finalReminderAfterDays <= n.firstReminderAfterDays
  )
    errors['notifications.finalReminderAfterDays'] = 'The final reminder comes after the first';
  if (draft.security.acceptedFileTypes.length === 0)
    errors['security.acceptedFileTypes'] = 'Choose at least one file type';
  const parsed = UpdateIntakeSettingsRequest.safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join('.');
      errors[path] ??= issue.message;
    }
  }
  return errors;
}

/** The API's `{ path, message }` lines (400 VALIDATION_FAILED), by field. */
export function apiFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiRequestError) || !error.details?.length) return {};
  return Object.fromEntries(error.details.map((d) => [d.path, d.message]));
}

/** A list of choices that always holds the saved value, so a select never shows a wrong one. */
export function withCurrent(values: readonly number[], current: number | null): number[] {
  const all = current === null ? [...values] : [...values, current];
  return [...new Set(all)].sort((a, b) => a - b);
}
export const EXPIRATION_DAYS = [7, 14, 21, 30, 45, 60, 90];
/**
 * Days after sending, in both reminder lists (Octavia's I8: 1 and 2 days added). Her minutes and
 * hours need a column (`first_reminder_days` is whole days): a written item, not built.
 */
export const REMINDER_DAYS = [1, 2, 3, 5, 7, 10, 14, 21, 30];
/**
 * Hours before expiry (Octavia's I9): 72, 42, 24 and 12 as she saw them (42, not 48), and 10, 6,
 * 5, 3, 2 and 1. Her 30 minutes needs a column (`expiry_alert_hours` is whole hours).
 */
export const ALERT_HOURS = [1, 2, 3, 5, 6, 10, 12, 24, 42, 72];
/** The first of the reminder days after `days`: the final reminder comes strictly after the first. */
export const nextReminderDay = (days: number) => REMINDER_DAYS.find((d) => d > days) ?? null;
/**
 * Max file size per file, in MB: INTAKE_FILE_SIZE_CHOICES (Octavia's I10), plus the firm's saved
 * size when it is not one of them (a 25 MB saved before), so the select shows it as it is and the
 * firm can go back to it before saving. Once the firm saves another size, the old one is no longer
 * offered (the API refuses it as a change). `editing` is the draft's size, always kept so the
 * select never shows a wrong one (a draft from settings saved since elsewhere).
 */
export function fileSizeOptions(saved: number | null, editing: number | null = null): number[] {
  return withCurrent(withCurrent(INTAKE_FILE_SIZE_CHOICES, saved), editing);
}

/** The on/off settings, as saved; the Active Settings card counts the ones that are on. */
export function switches(s: IntakeSettings): boolean[] {
  return [
    s.general.allowSaveAndResume,
    s.general.requireSignature,
    s.general.autoSubmissionId,
    s.clientExperience.showProgressBar,
    s.clientExperience.mobileFriendly,
    s.clientExperience.redirectAfterCompletion,
    s.notifications.sendClientConfirmation,
    s.notifications.notifyAssignedStaff,
    s.automation.autoCreateClient,
    s.automation.autoCreateFollowUpTask,
    s.automation.routeByServiceType,
    s.branding.useFirmBranding,
    s.security.encryptedUploads,
    s.security.consentRequired,
  ];
}

/** Email Reminders is on while any reminder is scheduled. */
export const remindersOn = (s: IntakeSettings) =>
  s.notifications.firstReminderAfterDays !== null ||
  s.notifications.finalReminderAfterDays !== null ||
  s.notifications.expirationAlertHours !== null;

export interface Check {
  id: string;
  label: string;
  done: boolean;
  /** Why it is (not) done, shown under View All. */
  detail: string;
  section: SectionId;
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * The Settings Checklist: real checks on the saved settings and the firm's branding, never a
 * tick only because a switch is on (guide Frame 5, 3 of 3). Automation rules are optional, so
 * Ready to use does not wait for them.
 */
export function checklist(s: IntakeSettings, brand: PortalInfo['branding'] | null): Check[] {
  const g = s.general;
  const general = g.defaultOwner !== null && g.defaultExpirationDays !== null;
  const c = s.clientExperience;
  const client = c.thankYouMessage !== null && (!c.redirectAfterCompletion || !!c.redirectUrl);
  const n = s.notifications;
  const notify = n.sendClientConfirmation || n.notifyAssignedStaff;
  const rules = s.automation.automationRuleCount;
  const sec = s.security;
  const security = sec.consentRequired && sec.acceptedFileTypes.length > 0;
  const hasLogo = !!(brand?.logoUrl || brand?.logoLightUrl);
  const branding = s.branding.useFirmBranding && hasLogo;
  const ready = general && client && notify && security && branding;
  return [
    {
      id: 'general',
      label: 'General settings configured',
      done: general,
      detail: general
        ? `Forms close after ${days(g.defaultExpirationDays ?? 0)} and go to ${g.defaultOwner?.name ?? ''}.`
        : 'Choose the assigned owner for new forms.',
      section: 'general',
    },
    {
      id: 'client',
      label: 'Client experience customized',
      done: client,
      detail: client
        ? 'Clients see your own thank-you message.'
        : c.thankYouMessage === null
          ? 'Write the thank-you message clients see after they submit.'
          : 'Add the address clients go to after they submit.',
      section: 'client',
    },
    {
      id: 'notifications',
      label: 'Email notifications enabled',
      done: notify,
      detail: notify
        ? [
            n.sendClientConfirmation ? 'Clients get a confirmation email.' : null,
            n.notifyAssignedStaff ? 'The assigned staff member is told.' : null,
          ]
            .filter(Boolean)
            .join(' ')
        : 'No email goes out when a form is submitted.',
      section: 'notifications',
    },
    {
      id: 'automation',
      label: 'Automation rules set',
      done: (rules ?? 0) > 0,
      detail:
        rules === undefined
          ? 'The number of automation rules is not available yet.'
          : rules > 0
            ? `${rules} ${rules === 1 ? 'rule uses' : 'rules use'} intake events in Automations.`
            : 'No rule in Automations uses intake events yet (optional).',
      section: 'automation',
    },
    {
      id: 'security',
      label: 'Security settings configured',
      done: security,
      detail: security
        ? 'Uploads are encrypted and clients confirm consent.'
        : sec.acceptedFileTypes.length === 0
          ? 'Choose the file types clients may upload.'
          : 'Turn on the consent checkbox.',
      section: 'security',
    },
    {
      id: 'branding',
      label: 'Branding updated',
      done: branding,
      detail: branding
        ? "Forms show your firm's logo and colors."
        : !s.branding.useFirmBranding
          ? 'Client-facing forms use the default look.'
          : brand === null
            ? "Your firm's branding could not be checked right now."
            : "Add your firm's logo in Settings > Branding.",
      section: 'branding',
    },
    {
      id: 'ready',
      label: 'Ready to use',
      done: ready,
      detail: ready
        ? 'Every check above is done (automation rules are optional).'
        : 'Finish the checks above first (automation rules are optional).',
      section: 'general',
    },
  ];
}

const timeOfDay = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const fullDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** "Today at 10:24 AM" or "Sep 11, 2026 2:15 PM", as Recent Changes writes them. */
export function changedAt(iso: string, now: number): string {
  const at = new Date(iso);
  const today = new Date(now);
  if (at.toDateString() === today.toDateString()) return `Today at ${timeOfDay.format(at)}`;
  return `${fullDate.format(at)} ${timeOfDay.format(at)}`;
}
