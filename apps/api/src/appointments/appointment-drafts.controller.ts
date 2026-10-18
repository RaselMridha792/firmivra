import { Controller, Delete, ForbiddenException, Get, Post, Put } from '@nestjs/common';
import type { AppointmentDraftList } from '@firmivra/types';
import { Access, FIRM_STAFF, Roles } from '../auth/decorators.js';

const off = () =>
  new ForbiddenException({
    code: 'MODULE_OFF',
    message: 'Saving appointment drafts is not available yet.',
  });

/**
 * Save as Draft (R58). Drafts need a table of their own, which the schema does not have yet (see
 * the PR's gaps): until it does, the list is empty (a tidy empty state) and saving, changing and
 * deleting a draft answer 403 MODULE_OFF instead of pretending to keep the form.
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
  create(): never {
    throw off();
  }

  @Put(':id')
  save(): never {
    throw off();
  }

  @Delete(':id')
  remove(): never {
    throw off();
  }
}
