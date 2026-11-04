// Settings > Payments' tax rates and invoice templates (IP-F13) and deposit accounts (IP-F12):
// another firm's is 404.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  invoiceTaxRate: {
    async create({ tx, businessId }) {
      const row = await tx.invoiceTaxRate.create({
        data: { businessId, name: `Fake tax ${randomUUID().slice(0, 8)}`, rateBps: 500 },
      });
      return row.id;
    },
  },
  depositAccount: {
    async create({ tx, businessId }) {
      const row = await tx.depositAccount.create({
        data: { businessId, name: `Fake account ${randomUUID().slice(0, 8)}` },
      });
      return row.id;
    },
  },
  invoiceTemplate: {
    async create({ tx, businessId }) {
      const row = await tx.invoiceTemplate.create({
        data: { businessId, name: `Fake template ${randomUUID().slice(0, 8)}` },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'PUT /api/v1/business/settings/payment-preferences/tax-rates/:id': {
    params: { id: 'invoiceTaxRate' },
    body: { name: `Fake renamed tax ${randomUUID().slice(0, 8)}`, rateBps: 700 },
  },
  'POST /api/v1/business/settings/payment-preferences/tax-rates/:id/archive': {
    params: { id: 'invoiceTaxRate' },
  },
  'PUT /api/v1/business/settings/payment-preferences/deposit-accounts/:id': {
    params: { id: 'depositAccount' },
    body: { name: `Fake renamed account ${randomUUID().slice(0, 8)}` },
  },
  'POST /api/v1/business/settings/payment-preferences/deposit-accounts/:id/archive': {
    params: { id: 'depositAccount' },
  },
  'PUT /api/v1/business/settings/payment-preferences/templates/:id': {
    params: { id: 'invoiceTemplate' },
    body: { name: `Fake renamed template ${randomUUID().slice(0, 8)}` },
  },
  'POST /api/v1/business/settings/payment-preferences/templates/:id/archive': {
    params: { id: 'invoiceTemplate' },
  },
};
