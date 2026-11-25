import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators.js';
import { CrmService } from './crm.service.js';

@Controller('admin/crm')
@Roles('SUPER_ADMIN')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  // --- Consent ---
  @Get('consent/:contactId')
  getConsent(@Param('contactId') contactId: string) {
    return this.crm.getConsent(contactId);
  }

  @Post('consent/:contactId')
  upsertConsent(
    @Param('contactId') contactId: string,
    @Body()
    body: {
      businessId: string;
      consented: boolean;
      consentSource?: string;
      suppressed?: boolean;
      suppressionReason?: string;
    },
  ) {
    return this.crm.upsertConsent(contactId, body.businessId, body);
  }

  // --- Demo requests ---
  @Get('demos')
  listDemos(@Query('businessId') businessId: string, @Query('status') status?: string) {
    return this.crm.listDemoRequests(businessId, status);
  }

  @Post('demos')
  createDemo(
    @Body()
    body: {
      businessId: string;
      contactId: string;
      opportunityId?: string;
      topic?: string;
      preferredTime?: string;
      notes?: string;
      createdByUserId?: string;
    },
  ) {
    return this.crm.createDemoRequest(body);
  }

  @Patch('demos/:id')
  updateDemo(@Param('id') id: string, @Body() body: { status?: string; notes?: string }) {
    return this.crm.updateDemoRequest(id, body);
  }

  // --- Demo appointments ---
  @Get('demos/:requestId/appointments')
  listAppointments(@Query('businessId') businessId: string, @Param('requestId') requestId: string) {
    return this.crm.listDemoAppointments(businessId, requestId);
  }

  @Post('demos/:requestId/appointments')
  createAppointment(
    @Param('requestId') requestId: string,
    @Body()
    body: {
      businessId: string;
      scheduledAt: string;
      durationMinutes?: number;
      videoLink?: string;
      notes?: string;
      createdByUserId?: string;
    },
  ) {
    return this.crm.createDemoAppointment({
      ...body,
      requestId,
      scheduledAt: new Date(body.scheduledAt),
    });
  }

  // --- Nurture journeys ---
  @Get('journeys')
  listJourneys(@Query('businessId') businessId: string, @Query('status') status?: string) {
    return this.crm.listJourneys(businessId, status);
  }

  @Post('journeys')
  createJourney(
    @Body()
    body: {
      businessId: string;
      name: string;
      description?: string;
      createdByUserId?: string;
    },
  ) {
    return this.crm.createJourney(body);
  }

  @Post('journeys/:journeyId/versions')
  createVersion(
    @Param('journeyId') journeyId: string,
    @Body() body: { businessId: string; version: number; steps: unknown; createdByUserId?: string },
  ) {
    return this.crm.createJourneyVersion({ ...body, journeyId });
  }

  @Post('journeys/:journeyId/publish')
  publishVersion(
    @Param('journeyId') journeyId: string,
    @Body() body: { businessId: string; versionId: string },
  ) {
    return this.crm.publishJourneyVersion(body.businessId, journeyId, body.versionId);
  }

  // --- Enrollments ---
  @Post('journeys/:journeyId/enroll')
  enroll(
    @Param('journeyId') journeyId: string,
    @Body()
    body: { businessId: string; versionId: string; contactId: string; enrolledByUserId?: string },
  ) {
    return this.crm.enrollContact({ ...body, journeyId });
  }

  @Patch('enrollments/:id/stop')
  stopEnrollment(@Param('id') id: string, @Body() body: { businessId: string; reason: string }) {
    return this.crm.stopEnrollment(body.businessId, id, body.reason);
  }
}
