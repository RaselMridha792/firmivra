import {
  ActivateAutomationRuleRequest,
  AutomationRulesQuery,
  AutomationRunsQuery,
  AutomationTemplatesQuery,
  CreateAutomationRuleRequest,
  CreateAutomationTemplateRequest,
  ExportAutomationLogsRequest,
  ImportAutomationTemplateRequest,
  PauseAutomationRuleRequest,
  PreviewAutomationRequest,
  RerunAutomationRequest,
  SaveAutomationDefinitionRequest,
  SaveAutomationSettingsRequest,
  SaveRuleAsTemplateRequest,
  TestAutomationRuleRequest,
  UpdateAutomationRuleRequest,
  UpdateAutomationTemplateRequest,
  UseAutomationTemplateRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { badTextPaths } from '../workspaces/input.js';

// The contract's schemas, plus what Postgres cannot hold, refused as 400 VALIDATION_FAILED instead
// of reaching the driver and answering 500: a NUL character or half of a surrogate pair in any
// string, a date in the year 0000, and the settings limits the columns set below the contract's
// (log retention of 90 days or more, a duplicate window of 90 days or less).

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

export const RulesQuery = clean(AutomationRulesQuery);
export const CreateRuleBody = clean(CreateAutomationRuleRequest);
export const UpdateRuleBody = clean(UpdateAutomationRuleRequest);
export const SaveDefinitionBody = clean(SaveAutomationDefinitionRequest);
export const ActivateBody = clean(ActivateAutomationRuleRequest);
export const PauseBody = clean(PauseAutomationRuleRequest);
export const PreviewBody = clean(PreviewAutomationRequest);
export const TestBody = clean(TestAutomationRuleRequest);
export const SaveAsTemplateBody = clean(SaveRuleAsTemplateRequest);
export const TemplatesQuery = clean(AutomationTemplatesQuery);
export const CreateTemplateBody = clean(CreateAutomationTemplateRequest);
export const UpdateTemplateBody = clean(UpdateAutomationTemplateRequest);
export const ImportBody = clean(ImportAutomationTemplateRequest);
export const UseTemplateBody = clean(UseAutomationTemplateRequest);
export const RunsQuery = clean(AutomationRunsQuery);
export const RerunBody = clean(RerunAutomationRequest);
export const ExportBody = clean(ExportAutomationLogsRequest);
export const SettingsBody = clean(SaveAutomationSettingsRequest).superRefine((o, ctx) => {
  const s = o as { logRetentionDays?: number; defaultDedupeDays?: number };
  if (s.logRetentionDays !== undefined && s.logRetentionDays < 90)
    ctx.addIssue({
      code: 'custom',
      path: ['logRetentionDays'],
      message: 'Keep logs at least 90 days',
    });
  if (s.defaultDedupeDays !== undefined && s.defaultDedupeDays > 90)
    ctx.addIssue({ code: 'custom', path: ['defaultDedupeDays'], message: 'Use at most 90 days' });
});
