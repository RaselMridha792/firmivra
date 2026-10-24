import { Inject, Injectable } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type {
  MessageTemplateKind,
  PreviewTemplateRequest,
  RenderedTemplate,
} from '@firmivra/types';
import type { ClientsActor } from '../clients/clients.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { LIVE_TASK, liveClient } from '../tasks/task-common.js';
import { notFound } from '../workspaces/common.js';
import { sanitize, stripTags } from './html.js';
import { BUILT_IN_FIELDS, fill, smsLength } from './merge-fields.js';
import { PLAIN_KINDS } from './templates.common.js';

/** What a render needs from a template: the master text, never a client's data. */
export interface Renderable {
  kind: MessageTemplateKind;
  subject: string | null;
  previewText: string | null;
  body: string;
}

type Values = Map<string, string>;

const put = (values: Values, key: string, value: string | null | undefined) => {
  if (value !== null && value !== undefined && value !== '') values.set(key.toLowerCase(), value);
};

function dateIn(timeZone: string, at: Date, style: 'date' | 'time' | 'short'): string {
  const options: Intl.DateTimeFormatOptions =
    style === 'time'
      ? { hour: 'numeric', minute: '2-digit' }
      : style === 'short'
        ? { year: 'numeric', month: 'long', day: 'numeric' }
        : { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(at);
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

/**
 * Fills a template from live records at use time. The master template is never rewritten with one
 * client's data: this returns the rendered text and leaves the template as it is. A value is data,
 * never markup (escaped in HTML), and a field no value resolves is listed, not blanked. The result
 * is sanitized again after rendering. Other modules (Communications, Automations, Appointments)
 * call `render` and then record the use.
 */
@Injectable()
export class TemplateRenderService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private portal(slug: string, path = '') {
    return `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${slug}${path}`;
  }

  /** The made-up values of a preview without a client. Custom fields show their fallback or key. */
  async sampleValues(tx: TxClient, businessId: string): Promise<Values> {
    const values: Values = new Map(BUILT_IN_FIELDS.map((f) => [f.key.toLowerCase(), f.example]));
    for (const c of await tx.customMergeField.findMany({ where: { businessId } })) {
      put(values, c.key, c.fallback ?? `Sample ${c.label}`);
    }
    return values;
  }

  /**
   * The values for one use: the firm, the person acting (Staff fields), the client when given, and
   * the appointment, invoice or task by id. Every id is looked up inside the firm: another firm's
   * id is NOT_FOUND, as an unknown one. Nothing sensitive is added unless its record is named.
   */
  async liveValues(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    ids: Pick<PreviewTemplateRequest, 'clientId' | 'appointmentId' | 'invoiceId' | 'taskId'>,
  ): Promise<Values> {
    const values: Values = new Map();
    const firm = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { name: true, slug: true },
    });
    const settings = await tx.businessSettings.findUnique({ where: { businessId } });
    const zone = settings?.timezone ?? 'America/New_York';

    put(values, 'Business Name', firm.name);
    put(values, 'Company Phone', settings?.contactPhone);
    put(values, 'Company Email', settings?.contactEmail);
    put(values, 'Company Website', settings?.website);
    const address = [
      settings?.addressLine1,
      settings?.addressLine2,
      [settings?.city, [settings?.state, settings?.postalCode].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', '),
    ]
      .filter(Boolean)
      .join(', ');
    put(values, 'Company Address', address);

    const me = await tx.membership.findFirst({
      where: { businessId, userId: actor.userId },
      select: { user: { select: { name: true, email: true, phone: true } } },
    });
    put(values, 'Staff Name', me?.user.name);
    put(values, 'Preparer Name', me?.user.name);
    put(values, 'Advisor Name', me?.user.name);
    put(values, 'Staff Email', me?.user.email);
    put(values, 'Staff Phone', me?.user.phone);

    put(values, 'Client Portal Link', this.portal(firm.slug));
    put(values, 'Portal Message Link', this.portal(firm.slug, '/messages'));
    put(values, 'Reschedule Link', this.portal(firm.slug, '/appointments'));
    put(values, 'Document Upload Link', this.portal(firm.slug, '/documents'));

    if (ids.clientId) await this.client(tx, businessId, actor, ids.clientId, values);
    if (ids.appointmentId) {
      await this.appointment(tx, businessId, actor, ids.appointmentId, zone, values);
    }
    if (ids.invoiceId)
      await this.invoice(tx, businessId, actor, ids.invoiceId, zone, firm.slug, values);
    if (ids.taskId) await this.task(tx, businessId, actor, ids.taskId, values);

    for (const c of await tx.customMergeField.findMany({ where: { businessId } })) {
      put(values, c.key, c.fallback);
    }
    return values;
  }

  /** A client the actor may reach: Staff only the clients assigned to them (404 otherwise). */
  private async reachable(tx: TxClient, businessId: string, actor: ClientsActor, clientId: string) {
    const client = await tx.client.findFirst({
      where: { businessId, id: clientId },
      select: {
        id: true,
        displayName: true,
        email: true,
        phone: true,
        assignedUserId: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    });
    if (!client || (actor.role === 'STAFF' && client.assignedUserId !== actor.userId)) {
      throw notFound();
    }
    return client;
  }

  private async client(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    values: Values,
  ) {
    const c = await this.reachable(tx, businessId, actor, clientId);
    const [first, ...rest] = c.displayName.split(' ');
    put(values, 'Client First Name', c.profile?.firstName ?? first);
    put(values, 'Client Last Name', c.profile?.lastName ?? (rest.join(' ') || null));
    put(values, 'Client Full Name', c.displayName);
    put(values, 'Email Address', c.email);
    put(values, 'Phone Number', c.phone);
  }

  private async appointment(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    zone: string,
    values: Values,
  ) {
    const a = await tx.appointment.findFirst({
      where: { businessId, id },
      select: {
        clientId: true,
        startsAt: true,
        timeZone: true,
        locationDetails: true,
        type: { select: { name: true } },
        service: { select: { name: true } },
      },
    });
    if (!a) throw notFound();
    await this.reachable(tx, businessId, actor, a.clientId);
    const at = a.timeZone ?? zone;
    put(values, 'Appointment Date', dateIn(at, a.startsAt, 'date'));
    put(values, 'Appointment Time', dateIn(at, a.startsAt, 'time'));
    put(values, 'Appointment Type', a.type?.name);
    put(values, 'Appointment Location/Link', a.locationDetails);
    put(values, 'Service Name', a.service?.name);
  }

  private async invoice(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    zone: string,
    slug: string,
    values: Values,
  ) {
    const i = await tx.invoice.findFirst({
      where: { businessId, id },
      select: {
        clientId: true,
        number: true,
        status: true,
        currency: true,
        totalCents: true,
        issuedAt: true,
        dueOn: true,
      },
    });
    if (!i) throw notFound();
    await this.reachable(tx, businessId, actor, i.clientId);
    put(values, 'Invoice Number', i.number);
    if (i.issuedAt) put(values, 'Invoice Date', dateIn(zone, i.issuedAt, 'short'));
    if (i.dueOn) put(values, 'Due Date', dateIn('UTC', i.dueOn, 'short'));
    put(
      values,
      'Payment Status',
      i.status === 'PAID' ? 'Paid' : i.status === 'OPEN' ? 'Open' : null,
    );
    // Money is the invoice's total while it is open and nothing once paid; partial payments are
    // not summed here, so a field this cannot be sure of stays unresolved.
    if (i.status === 'PAID') put(values, 'Balance Due', money(0, i.currency));
    if (i.status === 'OPEN') put(values, 'Payment Link', this.portal(slug, `/invoices/${id}/pay`));
  }

  private async task(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    values: Values,
  ) {
    const t = await tx.task.findFirst({
      where: { businessId, id, ...LIVE_TASK },
      select: { clientId: true, title: true, service: { select: { name: true } } },
    });
    if (!t) throw notFound();
    await this.reachable(tx, businessId, actor, liveClient(t.clientId));
    put(values, 'Task Name', t.title);
    put(values, 'Service Name', t.service?.name);
  }

  /** `sample` values given by the caller win over everything (a preview only). */
  withSample(values: Values, sample: Record<string, string> | undefined): Values {
    const merged: Values = new Map(values);
    for (const [key, value] of Object.entries(sample ?? {})) put(merged, key.trim(), value);
    return merged;
  }

  /**
   * The template rendered: the subject and preview as plain text, the body as safe HTML (an
   * email, letter, notice...) or plain text (SMS and task checklists). `unresolved` lists the
   * fields no value filled, across the subject, preview and body.
   */
  render(t: Renderable, values: Values, isSample: boolean): RenderedTemplate {
    const plain = PLAIN_KINDS.has(t.kind);
    const body = fill(t.body, values, plain ? 'text' : 'html');
    const subject = t.subject === null ? null : fill(t.subject, values, 'text');
    const preview = t.previewText === null ? null : fill(t.previewText, values, 'text');
    const unresolved = [...new Set([subject, preview, body].flatMap((r) => r?.unresolved ?? []))];
    const text = plain ? stripTags(body.text) : sanitize(body.text).html;
    return {
      subject: subject ? stripTags(subject.text) : null,
      previewText: preview ? stripTags(preview.text) : null,
      body: text,
      unresolved,
      sample: isSample,
      sms: t.kind === 'SMS' ? smsLength(text) : null,
    };
  }
}
