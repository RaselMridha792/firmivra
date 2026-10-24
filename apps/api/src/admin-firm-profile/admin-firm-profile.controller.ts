import { Body, Controller, Get, HttpCode, Module, Param, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  AdminFirmId,
  ApplyProfileChangeRequest,
  type AppliedProfileChange,
  type FirmProfileChanges,
  ProfileChangeTicketId,
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FieldEncryptionModule } from '../field-encryption/field-encryption.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { EIN_HASH_KEY, loadEinHashKey } from '../firm-applications/ein-hash.js';
import { AdminFirmProfileService } from './admin-firm-profile.service.js';

const FirmId = new ZodValidationPipe(AdminFirmId);
const TicketId = new ZodValidationPipe(ProfileChangeTicketId);

/**
 * A firm's Company Profile Request Changes on the Super Admin's firm page, and applying one
 * (R56; contract in packages/types/src/admin-firm-profile).
 */
@Controller('admin/firms/:id/profile-changes')
@Roles('SUPER_ADMIN')
export class AdminFirmProfileController {
  constructor(private readonly profile: AdminFirmProfileService) {}

  @Get()
  list(@Param('id', FirmId) id: string): Promise<FirmProfileChanges> {
    return this.profile.list(id);
  }

  @Post(':ticketId/apply')
  @HttpCode(200)
  apply(
    @Param('id', FirmId) id: string,
    @Param('ticketId', TicketId) ticketId: string,
    @Body(new ZodValidationPipe(ApplyProfileChangeRequest))
    body: z.output<typeof ApplyProfileChangeRequest>,
  ): Promise<AppliedProfileChange> {
    return this.profile.apply(id, ticketId, body);
  }
}

@Module({
  imports: [FieldEncryptionModule],
  controllers: [AdminFirmProfileController],
  providers: [
    AdminPrisma,
    AdminFirmProfileService,
    { provide: EIN_HASH_KEY, useFactory: () => loadEinHashKey() },
  ],
})
export class AdminFirmProfileModule {}
