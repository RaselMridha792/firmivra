import {
  ConnectIntegrationRequest as ConnectContract,
  CreateIntegrationRequest as CreateRequestContract,
  DisconnectIntegrationRequest as DisconnectContract,
  IntegrationActivityQuery as ActivityContract,
  IntegrationHistoryQuery as HistoryContract,
  IntegrationMarketplaceQuery as MarketplaceContract,
  IntegrationsQuery as OverviewContract,
  ReconnectIntegrationRequest as ReconnectContract,
  RotateCustomSecretRequest as RotateContract,
  SaveCustomIntegrationRequest as SaveCustomContract,
  SaveIntegrationMappingsRequest as MappingsContract,
  SyncIntegrationRequest as SyncContract,
  UpdateIntegrationSettingsRequest as SettingsContract,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED instead
// of reaching the driver and answering 500: a NUL character or half of a surrogate pair in any
// string. Credentials are never logged: the validation message names a path, never a value.

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
  });

export const IntegrationsQueryInput = clean(OverviewContract);
export const ActivityQuery = clean(ActivityContract);
export const MarketplaceQuery = clean(MarketplaceContract);
export const HistoryQuery = clean(HistoryContract);
export const ConnectBody = clean(ConnectContract);
export const ReconnectBody = clean(ReconnectContract);
export const SettingsBody = clean(SettingsContract);
export const SyncBody = clean(SyncContract);
export const DisconnectBody = clean(DisconnectContract);
export const MappingsBody = clean(MappingsContract);
export const CreateRequestBody = clean(CreateRequestContract);
export const SaveCustomBody = clean(SaveCustomContract);
export const RotateBody = clean(RotateContract);
