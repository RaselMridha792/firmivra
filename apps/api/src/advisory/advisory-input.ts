import {
  AddAdvisoryWorkstreamRequest,
  AdvisoryActionItemsQuery,
  AdvisoryActivityQuery,
  AdvisoryClientsQuery,
  AdvisoryFinancialsQuery,
  AdvisoryGoalsQuery,
  AdvisoryMeetingsQuery,
  AdvisoryPlansQuery,
  AdvisoryRecommendationsQuery,
  AdvisoryResourcesQuery,
  CreateAdvisoryActionItemRequest,
  CreateAdvisoryClientRequest,
  CreateAdvisoryFinancialRequest,
  CreateAdvisoryGoalRequest,
  CreateAdvisoryMilestoneRequest,
  CreateAdvisoryPlanRequest,
  CreateAdvisoryRecommendationRequest,
  FinalizeAdvisoryPlanRequest,
  ReorderAdvisoryMilestonesRequest,
  SaveAdvisorySettingsRequest,
  SendAdvisoryPlanRequest,
  SendAdvisoryResourceRequest,
  SetAdvisoryPlanStatusRequest,
  UpdateAdvisoryActionItemRequest,
  UpdateAdvisoryClientRequest,
  UpdateAdvisoryGoalRequest,
  UpdateAdvisoryMilestoneRequest,
  UpdateAdvisoryPlanRequest,
  UpdateAdvisoryRecommendationRequest,
  UpdateAdvisoryWorkstreamRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED
// instead of reaching the driver and answering 500: a NUL character or half of a surrogate pair
// in any string, and a date in the year 0000.

const clean = <S extends z.ZodType>(schema: S): S =>
  schema.superRefine((value, ctx) => {
    const walk = (v: unknown, path: (string | number)[]): void => {
      if (typeof v === 'string' && /^0000-/.test(v)) {
        ctx.addIssue({ code: 'custom', path, message: 'Use a real date' });
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
      else if (typeof v === 'object' && v !== null)
        Object.entries(v).forEach(([k, x]) => walk(x, [...path, k]));
    };
    walk(value, []);
    for (const path of badTextPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: 'Remove the special characters' });
    }
  });

export const ClientsQuery = clean(AdvisoryClientsQuery);
export const CreateClientBody = clean(CreateAdvisoryClientRequest);
export const UpdateClientBody = clean(UpdateAdvisoryClientRequest);
export const AddWorkstreamBody = clean(AddAdvisoryWorkstreamRequest);
export const UpdateWorkstreamBody = clean(UpdateAdvisoryWorkstreamRequest);
export const ActivityQuery = clean(AdvisoryActivityQuery);

export const PlansQuery = clean(AdvisoryPlansQuery);
export const CreatePlanBody = clean(CreateAdvisoryPlanRequest);
export const UpdatePlanBody = clean(UpdateAdvisoryPlanRequest);
export const SetPlanStatusBody = clean(SetAdvisoryPlanStatusRequest);
export const FinalizeBody = clean(FinalizeAdvisoryPlanRequest);
export const SendPlanBody = clean(SendAdvisoryPlanRequest);

export const FinancialsQuery = clean(AdvisoryFinancialsQuery);
export const CreateFinancialBody = clean(CreateAdvisoryFinancialRequest);

export const GoalsQuery = clean(AdvisoryGoalsQuery);
export const CreateGoalBody = clean(CreateAdvisoryGoalRequest);
export const UpdateGoalBody = clean(UpdateAdvisoryGoalRequest);
export const CreateMilestoneBody = clean(CreateAdvisoryMilestoneRequest);
export const UpdateMilestoneBody = clean(UpdateAdvisoryMilestoneRequest);
export const ReorderMilestonesBody = clean(ReorderAdvisoryMilestonesRequest);

export const RecommendationsQuery = clean(AdvisoryRecommendationsQuery);
export const CreateRecommendationBody = clean(CreateAdvisoryRecommendationRequest);
export const UpdateRecommendationBody = clean(UpdateAdvisoryRecommendationRequest);
export const ActionItemsQuery = clean(AdvisoryActionItemsQuery);
export const CreateActionItemBody = clean(CreateAdvisoryActionItemRequest);
export const UpdateActionItemBody = clean(UpdateAdvisoryActionItemRequest);

export const MeetingsQuery = clean(AdvisoryMeetingsQuery);
export const ResourcesQuery = clean(AdvisoryResourcesQuery);
export const SendResourceBody = clean(SendAdvisoryResourceRequest);
export const SettingsBody = clean(SaveAdvisorySettingsRequest);
