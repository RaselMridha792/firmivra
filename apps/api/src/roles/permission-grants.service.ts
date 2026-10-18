import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import {
  DEFAULT_ROLE_PERMISSIONS,
  type MembershipRole,
  type PermissionCapability,
  type PermissionModule,
} from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';

/** How long one API task trusts a firm's saved grid before reading it again. */
const TTL_MS = 10_000;

interface Entry {
  at: number;
  /** "MODULE:CAPABILITY" to granted, for the cells the firm changed. */
  changed: Map<string, boolean>;
}

/**
 * What a role may do in a firm: the default grid (code) with the firm's own changes on top
 * (`role_permissions`). The guard asks here for the five newer roles. A change is seen at once by
 * the task that saved it and within a few seconds by the others.
 */
@Injectable()
export class PermissionGrantsService {
  private readonly cache = new Map<string, Entry>();

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  invalidate(businessId: string, role?: MembershipRole): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${businessId}:`) && (!role || key.endsWith(`:${role}`)))
        this.cache.delete(key);
    }
  }

  async changes(businessId: string, role: MembershipRole): Promise<Map<string, boolean>> {
    const key = `${businessId}:${role}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.changed;
    const rows = await this.database.withScope({ kind: 'business', businessId }, (tx) =>
      tx.rolePermission.findMany({
        where: { businessId, role },
        select: { module: true, capability: true, granted: true },
      }),
    );
    const changed = new Map(rows.map((r) => [`${r.module}:${r.capability}`, r.granted]));
    this.cache.set(key, { at: Date.now(), changed });
    return changed;
  }

  /** Forgets the members' own changes of one firm (after Staff Management saved one). */
  invalidateMember(businessId: string): void {
    for (const key of [...this.cache.keys()])
      if (key.startsWith(`${businessId}:user:`)) this.cache.delete(key);
  }

  /**
   * The member's own change to one cell (`member_permissions`, Staff Management), or undefined
   * when they have none and their role's grid decides.
   */
  async memberCell(
    businessId: string,
    userId: string,
    module: PermissionModule,
    capability: PermissionCapability,
  ): Promise<boolean | undefined> {
    const key = `${businessId}:user:${userId}`;
    let entry = this.cache.get(key);
    if (!entry || Date.now() - entry.at >= TTL_MS) {
      const rows = await this.database.withScope({ kind: 'business', businessId }, (tx) =>
        tx.memberPermission.findMany({
          where: { businessId, member: { userId } },
          select: { module: true, capability: true, granted: true },
        }),
      );
      entry = {
        at: Date.now(),
        changed: new Map(rows.map((r) => [`${r.module}:${r.capability}`, r.granted])),
      };
      this.cache.set(key, entry);
    }
    return entry.changed.get(`${module}:${capability}`);
  }

  async can(
    businessId: string,
    role: MembershipRole,
    module: PermissionModule,
    capability: PermissionCapability,
  ): Promise<boolean> {
    const changed = await this.changes(businessId, role);
    const own = changed.get(`${module}:${capability}`);
    if (own !== undefined) return own;
    return DEFAULT_ROLE_PERMISSIONS[role][module]?.includes(capability) ?? false;
  }
}
