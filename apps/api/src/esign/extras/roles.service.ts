import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { EsignMemberRole, EsignMemberRoleList, SetEsignMemberRoleBody } from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import {
  type DirectoryStaff,
  ESIGN_DIRECTORY,
  type EsignDirectory,
} from '../requests/esign-directory.js';
import { type EsignActor, esignRefusal } from '../requests/requests.service.js';
import {
  type EsignExtrasRepository,
  type EsignStaffRole,
  EXTRAS_REPOSITORY,
} from './extras.repository.js';

const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });

/**
 * Firm Sign roles (R13, contract 3): Owner and Admin list every active member's access and make a
 * Staff member a MANAGER or a VIEWER (or STAFF again). An Owner's or Admin's access follows their
 * firm role (409 ROLE_FIXED); anyone not an active member of the firm (another firm's member
 * included) is 404, as any record of another firm. The audit gets ids and roles.
 */
@Injectable()
export class EsignRolesService {
  constructor(
    @Inject(EXTRAS_REPOSITORY) private readonly extras: EsignExtrasRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  async list(businessId: string, actor: EsignActor): Promise<EsignMemberRoleList> {
    ownerOrAdmin(actor);
    const [members, roles] = await Promise.all([
      this.directory.members(businessId),
      this.extras.staffRoles(businessId),
    ]);
    return { items: members.map((m) => toRole(m, roles.get(m.userId) ?? null)) };
  }

  async set(
    businessId: string,
    actor: EsignActor,
    userId: string,
    body: SetEsignMemberRoleBody,
  ): Promise<EsignMemberRole> {
    ownerOrAdmin(actor);
    const member = (await this.directory.members(businessId)).find((m) => m.userId === userId);
    if (!member) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    if (member.firmRole !== 'STAFF') throw esignRefusal('ROLE_FIXED');
    const before = (await this.extras.staffRoles(businessId)).get(userId) ?? 'STAFF';
    const wanted = body.esignRole === 'STAFF' ? null : body.esignRole;
    const stored = await this.extras.setStaffRole(businessId, userId, wanted);
    const after = stored ?? 'STAFF';
    if (after !== before) {
      await this.audit.log(
        'esign.role_changed',
        { type: 'user', id: userId },
        { from: before, to: after },
      );
    }
    return toRole(member, stored);
  }
}

function ownerOrAdmin(actor: EsignActor) {
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') throw forbidden();
}

function toRole(m: DirectoryStaff, staffRole: EsignStaffRole | null): EsignMemberRole {
  return {
    user: { userId: m.userId, name: m.name },
    email: m.email,
    esignRole: m.firmRole === 'STAFF' ? (staffRole ?? 'STAFF') : m.firmRole,
    canChange: m.firmRole === 'STAFF',
  };
}
