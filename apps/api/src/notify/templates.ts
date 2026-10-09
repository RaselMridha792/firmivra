import { type Branding, FIRMIVRA_BRANDING, hexColor } from './branding.js';
import {
  ALWAYS_SENT,
  type NotifyTemplate,
  type NotifyTemplates,
  TEMPLATE_SENDER,
} from './notify.types.js';

/**
 * Subject, plain text and simple HTML for every template (R6 step 3). A message holds the
 * template's data and the sender's branding, nothing else: no address, no other record, no
 * amount. Every value is escaped in the HTML. A firm template names the firm the branding was
 * loaded for (`branding.name`), never a name from the data.
 */

/** The template or its data is wrong: a programming error, so NotifyService.send rejects. */
export class NotifyTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotifyTemplateError';
  }
}

export interface RenderedEmail {
  channel: 'email';
  /** The sender's name as the email shows it (cleaned like every other value). */
  fromName: string;
  subject: string;
  text: string;
  html: string;
}

export interface RenderedSms {
  channel: 'sms';
  text: string;
}

export interface RenderOptions {
  /** The email has a Reply-To (for example Firmivra support), so the text may ask for a reply. */
  canReply?: boolean;
  /**
   * The recipient can switch this message off (NotifyService: a firm's message to someone with an
   * account, not ALWAYS_SENT), so the footer may say where. Never for a bare address.
   */
  canOptOut?: boolean;
  /**
   * The origins a link may go to: the app, portal and admin sites from config (NotifyConfig's
   * `linkOrigins`). Without them every link is refused.
   */
  linkOrigins?: readonly string[];
}

/** One part of an email. Each becomes plain text and HTML. */
type Block =
  | { kind: 'text'; text: string }
  | { kind: 'small'; text: string }
  | { kind: 'code'; code: string }
  | { kind: 'quote'; label: string; text: string }
  | { kind: 'facts'; rows: [label: string, value: string][] }
  | { kind: 'button'; label: string; url: string };

type Content = { channel: 'email'; subject: string; blocks: Block[] } | RenderedSms;

// ---------- Values ----------

const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/gu;

/**
 * The sender's name for the header, the footer and the From line: one line, without format
 * characters (bidi overrides and isolates, zero-width marks), so a firm's name can't reverse or
 * hide part of what the inbox shows.
 */
export function senderName(value: string): string {
  return oneLine(value.replace(/\p{Cf}/gu, ''));
}

/** One line: line breaks, tabs and control characters become one space. */
function oneLine(value: string): string {
  return value
    .replace(BIDI_CONTROLS, '')
    .replace(/[\s\p{Cc}]+/gu, ' ')
    .trim();
}

/** Text that keeps its line breaks (a reason, a message); other control characters go. */
function multiLine(value: string): string {
  return value
    .replace(BIDI_CONTROLS, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Cc}/gu, (c) => (c === '\n' ? c : ' '))
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function field<D extends object>(data: D, key: keyof D & string): unknown {
  return (data as Record<string, unknown>)[key];
}

/** A text field the template needs, on one line. Missing or empty is a programming error. */
function required<D extends object>(data: D, key: keyof D & string): string {
  const value = field(data, key);
  const text = typeof value === 'string' ? oneLine(value) : '';
  if (!text) throw new NotifyTemplateError(`Template data needs ${key}`);
  return text;
}

/** Like `required`, keeping line breaks. */
function requiredText<D extends object>(data: D, key: keyof D & string): string {
  const value = field(data, key);
  const text = typeof value === 'string' ? multiLine(value) : '';
  if (!text) throw new NotifyTemplateError(`Template data needs ${key}`);
  return text;
}

/** A one-time code: one short word. */
function code(data: { code: string }): string {
  const value = required(data, 'code');
  if (value.length > 12 || value.includes(' ')) throw new NotifyTemplateError('Invalid code');
  return value;
}

/**
 * A link to one of Firmivra's own sites: its origin (scheme, host and port) must be exactly one of
 * `options.linkOrigins`, with no user name or password and no space, control or format character
 * anywhere. Returns the parsed, normalised form (the fragment of an activation link stays).
 */
