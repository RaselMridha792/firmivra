import { Controller, Get, Param } from '@nestjs/common';
import { AppointmentTypeId, type PublicBookingType } from '@firmivra/types';
import { Public } from '../auth/decorators.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AppointmentTypesService } from './appointment-types.service.js';
import { idParam } from './appointments.input.js';

/**
 * Review 2 (Appointments row 3): the page behind a type's public booking link
 * (`{PORTAL_BASE_URL}/{firmSlug}/book/{typeId}`) reads the type here before anyone signs in, so
 * an archived type, or one clients can't book online, is refused before the visitor signs up.
 * Public: the firm comes from the slug (ACTIVE firms only; any other slug is 404), and the type
 * must be that firm's (404 otherwise). Booking itself stays the signed-in client's
 * (`POST /portal/{firmSlug}/me/appointments`), which refuses the same types.
 */
@Controller('portal/:firmSlug/booking-types')
export class PublicBookingController {
  constructor(
    private readonly portal: PortalInfoService,
    private readonly types: AppointmentTypesService,
  ) {}

  @Get(':id')
  @Public()
  async type(
    @Param('firmSlug') firmSlug: string,
    @Param('id', new ZodValidationPipe(idParam(AppointmentTypeId))) id: string,
  ): Promise<PublicBookingType> {
    const firm = await this.portal.activeFirm(firmSlug);
    return this.types.publicType(firm.id, id);
  }
}
