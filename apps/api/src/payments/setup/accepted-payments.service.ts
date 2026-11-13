import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  ACCEPTED_PAYMENT_LOCKS,
  type AcceptedPayments,
  cardLock,
  PAYMENTS_SETUP_ERRORS,
  type PaymentProcessor,
  type SaveAcceptedPaymentsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import { DATABASE } from '../../database/database.module.js';
import { conflict } from '../invoices/invoice-view.js';
import { columnsOf, DEFAULTS } from '../preferences/payment-preferences.js';

type SaveBody = z.output<typeof SaveAcceptedPaymentsRequest>;

/**
 * Settings > Payments, Accepted Client Payments (PAY-3, IP-F14), on the firm's one store
 * (`payment_settings`): cards on or off, their processor, and bank payments (ACH), which stay off
 * until checkout offers them. Only a ready processor is offered; a locked control says what it
 * needs. Cards off takes Pay Now away from new payments (`paymentsEnabled`); past payments stay.
 */
@Injectable()
export class AcceptedPaymentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  get(businessId: string): Promise<AcceptedPayments> {
    return this.database.withScope({ kind: 'business', businessId }, (tx) => read(tx, businessId));
  }

  save(businessId: string, userId: string, body: SaveBody): Promise<AcceptedPayments> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      // The same lock as the billing sections' save: one write to the firm's row at a time.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`payment-settings:${businessId}`}))) AS l`;
      const before = await read(tx, businessId);
      if (body.acceptAch) throw conflict('ACH_NOT_OFFERED', PAYMENTS_SETUP_ERRORS.ACH_NOT_OFFERED);
      const cardChanged =
        body.acceptCard !== before.acceptCard ||
        body.defaultCardProcessor !== before.defaultCardProcessor;
      if (cardChanged && !before.readyProcessors.includes(body.defaultCardProcessor)) {
        throw conflict('PROCESSOR_NOT_READY', PAYMENTS_SETUP_ERRORS.PROCESSOR_NOT_READY);
      }
      const next = {
        acceptCard: body.acceptCard,
        defaultCardProcessor: body.defaultCardProcessor,
        acceptAch: false,
        achProcessor: body.achProcessor,
      };
      const was = {
        acceptCard: before.acceptCard,
        defaultCardProcessor: before.defaultCardProcessor,
        acceptAch: before.acceptAch,
        achProcessor: before.achProcessor,
      };
      if (JSON.stringify(next) === JSON.stringify(was)) return before;
      const row = await tx.paymentSettings.findUnique({
        where: { businessId },
        select: { updatedAt: true },
      });
      if (row) {
        // `updated_at` is the billing sections' version (their Save checks it): this save keeps
        // it, so a billing draft open on the same page is never refused because of this card.
        await tx.paymentSettings.update({
          where: { businessId },
          data: { ...next, updatedAt: row.updatedAt },
        });
      } else {
        // The firm's first row: the billing sections as a firm that never saved sees them (all
        // off), never the table's defaults.
        await tx.paymentSettings.create({ data: { businessId, ...columnsOf(DEFAULTS), ...next } });
      }
      await this.audit.logIn(
        tx,
        'payments.accepted_methods_updated',
        { type: 'business', id: businessId },
        { from: was, to: next },
        { businessId, actorUserId: userId },
      );
      return read(tx, businessId);
    });
  }
}

async function read(tx: TxClient, businessId: string): Promise<AcceptedPayments> {
  const account = await tx.stripeAccount.findUnique({
    where: { businessId },
    select: { chargesEnabled: true },
  });
  const row = await tx.paymentSettings.findUnique({
    where: { businessId },
    select: { acceptCard: true, defaultCardProcessor: true, achProcessor: true },
  });
  const chargesEnabled = account?.chargesEnabled ?? false;
  const readyProcessors: PaymentProcessor[] = chargesEnabled ? ['STRIPE'] : [];
  const acceptCard = row?.acceptCard ?? true;
  const defaultCardProcessor = row?.defaultCardProcessor ?? 'STRIPE';
  return {
    acceptCard,
    defaultCardProcessor,
    // Checkout takes cards only, so bank payments read off whatever the row holds.
    acceptAch: false,
    achProcessor: row?.achProcessor ?? 'STRIPE',
    readyProcessors,
    locks: {
      card: cardLock({ connected: account !== null, chargesEnabled }),
      ach: ACCEPTED_PAYMENT_LOCKS.ach,
      paypal: ACCEPTED_PAYMENT_LOCKS.paypal,
    },
    onlinePayments: acceptCard && readyProcessors.includes(defaultCardProcessor),
  };
}