function link<D extends object>(data: D, key: keyof D & string, options: RenderOptions): string {
  const value = field(data, key);
  const url =
    typeof value === 'string' && !/[\s\p{Cc}\p{Cf}]/u.test(value) ? URL.parse(value) : null;
  if (
    !url ||
    url.username !== '' ||
    url.password !== '' ||
    !(options.linkOrigins ?? []).includes(url.origin)
  ) {
    throw new NotifyTemplateError(`Template data needs ${key} as a link to a Firmivra site`);
  }
  return url.href;
}

/** For example "Tuesday, October 20, 2026 at 9:30 AM CDT", in the given zone. */
function dateTime<D extends object>(data: D, key: keyof D & string, timeZone: string): string {
  const value = field(data, key);
  const date = value instanceof Date ? value : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) throw new NotifyTemplateError(`Template data needs ${key}`);
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    throw new NotifyTemplateError('Template data needs an IANA time zone');
  }
  // Intl puts narrow and no-break spaces around the time; plain spaces read the same everywhere.
  return formatted.replace(/[\u00a0\u202f]/g, ' ');
}

/** A calendar date (YYYY-MM-DD) as "October 20, 2026"; it has no zone, so none is applied. */
function calendarDate(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = parts ? new Date(Date.UTC(+parts[1]!, +parts[2]! - 1, +parts[3]!)) : null;
  if (!date || date.toISOString().slice(0, 10) !== value) {
    throw new NotifyTemplateError('Template data needs dueOn as YYYY-MM-DD');
  }
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}

// ---------- Blocks ----------

const text = (value: string): Block => ({ kind: 'text', text: value });
const small = (value: string): Block => ({ kind: 'small', text: value });
const button = (label: string, url: string): Block => ({ kind: 'button', label, url });
const quote = (label: string, value: string): Block => ({ kind: 'quote', label, text: value });

/** "Hi Sam," or, without a name, "Hello,". */
function hello(data: { name: string }): Block {
  const name = field(data, 'name');
  const shown = typeof name === 'string' ? oneLine(name) : '';
  return text(shown ? `Hi ${shown},` : 'Hello,');
}

function appointment(
  data: NotifyTemplates['appointment.booked'],
  b: Branding,
  o: RenderOptions,
  intro: (firm: string) => string,
  subject: (firm: string) => string,
): Content {
  const firm = b.name;
  return {
    channel: 'email',
    subject: subject(firm),
    blocks: [
      hello(data),
      text(intro(firm)),
      {
        kind: 'facts',
        rows: [
          ['What', required(data, 'title')],
          ['When', dateTime(data, 'startsAt', required(data, 'timeZone'))],
        ],
      },
      button('View appointment', link(data, 'link', o)),
    ],
  };
}

// ---------- Templates ----------

type Build<T extends NotifyTemplate> = (
  data: NotifyTemplates[T],
  branding: Branding,
  options: RenderOptions,
) => Content;

