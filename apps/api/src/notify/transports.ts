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
}

export interface OutgoingSms {
  to: string;
  text: string;
}

export interface EmailTransport {
  send(mail: OutgoingEmail): Promise<void>;
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

/**
 * `"Name" <address>` for a From header. The name loses quotes, backslashes, control and format
 * characters (bidi overrides, zero-width marks); a name outside ASCII becomes RFC 2047 encoded
 * words.
 */
export function formatSender(from: Sender): string {
  const name = (from.name ?? '')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}"\\]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  async send(mail: OutgoingEmail): Promise<void> {
    const utf8 = (Data: string) => ({ Data, Charset: 'UTF-8' });
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: formatSender(mail.from),
        Destination: { ToAddresses: [mail.to] },
        ...(mail.replyTo ? { ReplyToAddresses: [mail.replyTo] } : {}),
        Content: {
          Simple: {
            Subject: utf8(mail.subject),
            Body: { Text: utf8(mail.text), Html: utf8(mail.html) },
          },
        },
      }),
    );
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
  }): Promise<unknown>;
}

/** An SMTP server without login: Mailpit locally (development and test only, see config). */
export class SmtpEmailTransport implements EmailTransport {
  constructor(private readonly transporter: MailTransporter) {}

  async send(mail: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({
      from: { name: mail.from.name ?? '', address: mail.from.address },
      to: mail.to,
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
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
