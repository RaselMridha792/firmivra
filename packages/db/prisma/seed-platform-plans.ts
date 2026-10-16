// R0 stage A seed: the firm-facing plan ladder (Firm_Vera_Pricing_and_Plan_Structure_Value_
// Checked.docx). Reference data, not tenant data. Safe to run again. No subscription rows are
// created here (no backfill for existing firms, Rasel's change C): a missing
// platform_firm_subscriptions row means no plan limits until stage B or the demo seed adds one.
import { runInScope, type createPrismaClient } from '../src/client.js';

type Prisma = ReturnType<typeof createPrismaClient>;

interface Feature {
  key: string;
  label: string;
}

interface PlanDef {
  code: string;
  name: string;
  basePriceCents: number;
  includedSeats: number;
  maxSeats: number | null;
  overagePriceCentsPerSeat: number | null;
  includedLocations: number;
  overagePriceCentsPerLocation: number | null;
  /** Features this tier adds on top of every tier before it (the doc's "Everything in X, plus"). */
  addedFeatures: readonly Feature[];
}

const PLANS: readonly PlanDef[] = [
  {
    code: 'SOLO_CORE',
    name: 'Solo Core',
    basePriceCents: 6900,
    includedSeats: 1,
    maxSeats: 1,
    overagePriceCentsPerSeat: null,
    includedLocations: 1,
    overagePriceCentsPerLocation: null,
    addedFeatures: [
      { key: 'crm_client_records', label: 'CRM and client records' },
      { key: 'basic_client_pipeline', label: 'Basic client pipeline' },
      { key: 'calendar_appointments', label: 'Calendar and appointments' },
      { key: 'tasks_reminders', label: 'Tasks, reminders and follow-ups' },
      { key: 'client_portal', label: 'Client portal' },
      { key: 'document_storage', label: 'Document storage and management' },
      { key: 'email_communication', label: 'Email communication' },
      { key: 'templates', label: 'Templates' },
      { key: 'basic_reporting', label: 'Basic reporting' },
      { key: 'invoicing_payments', label: 'Invoicing and payments' },
    ],
  },
  {
    code: 'SOLO_PRO',
    name: 'Solo Pro',
    basePriceCents: 9900,
    includedSeats: 1,
    maxSeats: 1,
    overagePriceCentsPerSeat: null,
    includedLocations: 1,
    overagePriceCentsPerLocation: null,
    addedFeatures: [
      { key: 'automations_workflows', label: 'Automations and workflow tools' },
      { key: 'proposals_esignatures', label: 'Proposals and e-signatures' },
      { key: 'advanced_pipeline_tools', label: 'Advanced pipeline tools' },
      { key: 'sms_texting', label: 'SMS/texting' },
      { key: 'deeper_reporting', label: 'Deeper reporting' },
      { key: 'integrations', label: 'Integrations' },
    ],
  },
  {
    code: 'SOLO_ELITE',
    name: 'Solo Elite',
    basePriceCents: 14900,
    includedSeats: 1,
    maxSeats: 1,
    overagePriceCentsPerSeat: null,
    includedLocations: 1,
    overagePriceCentsPerLocation: null,
    addedFeatures: [
      { key: 'advanced_automation', label: 'Advanced automation' },
      { key: 'advanced_analytics', label: 'Advanced analytics' },
      { key: 'custom_workflows', label: 'Custom workflows' },
      { key: 'ai_features', label: 'AI features' },
      { key: 'marketing_tools', label: 'Marketing tools' },
      { key: 'custom_firm_branding', label: 'Custom firm branding' },
      { key: 'priority_support', label: 'Priority support' },
      { key: 'higher_usage_limits', label: 'Higher usage limits' },
    ],
  },
  {
    code: 'TEAM_PRO',
    name: 'Team Pro',
    basePriceCents: 19900,
    includedSeats: 3,
    maxSeats: 10,
    overagePriceCentsPerSeat: 2900,
    includedLocations: 1,
    overagePriceCentsPerLocation: null,
    addedFeatures: [
      { key: 'shared_firm_workspace', label: 'Shared firm workspace' },
      { key: 'multiple_staff_accounts', label: 'Multiple staff accounts' },
      { key: 'shared_client_pipeline', label: 'Shared client access and shared client pipeline' },
      { key: 'role_based_access', label: 'Role-based access and permissions' },
      { key: 'team_task_assignment', label: 'Client, task and work assignment across staff' },
      { key: 'team_workflows', label: 'Team workflows and collaboration' },
      { key: 'shared_calendar', label: 'Shared calendar and appointments' },
      { key: 'firm_document_management', label: 'Firm-level document management' },
      { key: 'firm_basic_analytics', label: 'Reports and basic firm analytics' },
    ],
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    basePriceCents: 49900,
    includedSeats: 10,
    maxSeats: 20,
    overagePriceCentsPerSeat: 2500,
    includedLocations: 1,
    overagePriceCentsPerLocation: null,
    addedFeatures: [
      { key: 'advanced_role_permission_controls', label: 'Advanced role and permission controls' },
      { key: 'department_team_segmentation', label: 'Department and team segmentation' },
      { key: 'advanced_firm_reporting', label: 'Advanced firm-wide reporting and analytics' },
      { key: 'approval_workflows', label: 'Approval workflows' },
      { key: 'expanded_workflow_controls', label: 'Expanded workflow controls' },
      { key: 'higher_automation_limits', label: 'Higher automation and usage limits' },
      {
        key: 'stronger_admin_controls',
        label: 'Stronger administrative controls over staff and operations',
      },
      { key: 'expanded_integrations', label: 'Expanded integrations' },
    ],
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    basePriceCents: 79900,
    includedSeats: 20,
    // "Users above 20: TBD" -- no DB-level ceiling yet (pricing doc, Enterprise scaling table).
    maxSeats: null,
    overagePriceCentsPerSeat: null,
    includedLocations: 3,
    overagePriceCentsPerLocation: 14900,
    addedFeatures: [
      { key: 'multi_location_management', label: 'Multi-location management' },
      { key: 'multiple_offices_departments', label: 'Multiple offices and departments' },
      { key: 'enterprise_permissions', label: 'Enterprise-level permissions' },
      { key: 'custom_roles', label: 'Custom roles' },
      { key: 'custom_usage_limits', label: 'Higher or custom usage limits' },
      { key: 'advanced_audit_logs', label: 'Advanced audit and activity logs' },
      { key: 'advanced_enterprise_reporting', label: 'Advanced enterprise reporting' },
      { key: 'priority_onboarding', label: 'Priority onboarding' },
      { key: 'dedicated_support', label: 'Dedicated support/account management' },
      { key: 'custom_integrations', label: 'Custom integrations and configuration' },
    ],
  },
];