const TEMPLATES: { [T in NotifyTemplate]: Build<T> } = {
  'staff.invite': (d, b, o) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `You're invited to join ${firm} on Firmivra`,
      blocks: [
        hello(d),
        text(`${firm} invited you to its workspace on Firmivra.`),
        button('Accept the invitation', link(d, 'link', o)),
        small(
          `The link works once, until ${dateTime(d, 'expiresAt', b.timeZone)}. If you did not expect this invitation, you can ignore this email.`,
        ),
      ],
    };
  },

  'client.signup-email-code': (d, b) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `Your ${firm} verification code`,
      blocks: [
        text(`Use this code to verify your email address for the ${firm} client portal:`),
        { kind: 'code', code: code(d) },
        small(
          'The code expires in a few minutes. Never share it. If you did not sign up, you can ignore this email.',
        ),
      ],
    };
  },

  'client.signup-sms-code': (d, b) => ({
    channel: 'sms',
    text: `${code(d)} is your ${b.name} verification code. Never share it.`,
  }),

  'client.already-registered': (d, b, o) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `You already have a ${firm} client portal account`,
      blocks: [
        text(
          `Someone started a sign-up for the ${firm} client portal with this email address. You already have an account, so no new one was made.`,
        ),
        button('Sign in', link(d, 'signInLink', o)),
        small(
          'If you forgot your password, you can reset it from the sign-in page. If this was not you, you can ignore this email.',
        ),
      ],
    };
  },

  'client.signup-approved': (d, b, o) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `Your ${firm} client portal account is ready`,
      blocks: [
        hello(d),
        text(`${firm} approved your account. You can now sign in to the client portal.`),
        button('Sign in', link(d, 'signInLink', o)),
      ],
    };
  },

  // No reason, even if the firm wrote one (Rasel, q18).
  'client.signup-declined': (d, b) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `Your ${firm} client portal sign-up`,
      blocks: [
        hello(d),
        text(`${firm} did not approve your client portal sign-up.`),
        text(`If you have questions, please contact ${firm} directly.`),
      ],
    };
  },

  // Fixed text only: the address is not verified yet, so nothing from the form may reach it
  // (else anyone could send Firmivra-signed text to any inbox). Later emails name the firm, once a
  // Super Admin has read the application.
  'firm-application.received': () => ({
    channel: 'email',
    subject: 'We received your Firmivra application',
    blocks: [
      text('Hello,'),
      text(
        "Thank you, we received your application. We review every application and we'll be in touch by email.",
      ),
    ],
  }),

  'firm-application.info-requested': (d, _b, options) => ({
    channel: 'email',
    subject: 'Your Firmivra application: more information needed',
    blocks: [
      hello(d),
      text(
        `We are reviewing the application for ${required(d, 'legalName')} and need more information.`,
      ),
      quote('What we need', requiredText(d, 'message')),
      ...(options.canReply ? [text('Reply to this email with the details.')] : []),
    ],
  }),

  'firm-application.approved': (d, b, o) => ({
    channel: 'email',
    subject: 'Your Firmivra application is approved',
    blocks: [
      hello(d),
      text(
        `${required(d, 'legalName')} is approved on Firmivra. Activate your account to set up the firm's workspace.`,
      ),
      button('Activate your account', link(d, 'link', o)),
      small(`The link works once, until ${dateTime(d, 'expiresAt', b.timeZone)}.`),
    ],
  }),

  'firm-application.declined': (d) => ({
    channel: 'email',
    subject: 'Your Firmivra application',
    blocks: [
      hello(d),
      text(
        `Thank you for applying to Firmivra for ${required(d, 'legalName')}. We are not able to approve the application.`,
      ),
      quote('Reason', requiredText(d, 'reason')),
    ],
  }),

  'document.requested': (d, b, o) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `${firm} requested a document`,
      blocks: [
        hello(d),
        text(`${firm} asked you to upload a document: ${required(d, 'title')}.`),
        ...(d.dueOn === null ? [] : [text(`Please upload it by ${calendarDate(d.dueOn)}.`)]),
        button('Open the client portal', link(d, 'link', o)),
      ],
    };
  },

  'appointment.booked': (d, b, o) =>
    appointment(
      d,
      b,
      o,
      (firm) => `Your appointment with ${firm} is booked.`,
      (firm) => `Your appointment with ${firm} is booked`,
    ),

  'appointment.changed': (d, b, o) =>
    appointment(
      d,
      b,
      o,
      (firm) => `Your appointment with ${firm} has changed. This is the new time:`,
      (firm) => `Your appointment with ${firm} has changed`,
    ),

  'appointment.reminder': (d, b, o) =>
    appointment(
      d,
      b,
      o,
      (firm) => `This is a reminder of your appointment with ${firm}.`,
      (firm) => `Reminder: your appointment with ${firm}`,
    ),

  'invoice.sent': (d, b, o) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `New invoice from ${firm}`,
      blocks: [
        hello(d),
        text(
          `${firm} sent you invoice ${required(d, 'invoiceNumber')}. Sign in to the client portal to see and pay it.`,
        ),
        button('View invoice', link(d, 'link', o)),
      ],
    };
  },

  'payment.received': (d, b, o) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `${firm} received your payment`,
      blocks: [
        hello(d),
        text(
          `Thank you. ${firm} received your payment for invoice ${required(d, 'invoiceNumber')}.`,
        ),
        button('View invoice', link(d, 'link', o)),
      ],
    };
  },

  'begin-online.resume-link': (d, b, o) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `Continue your request with ${firm}`,
      blocks: [
        text('Hello,'),
        text(`Here is your link to continue the request you started with ${firm}.`),
        button('Continue my request', link(d, 'link', o)),
        small(
          `The link works until ${dateTime(d, 'expiresAt', b.timeZone)}. A new link replaces this one. If you did not start a request, you can ignore this email.`,
        ),
      ],
    };
  },

  'lead.confirmation': (d, b) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `${firm} received your request`,
      blocks: [
        text('Hello,'),
        text(
          `Thank you. ${firm} received your request for ${required(d, 'serviceName')} and will be in touch by email.`,
        ),
        small('If you did not send this request, you can ignore this email.'),
      ],
    };
  },

  'lead.received': (d, b, o) => ({
    channel: 'email',
    subject: `New Begin Online request: ${required(d, 'serviceName')}`,
    blocks: [
      text('Hello,'),
      text(`${b.name} has a new Begin Online request for ${required(d, 'serviceName')}.`),
      button('Review the request', link(d, 'link', o)),
    ],
  }),

  'client.portal-invite': (d, b, o) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `${firm} invites you to its client portal`,
      blocks: [
        hello(d),
        text(
          `${firm} accepted your request. Create your client portal account with this email address to share documents, sign forms and message the firm.`,
        ),
        button('Create my account', link(d, 'signUpLink', o)),
      ],
    };
  },

  'message.new': (d, b, o) => {
    const firm = b.name;
    return {
      channel: 'email',
      subject: `New message on ${firm}`,
      blocks: [
        hello(d),
        text('You have a new message. Open it to read and reply.'),
        button('Read the message', link(d, 'link', o)),
      ],
    };
  },
};

