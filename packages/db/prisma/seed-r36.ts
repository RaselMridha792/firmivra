// R36 seed rows (money and portal modules), called from seed.ts. Synthetic sample setup only:
// the firm's own tax rates, templates and settings, never real client data. Safe to run again.
import { runInScope, type createPrismaClient } from '../src/client.js';
import {
  SEED_BILLING_IDS,
  SEED_CLIENT_IDS,
  SEED_DOCUMENT_IDS,
  SEED_MESSAGE_IDS,
  SEED_STRIPE_ACCOUNT_ID,
  SEED_USERS,
  SEED_WORK_IDS,
} from './seed-data.js';

type Prisma = ReturnType<typeof createPrismaClient>;

export async function seedR36(prisma: Prisma, businesses: { lvp: string; testFirmB: string }) {
  // Invoices and Payments: a sample tax rate, the standard invoice template, a deposit account, the default payment settings and for LVP, a recurring schedule and a saved card.
  for (const businessId of [businesses.lvp, businesses.testFirmB]) {
    await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
      await tx.invoiceTaxRate.upsert({
        where: { businessId_name: { businessId, name: 'Sample sales tax' } },
        update: {},
        create: { businessId, name: 'Sample sales tax', rateBps: 800, isDefault: true },
      });
      await tx.depositAccount.upsert({
        where: { businessId_name: { businessId, name: 'Operating Bank Account' } },
        update: {},
        create: { businessId, name: 'Operating Bank Account', isDefault: true },
      });
      await tx.paymentSettings.upsert({
        where: { businessId },
        update: {},
        create: { businessId },
      });
      await tx.invoiceTemplate.upsert({
        where: { businessId_name: { businessId, name: 'Standard Invoice' } },
        update: {},
        create: {
          businessId,
          name: 'Standard Invoice',
          description: 'Lines, totals and a thank-you memo.',
          memo: 'Thank you for your business. Please reach out if you have any questions.',
          isDefault: true,
        },
      });
    });
  }

  // The open invoice (INV-1001's sample): viewed by the client, a sent event, a note and a sent file.
  await runInScope(prisma, { kind: 'business', businessId: businesses.lvp }, async (tx) => {
    const lvp = { businessId: businesses.lvp };
    const invoiceId = SEED_BILLING_IDS.openInvoice;
    const viewedAt = new Date('2026-10-06T14:00:00Z');
    await tx.invoiceTracking.upsert({
      where: { invoiceId },
      update: {},
      create: { ...lvp, invoiceId, firstViewedAt: viewedAt, lastViewedAt: viewedAt, viewCount: 1 },
    });
    if ((await tx.invoiceEvent.count({ where: { invoiceId } })) === 0) {
      const staff = { actorKind: 'STAFF' as const, actorUserId: SEED_USERS.lvpOwner.id };
      await tx.invoiceEvent.createMany({
        data: [
          { ...lvp, invoiceId, type: 'SENT', ...staff },
          { ...lvp, invoiceId, type: 'VIEWED', actorKind: 'CLIENT' },
          { ...lvp, invoiceId, type: 'NOTE', body: 'Client asked about the due date.', ...staff },
        ],
      });
    }
    const documentId = SEED_DOCUMENT_IDS.return2024;
    const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
    if (doc.scanStatus === 'PENDING') {
      await tx.document.update({
        where: { id: documentId },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
    }
    await tx.invoiceAttachment.upsert({
      where: {
        businessId_invoiceId_documentId: { businessId: businesses.lvp, invoiceId, documentId },
      },
      update: {},
      create: { ...lvp, invoiceId, documentId, addedByUserId: SEED_USERS.lvpOwner.id },
    });
    // A monthly bookkeeping schedule.
    const clientId = SEED_CLIENT_IDS.lvp;
    if ((await tx.recurringInvoice.count({ where: { name: 'Monthly Bookkeeping' } })) === 0) {
      const schedule = await tx.recurringInvoice.create({
        data: {
          ...lvp,
          clientId,
          engagementId: SEED_WORK_IDS.lvpBookkeeping,
          name: 'Monthly Bookkeeping',
          frequency: 'MONTHLY',
          startOn: new Date('2026-11-01'),
          nextSendOn: new Date('2026-11-01'),
          paymentTerms: 'net_14',
          createdByUserId: SEED_USERS.lvpOwner.id,
        },
      });
      await tx.recurringInvoiceLine.create({
        data: {
          ...lvp,
          recurringInvoiceId: schedule.id,
          description: 'Bookkeeping (Growth), monthly',
          unitAmountCents: 30000,
        },
      });
    }
    // The card the client saved for AutoPay (fake Stripe ids).
    await tx.clientPaymentMethod.upsert({
      where: { processor_methodRef: { processor: 'STRIPE', methodRef: 'pm_SeedFakeVisa4242' } },
      update: {},
      create: {
        ...lvp,
        clientId,
        customerRef: 'cus_SeedFakeCustomer',
        methodRef: 'pm_SeedFakeVisa4242',
        accountId: SEED_STRIPE_ACCOUNT_ID,
        methodType: 'card',
        cardBrand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
        isDefault: true,
        authorizedAt: new Date('2026-10-01T12:00:00Z'),
      },
    });

    // The catalog: categories, and sample prices (the designs' sample figures, not real prices) on
    // LVP's seeded services, each with what it includes, a line item and an add-on, then a package and a promotion.
    const categories = new Map<string, string>();
    for (const [sortOrder, name] of ['Tax Preparation', 'Bookkeeping', 'Advisory'].entries()) {
      const row = await tx.serviceCategory.upsert({
        where: { businessId_name: { businessId: businesses.lvp, name } },
        update: {},
        create: { ...lvp, name, sortOrder },
      });
      categories.set(name, row.id);
    }
    const catalog = [
      ['Annual Tax', 'Tax Preparation', 'FIXED', 29000, null],
      ['Quarterly Tax', 'Tax Preparation', 'RECURRING', 15000, 'QUARTERLY'],
      ['Bookkeeping', 'Bookkeeping', 'RECURRING', 19900, 'MONTHLY'],
    ] as const;
    for (const [name, category, pricingType, basePriceCents, billingFrequency] of catalog) {
      const service = await tx.service.findUnique({
        where: { businessId_name: { businessId: businesses.lvp, name } },
      });
      if (!service || service.categoryId) continue;
      await tx.service.update({
        where: { id: service.id },
        data: {
          categoryId: categories.get(category),
          pricingType,
          basePriceCents,
          billingFrequency,
          taxable: true,
          clientVisible: true,
          fullDescription: `Sample description of ${name}.`,
        },
      });
      await tx.serviceInclusion.createMany({
        data: [
          { ...lvp, serviceId: service.id, kind: 'INCLUDED', text: 'Review of your documents' },
          {
            ...lvp,
            serviceId: service.id,
            kind: 'NOT_INCLUDED',
            text: 'Audit representation',
            sortOrder: 1,
          },
        ],
      });
      await tx.serviceLineItem.create({
        data: { ...lvp, serviceId: service.id, name: 'Base fee', rateCents: basePriceCents },
      });
      await tx.serviceAddOn.create({
        data: {
          ...lvp,
          serviceId: service.id,
          name: 'Audit representation',
          priceCents: 25000,
          clientSelectable: true,
        },
      });
    }

    // A package of the two tax services, with the audit add-on.
    if ((await tx.servicePackage.count({ where: { name: 'Small Business Tax Bundle' } })) === 0) {
      const taxCategory = categories.get('Tax Preparation');
      const pkg = await tx.servicePackage.create({
        data: {
          ...lvp,
          name: 'Small Business Tax Bundle',
          categoryId: taxCategory,
          shortDescription: 'Annual and quarterly tax services for a growing business.',
          status: 'ACTIVE',
          packagePriceCents: 39900,
          discountType: 'PERCENT',
          discountPercent: 10,
          visibleToClients: true,
          allowClientAddOns: true,
          displayOnPortal: true,
        },
      });
      const taxServices = await tx.service.findMany({
        where: { businessId: businesses.lvp, categoryId: taxCategory, status: 'ACTIVE' },
        orderBy: { name: 'asc' },
      });
      for (const [sortOrder, service] of taxServices.entries()) {
        await tx.servicePackageItem.create({
          data: { ...lvp, packageId: pkg.id, serviceId: service.id, sortOrder },
        });
      }
      await tx.servicePackageAddOn.create({
        data: { ...lvp, packageId: pkg.id, name: 'Audit representation', priceCents: 25000 },
      });
    }

    // A promotion for the tax category, used once on the open invoice.
    if ((await tx.promotion.count({ where: { name: 'Sample new-client discount' } })) === 0) {
      const promotion = await tx.promotion.create({
        data: {
          ...lvp,
          name: 'Sample new-client discount',
          discountType: 'PERCENT',
          discountPercent: 10,
          appliesTo: 'CATEGORIES',
          eligibility: 'NEW_CLIENTS',
          promoCode: 'WELCOME10',
          status: 'ACTIVE',
        },
      });
      await tx.promotionTarget.create({
        data: { ...lvp, promotionId: promotion.id, categoryId: categories.get('Tax Preparation') },
      });
      await tx.promotionRedemption.create({
        data: {
          ...lvp,
          promotionId: promotion.id,
          invoiceId: SEED_BILLING_IDS.openInvoice,
          clientId,
          discountCents: 1000,
        },
      });
    }

    // Messages: an owner and a tag on the welcome thread, a mute on the W-2 thread, and a template.
    await tx.messageThread.update({
      where: { id: SEED_MESSAGE_IDS.welcomeThread },
      data: { assignedUserId: SEED_USERS.lvpStaff.id },
    });
    if (
      (await tx.messageThreadTag.count({ where: { threadId: SEED_MESSAGE_IDS.welcomeThread } })) ===
      0
    ) {
      await tx.messageThreadTag.create({
        data: { ...lvp, threadId: SEED_MESSAGE_IDS.welcomeThread, tag: 'New client' },
      });
    }
    await tx.messageThreadMute.upsert({
      where: {
        threadId_userId: { threadId: SEED_MESSAGE_IDS.w2Thread, userId: SEED_USERS.lvpOwner.id },
      },
      update: {},
      create: { ...lvp, threadId: SEED_MESSAGE_IDS.w2Thread, userId: SEED_USERS.lvpOwner.id },
    });
    await tx.messageTemplate.upsert({
      where: { businessId_name: { businessId: businesses.lvp, name: 'Appointment reminder' } },
      update: {},
      create: {
        ...lvp,
        name: 'Appointment reminder',
        category: 'Appointments',
        channels: ['PORTAL', 'EMAIL'],
        subject: 'Your upcoming appointment',
        body: 'Hi {{first_name}}, a reminder about your appointment on {{appointment_date}}.',
      },
    });

    // Messages settings, the owner's signature and the client's email consent.
    await tx.messageSettings.upsert({
      where: { businessId: businesses.lvp },
      update: {},
      create: {
        businessId: businesses.lvp,
        senderName: 'LVP Accounting & Taxes',
        signature: 'Best regards,\nLVP Accounting & Taxes',
      },
    });
    await tx.messageSignature.upsert({
      where: { businessId_userId: { businessId: businesses.lvp, userId: SEED_USERS.lvpOwner.id } },
      update: {},
      create: { ...lvp, userId: SEED_USERS.lvpOwner.id, body: 'Best regards,\nThe LVP owner' },
    });
    if ((await tx.contactConsent.count({ where: { clientId } })) === 0) {
      await tx.contactConsent.create({
        data: { ...lvp, clientId, channel: 'EMAIL', status: 'OPTED_IN', source: 'portal_sign_up' },
      });
    }
  });
}
