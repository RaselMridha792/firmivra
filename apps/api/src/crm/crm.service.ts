import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import { PlatformPrisma } from '../database/database.module.js';

function asCrmError(_error: unknown): never {
  throw new NotFoundException();
}

/**
 * Super Admin CRM service (Q35). Reuses existing SalesContact/SalesOpportunity
 * records; adds consent, nurture journeys, enrollments, executions, and demos.
 */
@Injectable()
export class CrmService {
  constructor(private readonly platform: PlatformPrisma) {}

  // --- Consent ---
  async getConsent(contactId: string) {
    return this.platform.db.salesLeadConsent.findUnique({ where: { contactId } });
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
    try {
      return await this.platform.db.salesLeadConsent.upsert({
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
    } catch (e) {
      asCrmError(e);
    }
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
    try {
      return await this.platform.db.salesDemoRequest.create({
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
    } catch (e) {
      asCrmError(e);
    }
  }

  async updateDemoRequest(id: string, data: { status?: string; notes?: string }) {
    try {
      return await this.platform.db.salesDemoRequest.update({
        where: { id },
        data: {
          ...(data.status ? { status: data.status } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
        },
      });
    } catch (e) {
      asCrmError(e);
    }
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
    try {
      return await this.platform.db.salesDemoAppointment.create({
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
    } catch (e) {
      asCrmError(e);
    }
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
    try {
      return await this.platform.db.salesNurtureJourneyVersion.create({
        data: {
          businessId: data.businessId,
          journeyId: data.journeyId,
          version: data.version,
          steps: data.steps as Prisma.InputJsonValue,
          createdByUserId: data.createdByUserId ?? null,
        },
      });
    } catch (e) {
      asCrmError(e);
    }
  }

  async publishJourneyVersion(businessId: string, journeyId: string, versionId: string) {
    try {
      await this.platform.db.salesNurtureJourneyVersion.update({
        where: { id: versionId },
        data: { publishedAt: new Date() },
      });
      return await this.platform.db.salesNurtureJourney.update({
        where: { id: journeyId },
        data: { currentVersionId: versionId, status: 'ACTIVE' },
      });
    } catch (e) {
      asCrmError(e);
    }
  }

  // --- Enrollments ---
  async enrollContact(data: {
    businessId: string;
    journeyId: string;
    versionId: string;
    contactId: string;
    enrolledByUserId?: string;
  }) {
    try {
      return await this.platform.db.salesNurtureEnrollment.create({
        data: {
          businessId: data.businessId,
          journeyId: data.journeyId,
          versionId: data.versionId,
          contactId: data.contactId,
          enrolledByUserId: data.enrolledByUserId ?? null,
        },
      });
    } catch (e) {
      asCrmError(e);
    }
  }

  async stopEnrollment(businessId: string, enrollmentId: string, reason: string) {
    try {
      return await this.platform.db.salesNurtureEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'STOPPED', stoppedAt: new Date(), stopReason: reason },
      });
    } catch (e) {
      asCrmError(e);
    }
  }
}
