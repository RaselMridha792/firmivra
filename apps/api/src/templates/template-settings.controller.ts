import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  CustomMergeFieldId,
  type MergeField,
  type MergeFieldList,
  type OkResponse,
  type TemplateBranding,
  type TemplateCategory,
  type TemplateCategoryList,
  TemplateCategoryId,
} from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf } from '../workspaces/common.js';
import { TemplateCategoriesService } from './template-categories.service.js';
import { TemplateFieldsService } from './template-fields.service.js';
import {
  BrandingBody,
  CategoriesQuery,
  CreateCategoryBody,
  CustomFieldBody,
  MergeCategoryBody,
  ReorderBody,
  UpdateCategoryBody,
} from './template-input.js';

const OK: OkResponse = { ok: true };
const categoryPipe = new ZodValidationPipe(TemplateCategoryId);
const fieldPipe = new ZodValidationPipe(CustomMergeFieldId);
type Out<S extends z.ZodType> = z.output<S>;

/**
 * Template categories (contract in packages/types/src/templates). Everyone with the Templates
 * view reads; Owner and Admin add, rename, reorder, merge, archive and restore.
 */
@Controller('business/template-categories')
@Access('TEMPLATES')
@Roles(...FIRM_STAFF)
export class TemplateCategoriesController {
  constructor(private readonly categories: TemplateCategoriesService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(CategoriesQuery)) q: Out<typeof CategoriesQuery>,
  ): Promise<TemplateCategoryList> {
    return { items: await this.categories.list(tenant.businessId, actorOf(auth, tenant), q) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateCategoryBody)) body: Out<typeof CreateCategoryBody>,
  ): Promise<TemplateCategory> {
    return this.categories.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Put('order')
  @Roles(...FIRM_MANAGERS)
  async reorder(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ReorderBody)) body: Out<typeof ReorderBody>,
  ): Promise<TemplateCategoryList> {
    return { items: await this.categories.reorder(tenant.businessId, actorOf(auth, tenant), body) };
  }

  @Put(':id')
  @Roles(...FIRM_MANAGERS)
  put(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', categoryPipe) id: string,
    @Body(new ZodValidationPipe(UpdateCategoryBody)) body: Out<typeof UpdateCategoryBody>,
  ): Promise<TemplateCategory> {
    return this.categories.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/merge')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  merge(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', categoryPipe) id: string,
    @Body(new ZodValidationPipe(MergeCategoryBody)) body: Out<typeof MergeCategoryBody>,
  ): Promise<TemplateCategory> {
    return this.categories.merge(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', categoryPipe) id: string,
  ): Promise<TemplateCategory> {
    return this.categories.archive(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/restore')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', categoryPipe) id: string,
  ): Promise<TemplateCategory> {
    return this.categories.restore(tenant.businessId, actorOf(auth, tenant), id);
  }
}

/** The merge-field panel and the firm's own (custom) merge fields. Owner and Admin change them. */
@Controller('business/template-merge-fields')
@Access('TEMPLATES')
@Roles(...FIRM_STAFF)
export class TemplateMergeFieldsController {
  constructor(private readonly fields: TemplateFieldsService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<MergeFieldList> {
    return { items: await this.fields.list(tenant.businessId, actorOf(auth, tenant)) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CustomFieldBody)) body: Out<typeof CustomFieldBody>,
  ): Promise<MergeField> {
    return this.fields.create(tenant.businessId, body);
  }

  @Put(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', fieldPipe) id: string,
    @Body(new ZodValidationPipe(CustomFieldBody)) body: Out<typeof CustomFieldBody>,
  ): Promise<MergeField> {
    return this.fields.update(tenant.businessId, id, body);
  }

  @Delete(':id')
  @Roles(...FIRM_MANAGERS)
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', fieldPipe) id: string,
  ): Promise<OkResponse> {
    await this.fields.remove(tenant.businessId, id);
    return OK;
  }
}

/** Branding & Letterhead: the footer, disclaimer and signature. Owner and Admin change it. */
@Controller('business/template-branding')
@Access('TEMPLATES')
@Roles(...FIRM_STAFF)
export class TemplateBrandingController {
  constructor(private readonly fields: TemplateFieldsService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<TemplateBranding> {
    return this.fields.branding(tenant.businessId);
  }

  @Put()
  @Roles(...FIRM_MANAGERS)
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(BrandingBody)) body: Out<typeof BrandingBody>,
  ): Promise<TemplateBranding> {
    return this.fields.saveBranding(tenant.businessId, actorOf(auth, tenant), body);
  }
}