// ---------- Layout ----------

/**
 * Literal colours and type: mail clients ignore CSS variables. They mirror packages/ui (text,
 * muted, border, canvas, subtle, link, font-sans).
 */
const INK = {
  text: '#273444',
  muted: '#52647A',
  border: '#D6E3EF',
  canvas: '#F3F8FC',
  subtle: '#F8FAFC',
  surface: '#FFFFFF',
  link: '#005FCC',
  font: 'Arial, Helvetica, sans-serif',
} as const;

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** White or dark text, whichever reads better on the colour (a firm may pick a light brand). */
function textOn(background: string): string {
  return contrast(background, INK.surface) >= contrast(background, INK.text)
    ? INK.surface
    : INK.text;
}

/** The logo only from a lasting https address. */
function logo(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Who sent it, and on a message the person can switch off (`canOptOut`, never ALWAYS_SENT) where
 * to do that: NotifyService reads the preferences since R6 step 5.
 */
function footer(branding: Branding, template: NotifyTemplate, canOptOut: boolean): string[] {
  return [
    branding.isFirm ? `Sent by ${branding.name} through Firmivra.` : 'Sent by Firmivra.',
    ...(!canOptOut || ALWAYS_SENT.has(template)
      ? []
      : ['You can turn off emails like this in your notification settings.']),
  ];
}

function plainText(blocks: Block[], brand: string, foot: string[]): string {
  const parts = blocks.map((block) => {
    switch (block.kind) {
      case 'text':
      case 'small':
        return block.text;
      case 'code':
        return `    ${block.code}`;
      case 'quote':
        return `${block.label}:\n${block.text.replace(/^/gm, '> ')}`;
      case 'facts':
        return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n');
      case 'button':
        return `${block.label}:\n${block.url}`;
    }
  });
  return [brand, ...parts, `--\n${foot.join('\n')}`].join('\n\n') + '\n';
}

function htmlBody(blocks: Block[], b: Branding): string {
  const primary = b.primaryColor;
  const accent = b.accentColor;
  const linkColour = contrast(primary, INK.surface) >= 4.5 ? primary : INK.link;
  const p = 'margin:0 0 16px;';
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'text':
          return `<p style="${p}">${escapeHtml(block.text)}</p>`;
        case 'small':
          return `<p style="${p}font-size:14px;color:${INK.muted};">${escapeHtml(block.text)}</p>`;
        case 'code':
          return `<p style="margin:8px 0 24px;font:bold 32px/1.2 'Courier New',Courier,monospace;letter-spacing:6px;">${escapeHtml(block.code)}</p>`;
        case 'quote':
          return (
            `<p style="margin:0 0 4px;font-weight:bold;">${escapeHtml(block.label)}</p>` +
            `<div style="${p}padding:12px 16px;background:${INK.subtle};border-left:4px solid ${accent};">` +
            `${escapeHtml(block.text).replace(/\n/g, '<br>')}</div>`
          );
        case 'facts':
          return (
            `<table role="presentation" cellpadding="0" cellspacing="0" style="${p}border-collapse:collapse;">` +
            block.rows
              .map(
                ([label, value]) =>
                  `<tr><td style="padding:4px 16px 4px 0;color:${INK.muted};vertical-align:top;">${escapeHtml(label)}</td>` +
                  `<td style="padding:4px 0;font-weight:bold;">${escapeHtml(value)}</td></tr>`,
              )
              .join('') +
            '</table>'
          );
        case 'button': {
          const href = escapeHtml(block.url);
          return (
            `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;padding:12px 20px;` +
            `background:${primary};color:${textOn(primary)};border:1px solid ${contrast(primary, INK.surface) >= 1.5 ? primary : INK.border};` +
            `border-radius:6px;font-weight:bold;text-decoration:none;">${escapeHtml(block.label)}</a></p>` +
            `<p style="${p}font-size:14px;color:${INK.muted};">Or open this link: ` +
            `<a href="${href}" style="color:${linkColour};word-break:break-all;">${href}</a></p>`
          );
        }
      }
    })
    .join('\n');
}

