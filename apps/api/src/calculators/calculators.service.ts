import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type { Calculator, CalculatorKey, FirmCalculator } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  CALCULATOR_DEFAULTS,
  clientCalculators,
  firmCalculators,
  type DefinitionRow,
} from './calculator-definitions.js';
import type { UpdateBody } from './calculators.input.js';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

const rowSelect = {
  key: true,
  title: true,
  disclaimer: true,
  enabled: true,
  sortOrder: true,
} satisfies Prisma.CalculatorDefinitionSelect;

/**
 * The firm's calculators (R12 step 5, R14 K1; contract in packages/types/src/calculators). Every query
 * runs in the firm's business scope with `businessId` from TenantGuard. Everyone at the firm
 * reads; Owner and Admin change (the routes say so). Reads never write: a firm without a row
 * gets the default definition, and its row is created on the first change. Clients read enabled
 * calculators only. Estimates run in the browser and are never stored. Changes are audited with
 * the key and the field names (and the new on/off), never the title or disclaimer text.
 */
@Injectable()
export class CalculatorsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private async rows(businessId: string): Promise<DefinitionRow[]> {
    return this.database.forBusiness(businessId).calculatorDefinition.findMany({
      where: { businessId },
      select: rowSelect,
    });
  }

  async list(businessId: string): Promise<FirmCalculator[]> {
    return firmCalculators(await this.rows(businessId));
  }

  /**
   * One transaction: create the firm's row from the default if it has none (ON CONFLICT DO
   * NOTHING, so two first changes at once never collide), then change it under its row lock.
   */
  async update(businessId: string, key: CalculatorKey, body: UpdateBody): Promise<FirmCalculator> {
    const { row, created } = await this.database.withScope(
      { kind: 'business', businessId },
      async (tx) => {
        const d = CALCULATOR_DEFAULTS[key];
        // No config: the column keeps its default `{}` and is never read (the figures live in
        // packages/types, by tax year).
        const inserted = await tx.calculatorDefinition.createMany({
          data: [
            {
              businessId,
              key,
              title: d.title,
              disclaimer: d.disclaimer,
              enabled: d.enabled,
              sortOrder: d.sortOrder,
            },
          ],
          skipDuplicates: true,
        });
        const updated = await tx.calculatorDefinition.update({
          where: { businessId_key: { businessId, key } },
          data: {
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
            ...(body.title === undefined ? {} : { title: body.title }),
            ...(body.disclaimer === undefined ? {} : { disclaimer: body.disclaimer }),
          },
          select: { id: true, ...rowSelect },
        });
        return { row: updated, created: inserted.count > 0 };
      },
    );
    const fields = (['enabled', 'title', 'disclaimer'] as const).filter(
      (f) => body[f] !== undefined,
    );
    await this.audit.log(
      'calculator.updated',
      { type: 'calculator', id: row.id },
      {
        key,
        fields,
        created,
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      },
    );
    const result = firmCalculators([row]).find((c) => c.key === key);
    if (!result) throw new Error(`calculator ${key} has no definition`);
    return result;
  }

  async mine(businessId: string): Promise<Calculator[]> {
    return clientCalculators(await this.rows(businessId));
  }

  /** One enabled calculator; a key the firm turned off is 404 NOT_FOUND. */
  async mineOne(businessId: string, key: CalculatorKey): Promise<Calculator> {
    const found = (await this.mine(businessId)).find((c) => c.key === key);
    if (!found) throw notFound();
    return found;
  }
}
