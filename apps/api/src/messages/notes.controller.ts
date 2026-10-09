import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  ClientId,
  CreateInternalNoteRequest,
  type InternalNote,
  InternalNoteId,
  ListInternalNotesQuery,
  type MyNoteResponse,
  type OkResponse,
  SaveMyNoteRequest,
  SetNoteReminderRequest,
  UpdateInternalNoteRequest,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { accountOf, actorOf } from './messages.controller.js';
import { NotesService } from './notes.service.js';

const clientPipe = new ZodValidationPipe(ClientId);
const idPipe = new ZodValidationPipe(InternalNoteId);

/** A client's internal notes (R20 step 4): firm only, never in the portal. */
@Controller('business/clients/:id/notes')
@Roles(...FIRM_STAFF)
export class ClientNotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) clientId: string,
    @Query(new ZodValidationPipe(ListInternalNotesQuery))
    q: z.output<typeof ListInternalNotesQuery>,
  ): Promise<{ items: InternalNote[] }> {
    return {
      items: await this.notes.list(
        tenant.businessId,
        actorOf(auth, tenant),
        clientId,
        q.engagementId,
      ),
    };
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) clientId: string,
    @Body(new ZodValidationPipe(CreateInternalNoteRequest))
    body: z.output<typeof CreateInternalNoteRequest>,
  ): Promise<InternalNote> {
    return this.notes.create(tenant.businessId, actorOf(auth, tenant), clientId, body);
  }
}

/** One internal note: the author, the Owner and Admins change it. */
@Controller('business/notes')
@Roles(...FIRM_STAFF)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateInternalNoteRequest))
    body: z.output<typeof UpdateInternalNoteRequest>,
  ): Promise<InternalNote> {
    return this.notes.update(tenant.businessId, actorOf(auth, tenant), id, body.body);
  }

  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<OkResponse> {
    return this.notes.remove(tenant.businessId, actorOf(auth, tenant), id);
  }
}

/** The signed-in login's private note (R20 step 5). Only that login ever sees it. */
@Controller('portal/:firmSlug/me/notes')
@Roles('CLIENT')
export class MyNotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<MyNoteResponse> {
    return this.notes.myNote(tenant.businessId, accountOf(tenant));
  }

  @Put()
  save(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveMyNoteRequest)) body: z.output<typeof SaveMyNoteRequest>,
  ): Promise<MyNoteResponse> {
    return this.notes.save(tenant.businessId, accountOf(tenant), body);
  }

  @Put('reminder')
  setReminder(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SetNoteReminderRequest))
    body: z.output<typeof SetNoteReminderRequest>,
  ): Promise<MyNoteResponse> {
    return this.notes.setReminder(tenant.businessId, accountOf(tenant), body.remindAt);
  }

  @Delete('reminder')
  @HttpCode(200)
  removeReminder(@CurrentTenant() tenant: TenantContext): Promise<MyNoteResponse> {
    return this.notes.removeReminder(tenant.businessId, accountOf(tenant));
  }
}