export async function seedPlatformPlans(prisma: Prisma): Promise<void> {
  await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    const cumulative: Feature[] = [];
    for (const [i, p] of PLANS.entries()) {
      cumulative.push(...p.addedFeatures);
      const plan = await tx.platformPlan.upsert({
        where: { code: p.code },
        update: {
          name: p.name,
          basePriceCents: p.basePriceCents,
          includedSeats: p.includedSeats,
          maxSeats: p.maxSeats,
          overagePriceCentsPerSeat: p.overagePriceCentsPerSeat,
          includedLocations: p.includedLocations,
          overagePriceCentsPerLocation: p.overagePriceCentsPerLocation,
          displayOrder: i + 1,
        },
        create: {
          code: p.code,
          name: p.name,
          basePriceCents: p.basePriceCents,
          includedSeats: p.includedSeats,
          maxSeats: p.maxSeats,
          overagePriceCentsPerSeat: p.overagePriceCentsPerSeat,
          includedLocations: p.includedLocations,
          overagePriceCentsPerLocation: p.overagePriceCentsPerLocation,
          displayOrder: i + 1,
        },
        select: { id: true },
      });
      for (const f of cumulative) {
        await tx.platformPlanFeature.upsert({
          where: { planId_featureKey: { planId: plan.id, featureKey: f.key } },
          update: { label: f.label },
          create: { planId: plan.id, featureKey: f.key, label: f.label },
        });
      }
    }
  });
}
