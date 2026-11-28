import { Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  type BookCrmDemoRequest,
  type CreateCrmDemoRequest,
  type CreateCrmJourneyRequest,
  type CrmConsent,
  type CrmDemo,
  type CrmDemoAppointment,
  type CrmDemoList,
  type CrmDemosQuery,
  type CrmEnrollment,
  type CrmEnrollmentList,
  type CrmJourney,
  type CrmJourneyDetail,
  type CrmJourneyList,
  type CrmJourneysQuery,
  CrmJourneySteps,
  type CrmJourneyVersion,
  type EnrollCrmContactRequest,
  type SaveCrmConsentRequest,
  type SaveCrmJourneyVersionRequest,
  type StopCrmEnrollmentRequest,
  type UpdateCrmDemoAppointmentRequest,
  type UpdateCrmDemoRequest,
  type UpdateCrmJourneyRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { asCrmError, notFound, refuse } from './crm-errors.js';

type Out<S extends z.ZodType> = z.output<S>;
const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

const demoInclude = {
  contact: { select: { id: true, name: true, email: true } },
  appointments: { orderBy: { scheduledAt: 'asc' } },
} satisfies Prisma.SalesDemoRequestInclude;
type DemoRow = Prisma.SalesDemoRequestGetPayload<{ include: typeof demoInclude }>;
type AppointmentRow = DemoRow['appointments'][number];

const enrollmentInclude = {
  contact: { select: { id: true, name: true, email: true } },
  version: { select: { version: true } },
  executions: { orderBy: { stepIndex: 'asc' } },
} satisfies Prisma.SalesNurtureEnrollmentInclude;
type EnrollmentRow = Prisma.SalesNurtureEnrollmentGetPayload<{ include: typeof enrollmentInclude }>;

/**
 * Super Admin Leads & CRM, backend P0 (Q35): consent and suppression, versioned nurture journeys
 * with explicit enrollment, and demos, on the Sales contacts and opportunities. Platform data in
 * the signed-in Super Admin's admin scope (never a firm's); every change lands with its audit row
 * in one transaction. The sender that works through due steps is not part of P0.
 */
@Injectable()
export class CrmService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
  ) {}

  // ---------- Consent ----------

  consent(contactId: string): Promise<CrmConsent> {
    return this.admin.transaction(async (tx) => {
      await this.contactOrThrow(tx, contactId);
      const row = await tx.salesLeadConsent.findUnique({ where: { contactId } });
      return consentView(contactId, row);
    });
  }

  saveConsent(contactId: string, body: Out<typeof SaveCrmConsentRequest>): Promise<CrmConsent> {
    return this.run(async (tx, me) => {
      await this.contactOrThrow(tx, contactId);
      const before = await tx.salesLeadConsent.findUnique({ where: { contactId } });
      const now = new Date();
      const data = {
        consented: body.consented,
        // The first time consent is given, kept while it stays given.
        consentedAt: body.consented ? (before?.consented ? before.consentedAt : now) : null,
        consentSource: body.consented
          ? (body.consentSource ?? before?.consentSource ?? null)
          : null,
        suppressed: body.suppressed,
        suppressedAt: body.suppressed ? (before?.suppressed ? before.suppressedAt : now) : null,
        suppressionReason: body.suppressed ? (body.suppressionReason ?? null) : null,
        updatedByUserId: me,
      };
      const row = await tx.salesLeadConsent.upsert({
        where: { contactId },
        create: { contactId, ...data },
        update: data,
      });
      // Stop rule: a suppressed contact leaves every journey they are on.
      const stopped =
        body.suppressed && !before?.suppressed
          ? await this.stopAll(tx, { contactId, status: 'ACTIVE' }, 'suppressed')
          : 0;
      await this.log(tx, 'crm_consent.saved', 'sales_contact', contactId, {
        consented: row.consented,
        suppressed: row.suppressed,
        enrollmentsStopped: stopped,
      });
      return consentView(contactId, row);
    });
  }

  // ---------- Journeys ----------

  journeys(query: Out<typeof CrmJourneysQuery>): Promise<CrmJourneyList> {
    return this.admin.transaction(async (tx) => {
      const rows = await tx.salesNurtureJourney.findMany({
        where: query.status ? { status: query.status } : {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      });
      return { items: rows.map((r) => journeyView(r, r._count.enrollments)) };
    });
  }

  journey(id: string): Promise<CrmJourneyDetail> {
    return this.admin.transaction((tx) => this.journeyDetail(tx, id));
  }

  createJourney(body: Out<typeof CreateCrmJourneyRequest>): Promise<CrmJourneyDetail> {
    return this.run(async (tx, me) => {
      const row = await tx.salesNurtureJourney.create({
        data: { name: body.name, description: body.description ?? null, createdByUserId: me },
      });
      await this.log(tx, 'crm_journey.created', 'sales_nurture_journey', row.id, {});
      return this.journeyDetail(tx, row.id);
    });
  }

  updateJourney(id: string, body: Out<typeof UpdateCrmJourneyRequest>): Promise<CrmJourneyDetail> {
    return this.run(async (tx) => {
      const row = await this.journeyOrThrow(tx, id);
      if (row.status === 'ARCHIVED') throw refuse('JOURNEY_ARCHIVED');
      if (body.status === 'ACTIVE' && !row.currentVersionId) throw refuse('NO_PUBLISHED_VERSION');
      await tx.salesNurtureJourney.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
      });
      // Archiving ends the journey for everyone on it.
      const stopped =
        body.status === 'ARCHIVED'
          ? await this.stopAll(tx, { journeyId: id, status: 'ACTIVE' }, 'journey_archived')
          : 0;
      await this.log(tx, 'crm_journey.updated', 'sales_nurture_journey', id, {
        fields: Object.keys(body),
        ...(body.status ? { from: row.status, to: body.status } : {}),
        enrollmentsStopped: stopped,
      });
      return this.journeyDetail(tx, id);
    });
  }

  /** A new draft version: the next number, starting from the steps given. One draft at a time. */
  createVersion(
    journeyId: string,
    body: Out<typeof SaveCrmJourneyVersionRequest>,
  ): Promise<CrmJourneyVersion> {
    return this.run(async (tx, me) => {
      const journey = await this.journeyOrThrow(tx, journeyId);
      if (journey.status === 'ARCHIVED') throw refuse('JOURNEY_ARCHIVED');
      const versions = await tx.salesNurtureJourneyVersion.findMany({
        where: { journeyId },
        select: { version: true, publishedAt: true },
      });
      if (versions.some((v) => !v.publishedAt)) throw refuse('DRAFT_EXISTS');
      await this.templatesOrThrow(tx, body.steps);
      const row = await tx.salesNurtureJourneyVersion.create({
        data: {
          journeyId,
          version: Math.max(0, ...versions.map((v) => v.version)) + 1,
          steps: body.steps,
          createdByUserId: me,
        },
      });
      await this.log(tx, 'crm_journey_version.created', 'sales_nurture_journey', journeyId, {
        version: row.version,
        steps: body.steps.length,
      });
      return versionView(row);
    }, 'DRAFT_EXISTS');
  }

  updateVersion(
    journeyId: string,
    versionId: string,
    body: Out<typeof SaveCrmJourneyVersionRequest>,
  ): Promise<CrmJourneyVersion> {
    return this.run(async (tx) => {
      const version = await this.versionOrThrow(tx, journeyId, versionId);
      if (version.publishedAt) throw refuse('VERSION_PUBLISHED');
      await this.templatesOrThrow(tx, body.steps);
      const row = await tx.salesNurtureJourneyVersion.update({
        where: { id: versionId },
        data: { steps: body.steps },
      });
      await this.log(tx, 'crm_journey_version.updated', 'sales_nurture_journey', journeyId, {
        version: row.version,
        steps: body.steps.length,
      });
      return versionView(row);
    });
  }

  /** Publishes a draft: it becomes the journey's current version and the journey goes live. */
  publishVersion(journeyId: string, versionId: string): Promise<CrmJourneyDetail> {
    return this.run(async (tx) => {
      const journey = await this.journeyOrThrow(tx, journeyId);
      if (journey.status === 'ARCHIVED') throw refuse('JOURNEY_ARCHIVED');
      const version = await this.versionOrThrow(tx, journeyId, versionId);
      if (version.publishedAt) throw refuse('VERSION_PUBLISHED');
      const steps = CrmJourneySteps.parse(version.steps);
      if (steps.length === 0) throw refuse('EMPTY_JOURNEY');
      // A template may have been archived since the draft was saved.
      await this.templatesOrThrow(tx, steps);
      await tx.salesNurtureJourneyVersion.update({
        where: { id: versionId },
        data: { publishedAt: new Date() },
      });
      await tx.salesNurtureJourney.update({
        where: { id: journeyId },
        data: {
          currentVersionId: versionId,
          // A paused journey stays paused; publishing never resumes it.
          ...(journey.status === 'DRAFT' ? { status: 'ACTIVE' } : {}),
        },
      });
      await this.log(tx, 'crm_journey_version.published', 'sales_nurture_journey', journeyId, {
        version: version.version,
      });
      return this.journeyDetail(tx, journeyId);
    });
  }

  // ---------- Enrollments ----------

  enrollments(journeyId: string): Promise<CrmEnrollmentList> {
    return this.admin.transaction(async (tx) => {
      await this.journeyOrThrow(tx, journeyId);
      const rows = await tx.salesNurtureEnrollment.findMany({
        where: { journeyId },
        orderBy: [{ enrolledAt: 'desc' }, { id: 'desc' }],
        include: enrollmentInclude,
      });
      return { items: rows.map(enrollmentView) };
    });
  }

  /**
   * Enrolls a contact on the journey's current version and schedules each step (delays add up
   * from the enrollment). Only a contact who consented and is not suppressed.
   */
  enroll(journeyId: string, body: Out<typeof EnrollCrmContactRequest>): Promise<CrmEnrollment> {
    return this.run(async (tx, me) => {
      const journey = await this.journeyOrThrow(tx, journeyId);
      if (journey.status !== 'ACTIVE') throw refuse('JOURNEY_NOT_ACTIVE');
      if (!journey.currentVersionId) throw refuse('NO_PUBLISHED_VERSION');
      await this.contactOrThrow(tx, body.contactId);
      const consent = await tx.salesLeadConsent.findUnique({
        where: { contactId: body.contactId },
      });
      if (consent?.suppressed) throw refuse('SUPPRESSED');
      if (!consent?.consented) throw refuse('NO_CONSENT');
      const already = await tx.salesNurtureEnrollment.findUnique({
        where: { journeyId_contactId: { journeyId, contactId: body.contactId } },
        select: { id: true },
      });
      if (already) throw refuse('ALREADY_ENROLLED');
      const version = await this.versionOrThrow(tx, journeyId, journey.currentVersionId);
      const steps = CrmJourneySteps.parse(version.steps);
      const enrolledAt = new Date();
      let due = enrolledAt.getTime();
      const row = await tx.salesNurtureEnrollment.create({
        data: {
          journeyId,
          versionId: version.id,
          contactId: body.contactId,
          enrolledAt,
          enrolledByUserId: me,
          executions: {
            create: steps.map((step, stepIndex) => {
              due += step.delayDays * DAY_MS;
              return { stepIndex, scheduledAt: new Date(due) };
            }),
          },
        },
        include: enrollmentInclude,
      });
      await this.log(tx, 'crm_enrollment.created', 'sales_nurture_enrollment', row.id, {
        journeyId,
        contactId: body.contactId,
        version: version.version,
      });
      return enrollmentView(row);
    }, 'ALREADY_ENROLLED');
  }

  stopEnrollment(id: string, body: Out<typeof StopCrmEnrollmentRequest>): Promise<CrmEnrollment> {
    return this.run(async (tx) => {
      const row = await tx.salesNurtureEnrollment.findUnique({ where: { id } });
      if (!row) throw notFound('Enrollment');
      if (row.status !== 'ACTIVE') throw refuse('ENROLLMENT_CLOSED');
      await this.stopAll(tx, { id }, body.reason);
      await this.log(tx, 'crm_enrollment.stopped', 'sales_nurture_enrollment', id, {
        journeyId: row.journeyId,
      });
      return enrollmentView(
        await tx.salesNurtureEnrollment.findUniqueOrThrow({
          where: { id },
          include: enrollmentInclude,
        }),
      );
    });
  }

  // ---------- Demos ----------

  demos(query: Out<typeof CrmDemosQuery>): Promise<CrmDemoList> {
    return this.admin.transaction(async (tx) => {
      const rows = await tx.salesDemoRequest.findMany({
        where: query.status ? { status: query.status } : {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: demoInclude,
      });
      return { items: rows.map(demoView) };
    });
  }

  demo(id: string): Promise<CrmDemo> {
    return this.admin.transaction((tx) => this.demoOrThrow(tx, id).then(demoView));
  }

  createDemo(body: Out<typeof CreateCrmDemoRequest>): Promise<CrmDemo> {
    return this.run(async (tx, me) => {
      await this.contactOrThrow(tx, body.contactId);
      if (body.opportunityId) {
        const opp = await tx.salesOpportunity.findUnique({
          where: { id: body.opportunityId },
          select: { contactId: true },
        });
        if (!opp) throw notFound('Opportunity');
        if (opp.contactId !== body.contactId) throw refuse('OPPORTUNITY_MISMATCH');
      }
      const row = await tx.salesDemoRequest.create({
        data: {
          contactId: body.contactId,
          opportunityId: body.opportunityId ?? null,
          topic: body.topic ?? null,
          preferredTime: body.preferredTime ?? null,
          notes: body.notes ?? null,
          createdByUserId: me,
        },
        include: demoInclude,
      });
      await this.log(tx, 'crm_demo.created', 'sales_demo_request', row.id, {
        contactId: body.contactId,
        opportunityId: row.opportunityId,
      });
      return demoView(row);
    });
  }

  updateDemo(id: string, body: Out<typeof UpdateCrmDemoRequest>): Promise<CrmDemo> {
    return this.run(async (tx) => {
      const before = await this.demoOrThrow(tx, id);
      if (isClosed(before.status) && body.status !== undefined && body.status !== before.status)
        throw refuse('DEMO_CLOSED');
      await tx.salesDemoRequest.update({
        where: { id },
        data: {
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.topic !== undefined ? { topic: body.topic } : {}),
          ...(body.preferredTime !== undefined ? { preferredTime: body.preferredTime } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
      });
      // Cancelling the request cancels what is still booked, and its follow-ups.
      if (body.status === 'CANCELLED') {
        const open = before.appointments.filter((a) => a.status === 'SCHEDULED');
        await tx.salesDemoAppointment.updateMany({
          where: { id: { in: open.map((a) => a.id) } },
          data: { status: 'CANCELLED' },
        });
        await this.cancelFollowUps(tx, open);
      }
      await this.log(tx, 'crm_demo.updated', 'sales_demo_request', id, {
        fields: Object.keys(body),
        ...(body.status ? { from: before.status, to: body.status } : {}),
      });
      return demoView(await this.demoOrThrow(tx, id));
    });
  }

  /**
   * Books an appointment on a request. The request becomes SCHEDULED; on an opportunity, a DEMO
   * follow-up is added there (assigned to the Super Admin who booked) and linked.
   */
  book(requestId: string, body: Out<typeof BookCrmDemoRequest>): Promise<CrmDemo> {
    return this.run(async (tx, me) => {
      const request = await this.demoOrThrow(tx, requestId);
      if (isClosed(request.status)) throw refuse('DEMO_CLOSED');
      const scheduledAt = new Date(body.scheduledAt);
      const minutes = body.durationMinutes ?? 30;
      const followUp = request.opportunityId
        ? await tx.salesFollowUp.create({
            data: {
              opportunityId: request.opportunityId,
              kind: 'DEMO',
              title: request.topic ? `Demo: ${request.topic}` : 'Demo',
              dueAt: scheduledAt,
              endsAt: new Date(scheduledAt.getTime() + minutes * 60_000),
              location: body.videoLink ?? null,
              assignedToUserId: me,
              createdByUserId: me,
            },
            select: { id: true },
          })
        : null;
      const appointment = await tx.salesDemoAppointment.create({
        data: {
          requestId,
          scheduledAt,
          durationMinutes: minutes,
          videoLink: body.videoLink ?? null,
          notes: body.notes ?? null,
          followUpId: followUp?.id ?? null,
          createdByUserId: me,
        },
      });
      await tx.salesDemoRequest.update({ where: { id: requestId }, data: { status: 'SCHEDULED' } });
      await this.log(tx, 'crm_demo.booked', 'sales_demo_request', requestId, {
        appointmentId: appointment.id,
        followUpId: followUp?.id ?? null,
      });
      return demoView(await this.demoOrThrow(tx, requestId));
    });
  }

  updateAppointment(
    id: string,
    body: Out<typeof UpdateCrmDemoAppointmentRequest>,
  ): Promise<CrmDemoAppointment> {
    return this.run(async (tx) => {
      const before = await tx.salesDemoAppointment.findUnique({ where: { id } });
      if (!before) throw notFound('Appointment');
      if (before.status !== 'SCHEDULED') throw refuse('DEMO_CLOSED');
      const row = await tx.salesDemoAppointment.update({
        where: { id },
        data: {
          ...(body.scheduledAt !== undefined ? { scheduledAt: new Date(body.scheduledAt) } : {}),
          ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes } : {}),
          ...(body.videoLink !== undefined ? { videoLink: body.videoLink } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
      });
      // The request follows its appointment's outcome.
      if (body.status && body.status !== 'SCHEDULED') {
        const others = await tx.salesDemoAppointment.count({
          where: { requestId: row.requestId, status: 'SCHEDULED' },
        });
        if (others === 0)
          await tx.salesDemoRequest.update({
            where: { id: row.requestId },
            data: { status: body.status === 'CANCELLED' ? 'PENDING' : body.status },
          });
      }
      await this.syncFollowUp(tx, row);
      await this.log(tx, 'crm_demo_appointment.updated', 'sales_demo_request', row.requestId, {
        appointmentId: id,
        fields: Object.keys(body),
        ...(body.status ? { from: before.status, to: body.status } : {}),
      });
      return appointmentView(row);
    });
  }

  // ---------- Helpers ----------

  /** One admin-scope transaction with the signed-in Super Admin's id; database refusals mapped. */
  private async run<T>(
    work: (tx: TxClient, me: string) => Promise<T>,
    unique?: Parameters<typeof asCrmError>[1],
  ): Promise<T> {
    try {
      const me = this.admin.adminUserId;
      return await this.admin.transaction((tx) => work(tx, me));
    } catch (error) {
      throw asCrmError(error, unique);
    }
  }

  private log(
    tx: TxClient,
    action: string,
    type: string,
    id: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.logIn(tx, action, { type, id }, metadata, { businessId: null });
  }

  private async contactOrThrow(tx: TxClient, id: string) {
    const row = await tx.salesContact.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw notFound('Contact');
  }

  private async journeyOrThrow(tx: TxClient, id: string) {
    const row = await tx.salesNurtureJourney.findUnique({ where: { id } });
    if (!row) throw notFound('Journey');
    return row;
  }

  private async versionOrThrow(tx: TxClient, journeyId: string, id: string) {
    const row = await tx.salesNurtureJourneyVersion.findFirst({ where: { id, journeyId } });
    if (!row) throw notFound('Journey version');
    return row;
  }

  private async demoOrThrow(tx: TxClient, id: string): Promise<DemoRow> {
    const row = await tx.salesDemoRequest.findUnique({ where: { id }, include: demoInclude });
    if (!row) throw notFound('Demo request');
    return row;
  }

  /** Every step's template is an active email template. */
  private async templatesOrThrow(tx: TxClient, steps: Out<typeof CrmJourneySteps>) {
    const ids = [...new Set(steps.map((s) => s.templateId))];
    if (ids.length === 0) return;
    const usable = await tx.commTemplate.count({
      where: { id: { in: ids }, channel: 'EMAIL', status: 'ACTIVE' },
    });
    if (usable !== ids.length) throw refuse('TEMPLATE_NOT_USABLE');
  }

  private async journeyDetail(tx: TxClient, id: string): Promise<CrmJourneyDetail> {
    const row = await tx.salesNurtureJourney.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version: 'desc' } },
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    });
    if (!row) throw notFound('Journey');
    return { ...journeyView(row, row._count.enrollments), versions: row.versions.map(versionView) };
  }

  /** Stops the matching enrollments and skips their steps still to send; how many stopped. */
  private async stopAll(
    tx: TxClient,
    where: Prisma.SalesNurtureEnrollmentWhereInput,
    reason: string,
  ): Promise<number> {
    const rows = await tx.salesNurtureEnrollment.findMany({
      where: { ...where, status: 'ACTIVE' },
      select: { id: true },
    });
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    await tx.salesNurtureEnrollment.updateMany({
      where: { id: { in: ids } },
      data: { status: 'STOPPED', stoppedAt: new Date(), stopReason: reason },
    });
    await tx.salesNurtureExecution.updateMany({
      where: { enrollmentId: { in: ids }, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    return ids.length;
  }

  private async cancelFollowUps(tx: TxClient, appointments: AppointmentRow[]) {
    const ids = appointments.flatMap((a) => (a.followUpId ? [a.followUpId] : []));
    if (ids.length === 0) return;
    await tx.salesFollowUp.updateMany({
      where: { id: { in: ids }, status: 'SCHEDULED' },
      // The database stamps cancelled_at (sales_follow_ups_rules) and refuses one we send.
      data: { status: 'CANCELLED' },
    });
  }

  /** Keeps the linked DEMO follow-up in step with its appointment (time, link, outcome). */
  private async syncFollowUp(tx: TxClient, a: AppointmentRow) {
    if (!a.followUpId) return;
    const followUp = await tx.salesFollowUp.findUnique({ where: { id: a.followUpId } });
    if (!followUp || followUp.status !== 'SCHEDULED') return;
    if (a.status === 'SCHEDULED') {
      await tx.salesFollowUp.update({
        where: { id: followUp.id },
        data: {
          dueAt: a.scheduledAt,
          endsAt: new Date(a.scheduledAt.getTime() + a.durationMinutes * 60_000),
          location: a.videoLink,
        },
      });
    } else if (a.status === 'COMPLETED') {
      await tx.salesFollowUp.update({
        where: { id: followUp.id },
        // completed_at is the database's stamp, as cancelled_at above.
        data: { status: 'COMPLETED' },
      });
    } else {
      await this.cancelFollowUps(tx, [a]);
    }
  }
}

const isClosed = (status: string) => ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(status);

function consentView(
  contactId: string,
  row: Prisma.SalesLeadConsentGetPayload<object> | null,
): CrmConsent {
  return {
    contactId,
    consented: row?.consented ?? false,
    consentedAt: isoOrNull(row?.consentedAt ?? null),
    consentSource: row?.consentSource ?? null,
    suppressed: row?.suppressed ?? false,
    suppressedAt: isoOrNull(row?.suppressedAt ?? null),
    suppressionReason: row?.suppressionReason ?? null,
    updatedAt: isoOrNull(row?.updatedAt ?? null),
  };
}

function journeyView(
  row: Prisma.SalesNurtureJourneyGetPayload<object>,
  activeEnrollments: number,
): CrmJourney {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    currentVersionId: row.currentVersionId,
    activeEnrollments,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function versionView(row: Prisma.SalesNurtureJourneyVersionGetPayload<object>): CrmJourneyVersion {
  return {
    id: row.id,
    journeyId: row.journeyId,
    version: row.version,
    steps: CrmJourneySteps.parse(row.steps),
    publishedAt: isoOrNull(row.publishedAt),
    createdAt: iso(row.createdAt),
  };
}

function enrollmentView(row: EnrollmentRow): CrmEnrollment {
  return {
    id: row.id,
    journeyId: row.journeyId,
    versionId: row.versionId,
    version: row.version.version,
    contact: row.contact,
    status: row.status,
    enrolledAt: iso(row.enrolledAt),
    completedAt: isoOrNull(row.completedAt),
    stoppedAt: isoOrNull(row.stoppedAt),
    stopReason: row.stopReason,
    steps: row.executions.map((e) => ({
      stepIndex: e.stepIndex,
      status: e.status,
      scheduledAt: iso(e.scheduledAt),
      sentAt: isoOrNull(e.sentAt),
      retryCount: e.retryCount,
    })),
  };
}

function appointmentView(row: AppointmentRow): CrmDemoAppointment {
  return {
    id: row.id,
    requestId: row.requestId,
    scheduledAt: iso(row.scheduledAt),
    durationMinutes: row.durationMinutes,
    videoLink: row.videoLink,
    status: row.status,
    notes: row.notes,
    followUpId: row.followUpId,
  };
}

function demoView(row: DemoRow): CrmDemo {
  return {
    id: row.id,
    contact: row.contact,
    opportunityId: row.opportunityId,
    topic: row.topic,
    status: row.status,
    preferredTime: row.preferredTime,
    notes: row.notes,
    createdAt: iso(row.createdAt),
    appointments: row.appointments.map(appointmentView),
  };
}
