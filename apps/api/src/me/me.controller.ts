import { Controller, Get, Inject, Module } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { MeResponse } from '@firmivra/types';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';

const business = { select: { id: true, slug: true, name: true, status: true } } as const;

/** GET /api/v1/me: the signed-in person and the firms they can open (firm picker). */
@Controller('me')
@Roles('AUTHENTICATED')
export class MeController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async me(@CurrentAuth() auth: AuthContext): Promise<MeResponse> {
    const own = this.db.forUser(auth.userId);
    const [user, memberships, clientAccounts, platformAdmin] = await Promise.all([
      own.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { id: true, email: true, name: true, pool: true },
      }),
      own.membership.findMany({
        select: { role: true, status: true, business },
        orderBy: { createdAt: 'asc' },
      }),
      own.clientAccount.findMany({ select: { status: true, business } }),
      own.platformAdmin.findUnique({ where: { userId: auth.userId }, select: { role: true } }),
    ]);
    // Parsing with the shared schema keeps the response and packages/types in step.
    return MeResponse.parse({
      user,
      memberships,
      clientAccounts,
      platformAdmin: platformAdmin !== null,
    });
  }
}

@Module({ controllers: [MeController] })
export class MeModule {}
