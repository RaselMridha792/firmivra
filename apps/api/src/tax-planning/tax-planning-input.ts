import {
  AddPlanStrategyRequest,
  AttachPlanDocumentRequest,
  CalculateSavingsRequest,
  CreatePlanningStrategyRequest,
  CreateTaxOpportunityRequest,
  CreateTaxPlanRequest,
  FinalizePlanRequest,
  OpportunityActionRequest,
  PlanningCalendarQuery,
  PlanningClientsQuery,
  PlanningResourcesQuery,
  PlanningStrategiesQuery,
  ReorderPlanStrategiesRequest,
  RunScreeningRequest,
  SavePlanInputsRequest,
  SaveScenarioRequest,
  SendPlanRequest,
  SendPlanningResourceRequest,
  SetPlanStatusRequest,
  TaxOpportunitiesQuery,
  TaxPlansQuery,
  TaxScenariosQuery,
  UpdatePlanStrategyRequest,
  UpdatePlanningStrategyRequest,
  UpdateTaxPlanRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED
// instead of reaching the driver and answering 500: a NUL character or half of a surrogate pair
// in any string, a date in the year 0000, and the few text limits the columns set below the
// contract's (a client note of 2,000, a goal of 200, a strategy name of 120, a scenario name of 120).

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

const atMost = <S extends z.ZodType>(schema: S, field: string, max: number): S =>
  schema.superRefine((value, ctx) => {
    const v = (value as Record<string, unknown> | null)?.[field];
    if (typeof v === 'string' && v.length > max) {
      ctx.addIssue({ code: 'custom', path: [field], message: `Use at most ${max} characters` });
    }
  });

export const TaxPlansListQuery = clean(TaxPlansQuery);
export const PlanningClientsListQuery = clean(PlanningClientsQuery);
export const CreatePlanBody = atMost(
  atMost(clean(CreateTaxPlanRequest), 'otherGoal', 200),
  'name',
  200,
).superRefine((o, ctx) => {
  const b = o as { otherGoal?: string | null; goals?: string[] };
  if (b.otherGoal && !(b.goals ?? []).includes('OTHER'))
    ctx.addIssue({ code: 'custom', path: ['goals'], message: 'Choose Other to describe a goal' });
});
export const UpdatePlanBody = atMost(
  atMost(clean(UpdateTaxPlanRequest), 'clientNotes', 2_000),
  'otherGoal',
  200,
);
export const SaveInputsBody = clean(SavePlanInputsRequest);
export const AddStrategyBody = clean(AddPlanStrategyRequest);
export const UpdateStrategyBody = clean(UpdatePlanStrategyRequest);
export const ReorderBody = clean(ReorderPlanStrategiesRequest);
export const AttachDocumentBody = clean(AttachPlanDocumentRequest);
export const SetStatusBody = clean(SetPlanStatusRequest);
export const FinalizeBody = clean(FinalizePlanRequest);
export const SendBody = clean(SendPlanRequest);

export const StrategiesQuery = clean(PlanningStrategiesQuery);
export const CreateStrategyBody = atMost(clean(CreatePlanningStrategyRequest), 'name', 120);
export const UpdateStrategyLibraryBody = atMost(clean(UpdatePlanningStrategyRequest), 'name', 120);

export const OpportunitiesQuery = clean(TaxOpportunitiesQuery);
export const CreateOpportunityBody = clean(CreateTaxOpportunityRequest);
export const ActionBody = clean(OpportunityActionRequest);
export const ScreeningBody = clean(RunScreeningRequest);

export const CalculateBody = clean(CalculateSavingsRequest);
export const SaveScenarioBody = atMost(clean(SaveScenarioRequest), 'name', 120);
export const ScenariosQuery = clean(TaxScenariosQuery);

export const CalendarQuery = clean(PlanningCalendarQuery);
export const ResourcesQuery = clean(PlanningResourcesQuery);
export const SendResourceBody = clean(SendPlanningResourceRequest);
