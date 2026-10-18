import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { AppointmentDraftList } from '@firmivra/types';
import { Access, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { errors } from './errors.js';
import { DraftBody, DraftIdParam } from './scheduling.input.js';

/**
 * Save as Draft (R58). Drafts need a table of their own, which the schema does not have yet (see
 * the PR's gaps): until it does, the list is empty (a tidy empty state), saving is refused with
 * 400 instead of pretending to keep the form, and an id is 404 (nothing is stored).
 */
@Controller('business/appointment-drafts')
@Access('APPOINTMENTS')
@Roles(...FIRM_STAFF)
export class AppointmentDraftsController {
  @Get()
  list(): AppointmentDraftList {
    return { items: [] };
  }

  @Post()
  create(@Body(new ZodValidationPipe(DraftBody)) _body: z.output<typeof DraftBody>): never {
    throw errors.unsupported('Saving drafts is not available yet.');
  }

  @Put(':id')
  save(
    @Param('id', new ZodValidationPipe(DraftIdParam)) _id: string,
    @Body(new ZodValidationPipe(DraftBody)) _body: z.output<typeof DraftBody>,
  ): never {
    throw errors.notFound();
  }

  @Delete(':id')
  remove(@Param('id', new ZodValidationPipe(DraftIdParam)) _id: string): never {
    throw errors.notFound();
  }
}
