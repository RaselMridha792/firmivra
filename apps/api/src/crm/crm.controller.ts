import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  BookCrmDemoRequest,
  CreateCrmDemoRequest,
  CreateCrmJourneyRequest,
  type CrmConsent,
  type CrmDemo,
  type CrmDemoAppointment,
  type CrmDemoList,
  CrmDemosQuery,
  type CrmEnrollment,
  type CrmEnrollmentList,
  CrmId,
  type CrmJourneyDetail,
  type CrmJourneyList,
  CrmJourneysQuery,
  type CrmJourneyVersion,
  EnrollCrmContactRequest,
  SaveCrmConsentRequest,
  SaveCrmJourneyVersionRequest,
  StopCrmEnrollmentRequest,
  UpdateCrmDemoAppointmentRequest,
  UpdateCrmDemoRequest,
  UpdateCrmJourneyRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CrmService } from './crm.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const id = pipe(CrmId);

/**
 * Super Admin Leads & CRM, backend P0 (Q35; contract `packages/types/src/admin-crm`), under
 * /api/v1/admin/crm: consent and suppression on a Sales contact, nurture journeys (versions,
 * publish, enrollments, stop) and demos (requests, appointments). Super Admins only; platform
 * data in the admin scope, never a firm's. Fixed paths come before `:id`.
 */
@Controller('admin/crm')
@Roles('SUPER_ADMIN')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  // ---------- Consent ----------

  @Get('contacts/:contactId/consent')
  consent(@Param('contactId', id) contactId: string): Promise<CrmConsent> {
    return this.crm.consent(contactId);
  }

  @Put('contacts/:contactId/consent')
  saveConsent(
    @Param('contactId', id) contactId: string,
    @Body(pipe(SaveCrmConsentRequest)) body: Out<typeof SaveCrmConsentRequest>,
  ): Promise<CrmConsent> {
    return this.crm.saveConsent(contactId, body);
  }

  // ---------- Journeys ----------

  @Get('journeys')
  journeys(
    @Query(pipe(CrmJourneysQuery)) query: Out<typeof CrmJourneysQuery>,
  ): Promise<CrmJourneyList> {
    return this.crm.journeys(query);
  }

  @Post('journeys')
  createJourney(
    @Body(pipe(CreateCrmJourneyRequest)) body: Out<typeof CreateCrmJourneyRequest>,
  ): Promise<CrmJourneyDetail> {
    return this.crm.createJourney(body);
  }

  @Get('journeys/:id')
  journey(@Param('id', id) journeyId: string): Promise<CrmJourneyDetail> {
    return this.crm.journey(journeyId);
  }

  @Patch('journeys/:id')
  updateJourney(
    @Param('id', id) journeyId: string,
    @Body(pipe(UpdateCrmJourneyRequest)) body: Out<typeof UpdateCrmJourneyRequest>,
  ): Promise<CrmJourneyDetail> {
    return this.crm.updateJourney(journeyId, body);
  }

  @Post('journeys/:id/versions')
  createVersion(
    @Param('id', id) journeyId: string,
    @Body(pipe(SaveCrmJourneyVersionRequest)) body: Out<typeof SaveCrmJourneyVersionRequest>,
  ): Promise<CrmJourneyVersion> {
    return this.crm.createVersion(journeyId, body);
  }

  @Put('journeys/:id/versions/:versionId')
  updateVersion(
    @Param('id', id) journeyId: string,
    @Param('versionId', id) versionId: string,
    @Body(pipe(SaveCrmJourneyVersionRequest)) body: Out<typeof SaveCrmJourneyVersionRequest>,
  ): Promise<CrmJourneyVersion> {
    return this.crm.updateVersion(journeyId, versionId, body);
  }

  @Post('journeys/:id/versions/:versionId/publish')
  @HttpCode(200)
  publish(
    @Param('id', id) journeyId: string,
    @Param('versionId', id) versionId: string,
  ): Promise<CrmJourneyDetail> {
    return this.crm.publishVersion(journeyId, versionId);
  }

  @Get('journeys/:id/enrollments')
  enrollments(@Param('id', id) journeyId: string): Promise<CrmEnrollmentList> {
    return this.crm.enrollments(journeyId);
  }

  @Post('journeys/:id/enrollments')
  enroll(
    @Param('id', id) journeyId: string,
    @Body(pipe(EnrollCrmContactRequest)) body: Out<typeof EnrollCrmContactRequest>,
  ): Promise<CrmEnrollment> {
    return this.crm.enroll(journeyId, body);
  }

  @Post('enrollments/:id/stop')
  @HttpCode(200)
  stop(
    @Param('id', id) enrollmentId: string,
    @Body(pipe(StopCrmEnrollmentRequest)) body: Out<typeof StopCrmEnrollmentRequest>,
  ): Promise<CrmEnrollment> {
    return this.crm.stopEnrollment(enrollmentId, body);
  }

  // ---------- Demos ----------

  @Get('demos')
  demos(@Query(pipe(CrmDemosQuery)) query: Out<typeof CrmDemosQuery>): Promise<CrmDemoList> {
    return this.crm.demos(query);
  }

  @Post('demos')
  createDemo(
    @Body(pipe(CreateCrmDemoRequest)) body: Out<typeof CreateCrmDemoRequest>,
  ): Promise<CrmDemo> {
    return this.crm.createDemo(body);
  }

  @Patch('demos/appointments/:id')
  updateAppointment(
    @Param('id', id) appointmentId: string,
    @Body(pipe(UpdateCrmDemoAppointmentRequest)) body: Out<typeof UpdateCrmDemoAppointmentRequest>,
  ): Promise<CrmDemoAppointment> {
    return this.crm.updateAppointment(appointmentId, body);
  }

  @Get('demos/:id')
  demo(@Param('id', id) requestId: string): Promise<CrmDemo> {
    return this.crm.demo(requestId);
  }

  @Patch('demos/:id')
  updateDemo(
    @Param('id', id) requestId: string,
    @Body(pipe(UpdateCrmDemoRequest)) body: Out<typeof UpdateCrmDemoRequest>,
  ): Promise<CrmDemo> {
    return this.crm.updateDemo(requestId, body);
  }

  @Post('demos/:id/appointments')
  book(
    @Param('id', id) requestId: string,
    @Body(pipe(BookCrmDemoRequest)) body: Out<typeof BookCrmDemoRequest>,
  ): Promise<CrmDemo> {
    return this.crm.book(requestId, body);
  }
}
