import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  FirmMember,
  ListTeamMembersResponse,
  type ListTeamMembersQuery,
  type ChangeTeamRoleRequest,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  activeManager,
  decodeCursor,
  encodeCursor,
  firmContext,
  missing,
  pageBoundary,
} from '../firm-common/context.js';
import { InviteResender } from './invite-resender.js';
const select = {
  id: true,
  user: { select: { id: true, name: true, email: true } },
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;
type MemberRow = {
  id: string;
  user: { id: string; name: string; email: string };
  role: 'OWNER' | 'ADMIN' | 'STAFF';
  status: 'INVITED' | 'ACTIVE' | 'DEACTIVATED';
  createdAt: Date;
  updatedAt: Date;
};
const dto = (row: MemberRow) =>
  FirmMember.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
export function checkTeamAuthority(
  actor: 'OWNER' | 'ADMIN',
  target: 'OWNER' | 'ADMIN' | 'STAFF',
  next?: 'OWNER' | 'ADMIN' | 'STAFF',
) {
  if (actor === 'ADMIN' && (target !== 'STAFF' || next === 'OWNER'))
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Only an owner can manage owners or administrators',
    });
}
@Injectable()
export class TeamService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly invites: InviteResender,
  ) {}
  async list(query: ListTeamMembersQuery) {
    const context = firmContext();
    const filters = { kind: 'team', status: query.status, role: query.role };
    const boundary = decodeCursor(query.cursor, context, filters);
    const rows = await this.db.forBusiness(context.businessId).membership.findMany({
      where: {
        businessId: context.businessId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.role ? { role: query.role } : {}),
        ...pageBoundary(boundary),
      },
      select,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    await this.audit.log(
      'team.listed',
      { type: 'membership' },
      { filters: Object.keys(filters).filter((key) => key !== 'kind') },
    );
    return ListTeamMembersResponse.parse({
      items: items.map(dto),
      nextCursor:
        rows.length > query.limit
          ? encodeCursor(
              { businessId: context.businessId, userId: context.userId },
              filters,
              items[items.length - 1]!,
            )
          : null,
    });
  }
  private async target(tx: TxClient, id: string) {
    const context = firmContext();
    const target = await tx.membership.findFirst({
      where: { id, businessId: context.businessId },
      select,
    });
    if (!target) throw missing();
    return target;
  }
  async role(id: string, input: ChangeTeamRoleRequest) {
    const context = firmContext();
    const result = await this.db.withScope(
      { kind: 'business', businessId: context.businessId },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM businesses WHERE id=${context.businessId}::uuid FOR UPDATE`;
        const actor = await activeManager(tx, context);
        const target = await this.target(tx, id);
        checkTeamAuthority(actor, target.role, input.role);
        if (
          target.status === 'ACTIVE' &&
          target.role === 'OWNER' &&
          input.role !== 'OWNER' &&
          (await tx.membership.count({
            where: { businessId: context.businessId, status: 'ACTIVE', role: 'OWNER' },
          })) <= 1
        )
          throw new ConflictException({
            code: 'LAST_OWNER',
            message: 'The firm must retain an active owner',
          });
        return {
          row: await tx.membership.update({ where: { id }, data: { role: input.role }, select }),
          previous: target.role,
        };
      },
    );
    await this.audit.log(
      'team.role_changed',
      { type: 'membership', id },
      { previousRole: result.previous, role: input.role },
    );
    return dto(result.row);
  }
  async deactivate(id: string) {
    const context = firmContext();
    const result = await this.db.withScope(
      { kind: 'business', businessId: context.businessId },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM businesses WHERE id=${context.businessId}::uuid FOR UPDATE`;
        const actor = await activeManager(tx, context);
        const target = await this.target(tx, id);
        checkTeamAuthority(actor, target.role);
        if (
          target.status === 'ACTIVE' &&
          target.role === 'OWNER' &&
          (await tx.membership.count({
            where: { businessId: context.businessId, status: 'ACTIVE', role: 'OWNER' },
          })) <= 1
        )
          throw new ConflictException({
            code: 'LAST_OWNER',
            message: 'The firm must retain an active owner',
          });
        return target.status === 'DEACTIVATED'
          ? target
          : tx.membership.update({ where: { id }, data: { status: 'DEACTIVATED' }, select });
      },
    );
    await this.audit.log('team.deactivated', { type: 'membership', id });
    return dto(result);
  }
  async resend(id: string) {
    const context = firmContext();
    await this.db.withScope({ kind: 'business', businessId: context.businessId }, async (tx) => {
      const actor = await activeManager(tx, context);
      const target = await this.target(tx, id);
      checkTeamAuthority(actor, target.role);
      if (target.status !== 'INVITED')
        throw new ConflictException({
          code: 'INVITE_NOT_PENDING',
          message: 'Only pending invites can be resent',
        });
    });
    await this.invites.resend({
      businessId: context.businessId,
      membershipId: id,
      actorUserId: context.userId,
    });
    await this.audit.log('team.invite_resent', { type: 'membership', id });
    return { accepted: true };
  }
}
