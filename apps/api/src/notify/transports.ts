import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';
import type { Sender } from './config.js';

/**
 * The providers behind NotifyService: SES or Mailpit for email, SNS for SMS. Each one only hands
 * over a rendered message; NotifyService turns any failure into an error without the address.
 */

export interface OutgoingEmail {
  from: Sender;
  to: string;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string;
  /** Files sent as attachments (SA-COM-R1/R3); none when absent. */
  attachments?: readonly OutgoingAttachment[];
}

export interface OutgoingAttachment {
  fileName: string;
  contentType: string;
  content: Uint8Array;
}

export interface OutgoingSms {
  to: string;
  text: string;
}

export interface EmailTransport {
  /** Resolves with the provider's message id when it gives one (SES MessageId, SMTP id). */
  send(mail: OutgoingEmail): Promise<string | void>;
}

export interface SmsTransport {
  send(sms: OutgoingSms): Promise<void>;
}

/** RFC 2047 keeps an encoded word to 75 characters: 45 bytes of UTF-8 in base64, plus 12. */
const ENCODED_WORD_BYTES = 45;

/** The name as RFC 2047 encoded words, split between characters so each stays within 75. */
function encodedWords(name: string): string {
  const words: string[] = [];
  let chunk = '';
  for (const char of name) {
    if (Buffer.byteLength(chunk + char, 'utf8') > ENCODED_WORD_BYTES) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(' ');
}

/** The longest From name, in characters (code points), so the header stays one short line. */
export const MAX_SENDER_NAME = 64;

/**
 * The name for a From header: without quotes, backslashes, control and format characters (bidi
 * overrides, zero-width marks); every "=?" broken up to "= ?", so a mail client can never decode
 * part of a firm's name as an RFC 2047 encoded word; then at most MAX_SENDER_NAME characters,
 * cut between code points (never inside a surrogate pair).
 */
export function senderDisplayName(name: string | null): string {
  const cleaned = (name ?? '')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}"\\]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/=\?/g, '= ?')
    .trim();
  return Array.from(cleaned).slice(0, MAX_SENDER_NAME).join('').trim();
}

/**
 * `"Name" <address>` for a From header, the name as senderDisplayName leaves it; a name outside
 * ASCII becomes RFC 2047 encoded words.
 */
export function formatSender(from: Sender): string {
  const name = senderDisplayName(from.name);
  if (!name) return from.address;
  const shown = /^[\x20-\x7e]*$/.test(name) ? `"${name}"` : encodedWords(name);
  return `${shown} <${from.address}>`;
}

/**
 * Amazon SES, v2 SendEmail with simple content. The request names no configuration set: the
 * email stack makes SES_CONFIGURATION_SET the identity's default, so SES applies it anyway, and
 * naming it would need ses:SendEmail on the configuration set too (the task role is granted the
 * identity only).
 */
export class SesEmailTransport implements EmailTransport {
  constructor(private readonly client: Pick<SESv2Client, 'send'>) {}

  async send(mail: OutgoingEmail): Promise<string | void> {
    const utf8 = (Data: string) => ({ Data, Charset: 'UTF-8' });
    const res = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: formatSender(mail.from),
        Destination: { ToAddresses: [mail.to] },
        ...(mail.replyTo ? { ReplyToAddresses: [mail.replyTo] } : {}),
        Content: {
          Simple: {
            Subject: utf8(mail.subject),
            Body: { Text: utf8(mail.text), Html: utf8(mail.html) },
            ...(mail.attachments?.length
              ? {
                  Attachments: mail.attachments.map((a) => ({
                    RawContent: a.content,
                    FileName: a.fileName,
                    ContentType: a.contentType,
                    ContentDisposition: 'ATTACHMENT' as const,
                    ContentTransferEncoding: 'BASE64' as const,
                  })),
                }
              : {}),
          },
        },
      }),
    );
    return (res as { MessageId?: string } | undefined)?.MessageId;
  }
}

/** What SmtpEmailTransport needs of a nodemailer transporter. */
export interface MailTransporter {
  sendMail(mail: {
    from: { name: string; address: string };
    to: string;
    replyTo?: string;
    subject: string;
    text: string;
    html: string;
    attachments?: { filename: string; contentType: string; content: Buffer }[];
  }): Promise<unknown>;
}

/** An SMTP server without login: Mailpit locally (development and test only, see config). */
export class SmtpEmailTransport implements EmailTransport {
  constructor(private readonly transporter: MailTransporter) {}

  async send(mail: OutgoingEmail): Promise<string | void> {
    const info = await this.transporter.sendMail({
      from: { name: senderDisplayName(mail.from.name), address: mail.from.address },
      to: mail.to,
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(mail.attachments?.length
        ? {
            attachments: mail.attachments.map((a) => ({
              filename: a.fileName,
              contentType: a.contentType,
              content: Buffer.from(a.content),
            })),
          }
        : {}),
    });
    const id = (info as { messageId?: unknown } | undefined)?.messageId;
    return typeof id === 'string' ? id : undefined;
  }
}

/** Amazon SNS SMS from the registered toll-free number, as transactional texts. */
export class SnsSmsTransport implements SmsTransport {
  constructor(
    private readonly client: Pick<SNSClient, 'send'>,
    private readonly originationNumber: string,
  ) {}

  async send(sms: OutgoingSms): Promise<void> {
    await this.client.send(
      new PublishCommand({
        PhoneNumber: sms.to,
        Message: sms.text,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
          'AWS.MM.SMS.OriginationNumber': {
            DataType: 'String',
            StringValue: this.originationNumber,
          },
        },
      }),
    );
  }
}
