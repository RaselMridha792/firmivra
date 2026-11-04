import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { type Database, Prisma, type TxClient } from '@firmivra/db';
import {
  type DepositAccount,
  type InvoiceTaxRate,
  type InvoiceTemplateView,
  offeredPaymentTerms,
  type PaymentPreferences,
  PaymentTerm,
  ResetPaymentPreferencesRequest,
  SaveDepositAccountRequest,
  SaveInvoiceTaxRateRequest,
  SaveInvoiceTemplateRequest,
  UpdatePaymentPreferencesRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../../auth/decorators.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { DATABASE } from '../../database/database.module.js';

type Update = z.output<typeof UpdatePaymentPreferencesRequest>;
type Sections = Omit<PaymentPreferences, 'updatedAt'>;
type TaxBody = z.output<typeof SaveInvoiceTaxRateRequest>;
type TemplateBody = z.output<typeof SaveInvoiceTemplateRequest>;
type AccountBody = z.output<typeof SaveDepositAccountRequest>;

/**
 * What a firm that never saved gets, and what Reset to Default restores: every option off
 * (Octavia's Oct 27 review, IP-F04 and IP-F12: nothing is on by default). The table's own column
 * defaults switch some on, so every save writes each field explicitly.
 */
export const DEFAULTS: Sections = {
  invoiceDefaults: {
    invoicePrefix: 'INV-',
    defaultTerms: 'net_14',
    defaultMemo: null,
    customTermDays: [],
  },
  reminders: {
    sendReminders: false,
    reminderDaysBefore: 3,
    notifyOverdue: false,
    overdueReminderDays: 7,
    autoReceipts: false,
    autoApplyPayments: false,
    retryAttempts: 0,
    retryIntervalDays: 3,
  },
  taxesAndFees: {
    lateFeeEnabled: false,
    lateFeeType: null,
    lateFeePercent: null,
    lateFeeCents: null,
    tippingEnabled: false,
    requirePaymentBeforeDue: false,
  },
};

const conflict = () =>
  new ConflictException({
    code: 'SAVE_CONFLICT',
    message: 'Someone else saved these settings. Reload to see their changes.',
  });
const nameTaken = (what: string) =>
  new ConflictException({
    code: 'NAME_TAKEN',
    message: `A ${what} with this name already exists.`,
  });
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const isUnique = (e: unknown) => (e as { code?: string }).code === 'P2002';

type Row = Prisma.PaymentSettingsGetPayload<object>;

function sectionsOf(row: Row | null): PaymentPreferences {
  if (!row) return { ...DEFAULTS, updatedAt: null };
  const customTermDays = [...row.customTermDays].sort((a, b) => a - b);
  // Terms the firm no longer offers (or an unknown code) read as the default.
  const terms = PaymentTerm.safeParse(row.defaultTerms).data;
  const offered = terms !== undefined && offeredPaymentTerms(customTermDays).includes(terms);
  return {
    invoiceDefaults: {
      invoicePrefix: row.invoicePrefix,
      defaultTerms: offered ? terms : DEFAULTS.invoiceDefaults.defaultTerms,
      defaultMemo: row.defaultMemo,
      customTermDays,
    },
    reminders: {
      sendReminders: row.sendReminders,
      reminderDaysBefore: row.reminderDaysBefore,
      notifyOverdue: row.notifyOverdue,
      overdueReminderDays: row.overdueReminderDays,
      autoReceipts: row.autoReceipts,
      autoApplyPayments: row.autoApplyPayments,
      retryAttempts: row.retryAttempts,
      retryIntervalDays: row.retryIntervalDays,
    },
    taxesAndFees: {
      lateFeeEnabled: row.lateFeeEnabled,
      lateFeeType: row.lateFeeType,
      lateFeePercent: row.lateFeePercent === null ? null : Number(row.lateFeePercent),
      lateFeeCents: row.lateFeeCents,
      tippingEnabled: row.tippingEnabled,
      requirePaymentBeforeDue: row.requirePaymentBeforeDue,
    },
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Every column the screen owns, written explicitly (never the table's defaults). */
const columnsOf = (s: Sections) => {
  const fees = s.taxesAndFees;
  // A late fee keeps only the value of its type, as the table's check requires.
  return {
    ...s.invoiceDefaults,
    customTermDays: [...s.invoiceDefaults.customTermDays].sort((a, b) => a - b),
    ...s.reminders,
    lateFeeEnabled: fees.lateFeeEnabled,
    lateFeeType: fees.lateFeeType,
    lateFeePercent: fees.lateFeeType === 'PERCENT' ? fees.lateFeePercent : null,
    lateFeeCents: fees.lateFeeType === 'FIXED' ? fees.lateFeeCents : null,
    tippingEnabled: fees.tippingEnabled,
    requirePaymentBeforeDue: fees.requirePaymentBeforeDue,
  };
};

/** Field names whose values differ (the audit names fields, never values). */
const changed = (a: Sections, b: Sections) =>
  (Object.keys(columnsOf(a)) as (keyof ReturnType<typeof columnsOf>)[]).filter(
    (k) => JSON.stringify(columnsOf(a)[k]) !== JSON.stringify(columnsOf(b)[k]),
  );

const taxView = (r: {
  id: string;
  name: string;
  rateBps: number;
  isDefault: boolean;
}): InvoiceTaxRate => ({
  id: r.id,
  name: r.name,
  rateBps: r.rateBps,
  isDefault: r.isDefault,
});
const accountSelect = { id: true, name: true, isDefault: true } as const;
const templateSelect = {
  id: true,
  name: true,
  description: true,
  memo: true,
  footer: true,
  showLogo: true,
  isDefault: true,
} as const;

/**
 * Settings > Payments' Invoice Defaults, Reminders & Automations and Taxes & Fees (IP-F13), on the
 * firm's canonical tables, in its scope; each change audited by field or record name.
 */
@Injectable()
export class PaymentPreferencesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, userId: string, fn: (tx: TxClient) => Promise<T>) {
    return this.db.withScope({ kind: 'business', businessId, actorUserId: userId }, fn);
  }

  async get(businessId: string, userId: string): Promise<PaymentPreferences> {
    return this.inFirm(businessId, userId, async (tx) =>
      sectionsOf(await tx.paymentSettings.findUnique({ where: { businessId } })),
    );
  }

  private async save(
    businessId: string,
    userId: string,
    expected: string | null,
    next: Sections,
    action: string,
  ): Promise<PaymentPreferences> {
    return this.inFirm(businessId, userId, async (tx) => {
      // Lock the row (or the firm's absence of one) so two saves never both pass the check.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`payment-settings:${businessId}`}))) AS l`;
      const row = await tx.paymentSettings.findUnique({ where: { businessId } });
      if ((row?.updatedAt.toISOString() ?? null) !== expected) throw conflict();
      const before = sectionsOf(row);
      const data = { ...columnsOf(next), updatedByUserId: userId };
      const saved = await tx.paymentSettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      await this.audit.logIn(
        tx,
        action,
        { type: 'business', id: businessId },
        { fields: changed(before, next) },
        { businessId, actorUserId: userId },
      );
      return sectionsOf(saved);
    });
  }

  update(businessId: string, userId: string, body: Update): Promise<PaymentPreferences> {
    const { updatedAt, ...sections } = body;
    return this.save(businessId, userId, updatedAt, sections, 'payment_preferences.updated');
  }

  reset(businessId: string, userId: string, updatedAt: string | null) {
    return this.save(businessId, userId, updatedAt, DEFAULTS, 'payment_preferences.reset');
  }

  // ---------- Tax rates ----------
  async taxRates(businessId: string, userId: string) {
    return this.inFirm(businessId, userId, async (tx) => ({
      items: (
        await tx.invoiceTaxRate.findMany({
          where: { businessId, archivedAt: null },
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        })
      ).map(taxView),
    }));
  }

  async saveTaxRate(businessId: string, userId: string, id: string | null, body: TaxBody) {
    try {
      return await this.inFirm(businessId, userId, async (tx) => {
        if (
          id &&
          !(await tx.invoiceTaxRate.findFirst({ where: { businessId, id, archivedAt: null } }))
        )
          throw notFound();
        // One default per firm: the new default takes it from the old one.
        if (body.isDefault)
          await tx.invoiceTaxRate.updateMany({
            where: { businessId, isDefault: true, ...(id ? { id: { not: id } } : {}) },
            data: { isDefault: false },
          });
        const row = id
          ? await tx.invoiceTaxRate.update({ where: { id }, data: body })
          : await tx.invoiceTaxRate.create({ data: { businessId, ...body } });
        await this.audit.logIn(
          tx,
          id ? 'invoice_tax_rate.updated' : 'invoice_tax_rate.created',
          { type: 'invoice_tax_rate', id: row.id },
          { name: row.name, rateBps: row.rateBps, isDefault: row.isDefault },
          { businessId, actorUserId: userId },
        );
        return taxView(row);
      });
    } catch (e) {
      if (isUnique(e)) throw nameTaken('tax');
      throw e;
    }
  }

  async archiveTaxRate(businessId: string, userId: string, id: string) {
    await this.inFirm(businessId, userId, async (tx) => {
      const row = await tx.invoiceTaxRate.findFirst({
        where: { businessId, id, archivedAt: null },
      });
      if (!row) throw notFound();
      await tx.invoiceTaxRate.update({
        where: { id },
        data: { archivedAt: new Date(), isDefault: false },
      });
      await this.audit.logIn(
        tx,
        'invoice_tax_rate.archived',
        { type: 'invoice_tax_rate', id },
        { name: row.name },
        { businessId, actorUserId: userId },
      );
    });
    return this.taxRates(businessId, userId);
  }

  // ---------- Deposit accounts (IP-F12) ----------
  async depositAccounts(businessId: string, userId: string): Promise<{ items: DepositAccount[] }> {
    return this.inFirm(businessId, userId, async (tx) => ({
      items: await tx.depositAccount.findMany({
        where: { businessId, archivedAt: null },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        select: accountSelect,
      }),
    }));
  }

  async saveDepositAccount(
    businessId: string,
    userId: string,
    id: string | null,
    body: AccountBody,
  ): Promise<DepositAccount> {
    try {
      return await this.inFirm(businessId, userId, async (tx) => {
        if (
          id &&
          !(await tx.depositAccount.findFirst({ where: { businessId, id, archivedAt: null } }))
        )
          throw notFound();
        // One default per firm (deposit_accounts_one_default): the new one takes it over.
        if (body.isDefault)
          await tx.depositAccount.updateMany({
            where: { businessId, isDefault: true, ...(id ? { id: { not: id } } : {}) },
            data: { isDefault: false },
          });
        const row = id
          ? await tx.depositAccount.update({ where: { id }, data: body, select: accountSelect })
          : await tx.depositAccount.create({
              data: { businessId, ...body },
              select: accountSelect,
            });
        await this.audit.logIn(
          tx,
          id ? 'deposit_account.updated' : 'deposit_account.created',
          { type: 'deposit_account', id: row.id },
          { name: row.name, isDefault: row.isDefault },
          { businessId, actorUserId: userId },
        );
        return row;
      });
    } catch (e) {
      if (isUnique(e)) throw nameTaken('deposit account');
      throw e;
    }
  }

  /** Payments already recorded to it keep showing its name. */
  async archiveDepositAccount(businessId: string, userId: string, id: string) {
    await this.inFirm(businessId, userId, async (tx) => {
      const row = await tx.depositAccount.findFirst({
        where: { businessId, id, archivedAt: null },
      });
      if (!row) throw notFound();
      await tx.depositAccount.update({
        where: { id },
        data: { archivedAt: new Date(), isDefault: false },
      });
      await this.audit.logIn(
        tx,
        'deposit_account.archived',
        { type: 'deposit_account', id },
        { name: row.name },
        { businessId, actorUserId: userId },
      );
    });
    return this.depositAccounts(businessId, userId);
  }

  // ---------- Templates ----------
  async templates(businessId: string, userId: string) {
    return this.inFirm(businessId, userId, async (tx) => ({
      items: (await tx.invoiceTemplate.findMany({
        where: { businessId, archivedAt: null },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        select: templateSelect,
      })) as InvoiceTemplateView[],
    }));
  }

  async saveTemplate(businessId: string, userId: string, id: string | null, body: TemplateBody) {
    try {
      return await this.inFirm(businessId, userId, async (tx) => {
        if (
          id &&
          !(await tx.invoiceTemplate.findFirst({ where: { businessId, id, archivedAt: null } }))
        )
          throw notFound();
        if (body.isDefault)
          await tx.invoiceTemplate.updateMany({
            where: { businessId, isDefault: true, ...(id ? { id: { not: id } } : {}) },
            data: { isDefault: false },
          });
        const row = id
          ? await tx.invoiceTemplate.update({ where: { id }, data: body, select: templateSelect })
          : await tx.invoiceTemplate.create({
              data: { businessId, ...body },
              select: templateSelect,
            });
        await this.audit.logIn(
          tx,
          id ? 'invoice_template.updated' : 'invoice_template.created',
          { type: 'invoice_template', id: row.id },
          { name: row.name, isDefault: row.isDefault },
          { businessId, actorUserId: userId },
        );
        return row as InvoiceTemplateView;
      });
    } catch (e) {
      if (isUnique(e)) throw nameTaken('template');
      throw e;
    }
  }

  async archiveTemplate(businessId: string, userId: string, id: string) {
    await this.inFirm(businessId, userId, async (tx) => {
      const row = await tx.invoiceTemplate.findFirst({
        where: { businessId, id, archivedAt: null },
      });
      if (!row) throw notFound();
      await tx.invoiceTemplate.update({
        where: { id },
        data: { archivedAt: new Date(), isDefault: false },
      });
      await this.audit.logIn(
        tx,
        'invoice_template.archived',
        { type: 'invoice_template', id },
        { name: row.name },
        { businessId, actorUserId: userId },
      );
    });
    return this.templates(businessId, userId);
  }
}

const uuidPipe = new ZodValidationPipe(z.uuid());

/** /business/settings/payment-preferences: Owner and Admin; the firm from TenantGuard. */
@Controller('business/settings/payment-preferences')
@Roles(...FIRM_MANAGERS)
export class PaymentPreferencesController {
  constructor(private readonly prefs: PaymentPreferencesService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext, @CurrentTenant() t: TenantContext) {
    return this.prefs.get(t.businessId, auth.userId);
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(UpdatePaymentPreferencesRequest)) body: Update,
  ) {
    return this.prefs.update(t.businessId, auth.userId, body);
  }

  @Post('reset')
  @HttpCode(200)
  reset(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(ResetPaymentPreferencesRequest))
    body: z.output<typeof ResetPaymentPreferencesRequest>,
  ) {
    return this.prefs.reset(t.businessId, auth.userId, body.updatedAt);
  }

  @Get('tax-rates')
  taxRates(@CurrentAuth() auth: AuthContext, @CurrentTenant() t: TenantContext) {
    return this.prefs.taxRates(t.businessId, auth.userId);
  }

  @Post('tax-rates')
  createTaxRate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(SaveInvoiceTaxRateRequest)) body: TaxBody,
  ) {
    return this.prefs.saveTaxRate(t.businessId, auth.userId, null, body);
  }

  @Put('tax-rates/:id')
  updateTaxRate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(SaveInvoiceTaxRateRequest)) body: TaxBody,
  ) {
    return this.prefs.saveTaxRate(t.businessId, auth.userId, id, body);
  }

  @Post('tax-rates/:id/archive')
  @HttpCode(200)
  archiveTaxRate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.prefs.archiveTaxRate(t.businessId, auth.userId, id);
  }

  @Get('deposit-accounts')
  depositAccounts(@CurrentAuth() auth: AuthContext, @CurrentTenant() t: TenantContext) {
    return this.prefs.depositAccounts(t.businessId, auth.userId);
  }

  @Post('deposit-accounts')
  createDepositAccount(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(SaveDepositAccountRequest)) body: AccountBody,
  ) {
    return this.prefs.saveDepositAccount(t.businessId, auth.userId, null, body);
  }

  @Put('deposit-accounts/:id')
  updateDepositAccount(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(SaveDepositAccountRequest)) body: AccountBody,
  ) {
    return this.prefs.saveDepositAccount(t.businessId, auth.userId, id, body);
  }

  @Post('deposit-accounts/:id/archive')
  @HttpCode(200)
  archiveDepositAccount(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.prefs.archiveDepositAccount(t.businessId, auth.userId, id);
  }

  @Get('templates')
  templates(@CurrentAuth() auth: AuthContext, @CurrentTenant() t: TenantContext) {
    return this.prefs.templates(t.businessId, auth.userId);
  }

  @Post('templates')
  createTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Body(new ZodValidationPipe(SaveInvoiceTemplateRequest)) body: TemplateBody,
  ) {
    return this.prefs.saveTemplate(t.businessId, auth.userId, null, body);
  }

  @Put('templates/:id')
  updateTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(SaveInvoiceTemplateRequest)) body: TemplateBody,
  ) {
    return this.prefs.saveTemplate(t.businessId, auth.userId, id, body);
  }

  @Post('templates/:id/archive')
  @HttpCode(200)
  archiveTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.prefs.archiveTemplate(t.businessId, auth.userId, id);
  }
}

@Module({
  controllers: [PaymentPreferencesController],
  providers: [PaymentPreferencesService],
})
export class PaymentPreferencesModule {}
