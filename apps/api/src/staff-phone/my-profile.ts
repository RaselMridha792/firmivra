import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Patch,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { type StaffMyProfile, UpdateStaffMyProfileRequest } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';

/** The signed-in member in the firm the request acts in: never from the URL or the body. */
interface Me {
  businessId: string;
  userId: string;
  role: string;
}
function meOf(auth: AuthContext | undefined, tenant: TenantContext | undefined): Me {
  if (!auth || !tenant || tenant.kind === 'client') {
    throw new Error('my profile routes need a signed-in member in a firm');
  }
  return { businessId: tenant.businessId, userId: auth.userId, role: tenant.role };
}

/** "Jane Q. Doe" as first "Jane" and last "Q. Doe", the way Edit Staff splits a name. */
function split(name: string): { firstName: string; lastName: string } {
  const [first = '', ...rest] = name.trim().split(/\s+/);
  return { firstName: first, lastName: rest.join(' ') };
}

/**
 * My Profile (Dashboard Review 2, R2 NEW2): the member's own name, email and job title at this
 * firm; the firm's Owner edits their own name and job title, every other role reads them (an Admin
 * is not an Owner). The name is the person's own (users.name, written in their own scope); the job
 * title is this firm's (memberships.job_title). The email and the role never change here.
 */
@Injectable()
export class MyProfileService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(me: Me): Promise<StaffMyProfile> {
    const [login, member] = await Promise.all([
      this.db.forUser(me.userId).user.findFirst({
        where: { id: me.userId },
        select: { name: true, email: true },
      }),
      this.db.forBusiness(me.businessId).membership.findFirst({
        where: { businessId: me.businessId, userId: me.userId },
        select: { jobTitle: true },
      }),
    ]);
    if (!login) throw new Error('my profile: the signed-in login has no users row');
    return {
      ...split(login.name),
      email: login.email,
      jobTitle: member?.jobTitle ?? null,
      canEdit: me.role === 'OWNER',
    };
  }

  async update(
    me: Me,
    body: z.output<typeof UpdateStaffMyProfileRequest>,
  ): Promise<StaffMyProfile> {
    if (me.role !== 'OWNER') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Your firm's Owner changes these details.",
      });
    }
    const before = await this.get(me);
    const name = `${body.firstName.trim()} ${body.lastName.trim()}`.trim();
    const jobTitle = body.jobTitle === undefined ? before.jobTitle : body.jobTitle;
    const fields = [
      ...(body.firstName.trim() !== before.firstName ? ['firstName'] : []),
      ...(body.lastName.trim() !== before.lastName ? ['lastName'] : []),
      ...(jobTitle !== before.jobTitle ? ['jobTitle'] : []),
    ];
    if (fields.length === 0) return before;
    if (fields.includes('firstName') || fields.includes('lastName')) {
      await this.db
        .forUser(me.userId)
        .user.updateMany({ where: { id: me.userId }, data: { name } });
    }
    if (fields.includes('jobTitle')) {
      await this.db.forBusiness(me.businessId).membership.updateMany({
        where: { businessId: me.businessId, userId: me.userId },
        data: { jobTitle },
      });
    }
    // Field names only, never a value (hard rule 4).
    await this.audit.log('profile.updated', { type: 'user', id: me.userId }, { fields });
    return this.get(me);
  }
}

@Controller('business/me/profile')
@Access('DASHBOARD', 'VIEW')
@Roles(...FIRM_STAFF)
export class MyProfileController {
  constructor(private readonly profiles: MyProfileService) {}

  @Get()
  get(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
  ): Promise<StaffMyProfile> {
    return this.profiles.get(meOf(auth, tenant));
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
    @Body(new ZodValidationPipe(UpdateStaffMyProfileRequest))
    body: z.output<typeof UpdateStaffMyProfileRequest>,
  ): Promise<StaffMyProfile> {
    return this.profiles.update(meOf(auth, tenant), body);
  }
}
