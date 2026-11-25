import { Injectable } from '@nestjs/common';
import { PlatformPrisma } from '../database/database.module.js';

/**
 * Super Admin CRM service (Q35). Reuses existing SalesContact/SalesOpportunity
 * records; adds consent, nurture journeys, enrollments, executions, and demos.
 */
@Injectable()
export class CrmService {
  constructor(private readonly platform: PlatformPrisma) {}

  // --- Consent ---
  async getConsent(contactId: string) {
    return this.platform.db.salesLeadConsent.findUnique({
      where: { contactId },
    });
  }

  async upsertConsent(
    contactId: string,
    businessId: string,
    data: {
      consented: boolean;
      consentSource?: string;
      suppressed?: boolean;
      suppressionReason?: string;
    },
  ) {
    return this.platform.db.salesLeadConsent.upsert({
      where: { contactId },
      create: {
        businessId,
        contactId,
        consented: data.consented,
        consentedAt: data.consented ? new Date() : null,
        consentSource: data.consentSource ?? null,
        suppressed: data.suppressed ?? false,
        suppressedAt: data.suppressed ? new Date() : null,
        suppressionReason: data.suppressionReason ?? null,
      },
      update: {
        consented: data.consented,
        consentedAt: data.consented ? new Date() : undefined,
        consentSource: data.consentSource ?? undefined,
        suppressed: data.suppressed ?? undefined,
        suppressedAt: data.suppressed ? new Date() : undefined,
        suppressionReason: data.suppressionReason ?? undefined,
      },
    });
  }

  // --- Demo requests ---
  async listDemoRequests(businessId: string, status?: string) {
    return this.platform.db.salesDemoRequest.findMany({
      where: { businessId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { contact: true, appointments: true },
    });
  }

  async createDemoRequest(data: {
    businessId: string;
    contactId: string;
    opportunityId?: string;
    topic?: string;
    preferredTime?: string;
    notes?: string;
    createdByUserId?: string;
  }) {
    return this.platform.db.salesDemoRequest.create({
      data: {
        businessId: data.businessId,
        contactId: data.contactId,
        opportunityId: data.opportunityId ?? null,
        topic: data.topic ?? null,
        preferredTime: data.preferredTime ?? null,
        notes: data.notes ?? null,
        createdByUserId: data.createdByUserId ?? null,
      },
    });
  }

  async updateDemoRequest(id: string, data: { status?: string; notes?: string }) {
    return this.platform.db.salesDemoRequest.update({
      where: { id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
  }

  // --- Demo appointments ---
  async createDemoAppointment(data: {
    businessId: string;
    requestId: string;
    scheduledAt: Date;
    durationMinutes?: number;
    videoLink?: string;
    notes?: string;
    createdByUserId?: string;
  }) {
    return this.platform.db.salesDemoAppointment.create({
      data: {
        businessId: data.businessId,
        requestId: data.requestId,
        scheduledAt: data.scheduledAt,
        durationMinutes: data.durationMinutes ?? 30,
        videoLink: data.videoLink ?? null,
        notes: data.notes ?? null,
        createdByUserId: data.createdByUserId ?? null,
      },
    });
  }

  async listDemoAppointments(businessId: string, requestId?: string) {
    return this.platform.db.salesDemoAppointment.findMany({
      where: { businessId, ...(requestId ? { requestId } : {}) },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  // --- Nurture journeys ---
  async listJourneys(businessId: string, status?: string) {
    return this.platform.db.salesNurtureJourney.findMany({
      where: { businessId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
  }

  async createJourney(data: {
    businessId: string;
    name: string;
    description?: string;
    createdByUserId?: string;
  }) {
    return this.platform.db.salesNurtureJourney.create({
      data: {
        businessId: data.businessId,
        name: data.name,
        description: data.description ?? null,
        createdByUserId: data.createdByUserId ?? null,
      },
    });
  }

  async createJourneyVersion(data: {
    businessId: string;
    journeyId: string;
    version: number;
    steps: unknown;
    createdByUserId?: string;
  }) {
    return this.platform.db.salesNurtureJourneyVersion.create({
      data: {
        businessId: data.businessId,
        journeyId: data.journeyId,
        version: data.version,
        steps: data.steps as Record<string, unknown>[],
        createdByUserId: data.createdByUserId ?? null,
      },
    });
  }

  async publishJourneyVersion(businessId: string, journeyId: string, versionId: string) {
    await this.platform.db.salesNurtureJourneyVersion.update({
      where: { id: versionId },
      data: { publishedAt: new Date() },
    });
    return this.platform.db.salesNurtureJourney.update({
      where: { id: journeyId },
      data: { currentVersionId: versionId, status: 'ACTIVE' },
    });
  }

  // --- Enrollments ---
  async enrollContact(data: {
    businessId: string;
    journeyId: string;
    versionId: string;
    contactId: string;
    enrolledByUserId?: string;
  }) {
    return this.platform.db.salesNurtureEnrollment.create({
      data: {
        businessId: data.businessId,
        journeyId: data.journeyId,
        versionId: data.versionId,
        contactId: data.contactId,
        enrolledByUserId: data.enrolledByUserId ?? null,
      },
    });
  }

  async stopEnrollment(businessId: string, enrollmentId: string, reason: string) {
    return this.platform.db.salesNurtureEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'STOPPED', stoppedAt: new Date(), stopReason: reason },
    });
  }
}
