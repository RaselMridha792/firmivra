import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { InstallStartersResult, StarterTemplatesStatus } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { STARTERS } from './template-starters.js';
import { TemplatesService } from './templates.service.js';

/**
 * The 48 starter templates (template-starters.ts). Installing adds the ones a firm does not have
 * (matched by starterKey, so repeating it adds nothing), Active and shared with the team, each in
 * a category of its kind that is made when missing. An archived starter counts as installed: the
 * firm chose to put it away. Owner and Admin install them (the route says so).
 */
@Injectable()
export class TemplateStartersService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly templates: TemplatesService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  status(businessId: string): Promise<StarterTemplatesStatus> {
    return this.inFirm(businessId, async (tx) => ({
      available: STARTERS.length,
      installed: await tx.messageTemplate.count({
        where: { businessId, starterKey: { not: null } },
      }),
    }));
  }

  async install(businessId: string, actor: ClientsActor): Promise<InstallStartersResult> {
    const installed = await this.inFirm(businessId, async (tx) => {
      // One install at a time per firm, so two clicks cannot race on the same keys.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`starters:${businessId}`}, 0))`;
      const have = new Set(
        (
          await tx.messageTemplate.findMany({
            where: { businessId, starterKey: { not: null } },
            select: { starterKey: true },
          })
        ).map((t) => t.starterKey),
      );
      let n = 0;
      for (const s of STARTERS) {
        if (have.has(s.key)) continue;
        const categoryId = await this.category(tx, businessId, s.kind, s.category);
        const name = await this.freeName(tx, businessId, s.kind, s.name);
        await this.templates.insert(tx, businessId, actor, {
          kind: s.kind,
          name,
          categoryId,
          subject: s.subject ?? null,
          body: s.body,
          status: 'ACTIVE',
          access: 'TEAM',
          starterKey: s.key,
        });
        n += 1;
      }
      return n;
    });
    if (installed > 0) {
      await this.audit.log(
        'message_template.starters_installed',
        {
          type: 'business',
          id: businessId,
        },
        { installed },
      );
    }
    return { installed, alreadyThere: STARTERS.length - installed };
  }

  /** The category of that name in the kind (archived ones are restored into use), made when missing. */
  private async category(tx: TxClient, businessId: string, kind: string, name: string) {
    const kindValue = kind as (typeof STARTERS)[number]['kind'];
    const found = await tx.templateCategory.findFirst({
      where: { businessId, kind: kindValue, name: { equals: name, mode: 'insensitive' } },
    });
    if (found) {
      if (found.archivedAt) {
        await tx.templateCategory.update({ where: { id: found.id }, data: { archivedAt: null } });
      }
      return found.id;
    }
    const last = await tx.templateCategory.aggregate({
      where: { businessId, kind: kindValue },
      _max: { sortOrder: true },
    });
    const made = await tx.templateCategory.create({
      data: { businessId, kind: kindValue, name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    return made.id;
  }

  /** The starter's name, or "Name (Starter)" when the firm already has a template by that name. */
  private async freeName(tx: TxClient, businessId: string, kind: string, name: string) {
    const kindValue = kind as (typeof STARTERS)[number]['kind'];
    for (const candidate of [name, `${name} (Starter)`]) {
      const clash = await tx.messageTemplate.findFirst({
        where: {
          businessId,
          kind: kindValue,
          status: { not: 'ARCHIVED' },
          name: { equals: candidate, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    return `${name} (Starter ${Date.now().toString(36)})`;
  }
}
