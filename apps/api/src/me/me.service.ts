import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { MeResponse } from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';

const business = { select: { id: true, slug: true, name: true, status: true } } as const;

/** The signed-in person and the firms they can open. Used by GET /me and by sign-in. */
@Injectable()
export class MeService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async load(userId: string): Promise<MeResponse> {
    const own = this.db.forUser(userId);
    const [user, memberships, clientAccounts, platformAdmin] = await Promise.all([
      own.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, name: true, pool: true },
      }),
      own.membership.findMany({
        select: { role: true, status: true, business },
        orderBy: { createdAt: 'asc' },
      }),
      own.clientAccount.findMany({ select: { status: true, business } }),
      own.platformAdmin.findUnique({ where: { userId }, select: { role: true } }),
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