function html(subject: string, blocks: Block[], b: Branding, foot: string[]): string {
  const name = escapeHtml(b.name);
  const image = logo(b.logoUrl);
  const head = image
    ? `<img src="${escapeHtml(image)}" alt="${name}" height="40" style="display:block;height:40px;width:auto;border:0;margin:0 0 8px;">${name}`
    : name;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${INK.canvas};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK.canvas};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${INK.surface};border:1px solid ${INK.border};border-radius:8px;border-collapse:separate;">
<tr><td style="padding:20px 24px;background:${b.primaryColor};color:${textOn(b.primaryColor)};border-bottom:4px solid ${b.accentColor};border-radius:8px 8px 0 0;font:bold 20px/1.3 ${INK.font};">${head}</td></tr>
<tr><td style="padding:24px;color:${INK.text};font:16px/1.5 ${INK.font};">
${htmlBody(blocks, b)}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${INK.border};color:${INK.muted};font:12px/1.5 ${INK.font};">${foot.map(escapeHtml).join('<br>')}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

/**
 * Renders one message. Throws NotifyTemplateError for an unknown template or data the template
 * cannot use (a missing field, a link to anywhere but a Firmivra site, a bad date or time zone).
 */
export function render<T extends NotifyTemplate>(
  template: T,
  data: NotifyTemplates[T],
  branding: Branding,
  options: RenderOptions = {},
): RenderedEmail | RenderedSms {
  if (!Object.hasOwn(TEMPLATES, template)) {
    throw new NotifyTemplateError(`Unknown template ${template}`);
  }
  if (typeof data !== 'object' || data === null) {
    throw new NotifyTemplateError(`Template data missing for ${template}`);
  }
  if (branding.isFirm !== (TEMPLATE_SENDER[template] === 'firm')) {
    throw new NotifyTemplateError(
      `${template} is ${TEMPLATE_SENDER[template] === 'firm' ? "a firm's" : "Firmivra's own"} message`,
    );
  }
  const b: Branding = {
    ...branding,
    name: senderName(branding.name) || FIRMIVRA_BRANDING.name,
    primaryColor: hexColor(branding.primaryColor, FIRMIVRA_BRANDING.primaryColor),
    accentColor: hexColor(branding.accentColor, FIRMIVRA_BRANDING.accentColor),
  };
  const content = (TEMPLATES[template] as Build<T>)(data, b, options);
  if (content.channel === 'sms') return { channel: 'sms', text: oneLine(content.text) };
  const subject = oneLine(content.subject);
  const foot = footer(b, template, options.canOptOut === true);
  return {
    channel: 'email',
    fromName: b.name,
    subject,
    text: plainText(content.blocks, b.name, foot),
    html: html(subject, content.blocks, b, foot),
  };
}
