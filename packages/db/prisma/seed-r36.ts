// R36 seed rows (money and portal modules), called from seed.ts. Synthetic sample setup only:
// the firm's own tax rates, templates and settings, never real client data. Safe to run again.
import { runInScope, type createPrismaClient } from '../src/client.js';

type Prisma = ReturnType<typeof createPrismaClient>;

export async function seedR36(prisma: Prisma, businesses: { lvp: string; testFirmB: string }) {
  // Invoices and Payments: a sample tax rate and the standard invoice template.
  for (const businessId of [businesses.lvp, businesses.testFirmB]) {
    await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
      await tx.invoiceTaxRate.upsert({
        where: { businessId_name: { businessId, name: 'Sample sales tax' } },
        update: {},
        create: { businessId, name: 'Sample sales tax', rateBps: 800, isDefault: true },
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
}
