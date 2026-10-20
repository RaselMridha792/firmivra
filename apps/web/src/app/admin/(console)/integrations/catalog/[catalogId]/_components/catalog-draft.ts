import { plainTextLength } from '@firmivra/ui';
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  SHORT_DESCRIPTION_MAX,
  type CatalogAuthType,
  type CatalogItem,
  type CatalogStatus,
  type IntegrationCategory,
  type LogoFile,
  type PlanAccess,
  type RequiredRole,
  type UpdateCatalogBody,
} from '../../../_components/integrations-contract';
import { urlProblem } from '../../_components/catalog-parts';

/**
 * The catalog edit form's state (docx §7): every field of the five tabs as the inputs hold it,
 * the checks the API applies (so a mistake shows next to its field, on its tab), and the PATCH
 * body with only what changed, saved with the version read.
 */

export type EditTab = 'general' | 'access' | 'setup' | 'display' | 'advanced';

export interface SetupFieldDraft {
  /** A stable key for the row while it is edited. */
  uid: string;
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help: string;
}

export interface Draft {
  name: string;
  category: IntegrationCategory;
  shortDescription: string;
  /** Rich text (HTML) from the editor. */
  description: string;
  logo: LogoFile | null;
  websiteUrl: string;
  helpUrl: string;
  displayLabel: string;
  status: CatalogStatus;
  planAccess: PlanAccess;
  planIds: string[];
  requiredRole: RequiredRole;
  authType: CatalogAuthType;
  instructions: string;
  helpText: string;
  testOnConnect: boolean;
  requiredFields: SetupFieldDraft[];
  /** Comma-separated, as typed. */
  badges: string;
  sortOrder: string;
  featureFlag: string;
  beta: boolean;
  deprecationNotice: string;
  minAppVersion: string;
  rolloutPercent: string;
  /** Comma-separated two-letter state codes, as typed. */
  regions: string;
  platformIntegrationId: string;
}

export const INSTRUCTIONS_MAX = 4000;
export const HELP_TEXT_MAX = 500;
export const DISPLAY_LABEL_MAX = 40;
export const DEPRECATION_MAX = 300;
const FEATURE_FLAG_MAX = 60;
const SECRET_PATTERN = /(sk_live_|sk_test_|whsec_|fv_live_|fv_test_)/;

export function draftOf(item: CatalogItem): Draft {
  return {
    name: item.name,
    category: item.category,
    shortDescription: item.shortDescription,
    description: item.description ?? '',
    logo: item.logo,
    websiteUrl: item.websiteUrl ?? '',
    helpUrl: item.helpUrl ?? '',
    displayLabel: item.displayLabel ?? '',
    status: item.status,
    planAccess: item.planAccess,
    planIds: item.plans.map((plan) => plan.id),
    requiredRole: item.requiredRole,
    authType: item.setup.authType,
    instructions: item.setup.instructions,
    helpText: item.setup.helpText ?? '',
    testOnConnect: item.setup.testOnConnect,
    requiredFields: item.setup.requiredFields.map((field) => ({
      uid: `saved-${field.key}`,
      key: field.key,
      label: field.label,
      secret: field.secret,
      required: field.required,
      help: field.help ?? '',
    })),
    badges: item.badges.join(', '),
    sortOrder: String(item.sortOrder),
    featureFlag: item.advanced.featureFlag ?? '',
    beta: item.advanced.beta,
    deprecationNotice: item.advanced.deprecationNotice ?? '',
    minAppVersion: item.advanced.minAppVersion ?? '',
    rolloutPercent: String(item.advanced.rolloutPercent),
    regions: item.advanced.regions.join(', '),
    platformIntegrationId: item.platformIntegration?.id ?? '',
  };
}

/** "Popular, New" as a list, without blanks or repeats. */
export const listOf = (text: string) => [
  ...new Set(
    text
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  ),
];

type CatalogFields = Omit<UpdateCatalogBody, 'version' | 'confirmAccessLoss'>;

/** Every field the form edits, as the API takes it. */
function fieldsOf(draft: Draft): Required<CatalogFields> {
  return {
    name: draft.name.trim(),
    category: draft.category,
    shortDescription: draft.shortDescription.trim(),
    description: plainTextLength(draft.description) ? draft.description : null,
    logo: draft.logo,
    websiteUrl: draft.websiteUrl.trim() || null,
    helpUrl: draft.helpUrl.trim() || null,
    displayLabel: draft.displayLabel.trim() || null,
    status: draft.status,
    planAccess: draft.planAccess,
    planIds: draft.planIds,
    requiredRole: draft.requiredRole,
    setup: {
      authType: draft.authType,
      instructions: draft.instructions.trim(),
      requiredFields: draft.requiredFields.map((field) => ({
        key: field.key.trim(),
        label: field.label.trim(),
        secret: field.secret,
        required: field.required,
        help: field.help.trim() || null,
      })),
      helpText: draft.helpText.trim() || null,
      testOnConnect: draft.testOnConnect,
    },
    badges: listOf(draft.badges),
    sortOrder: Number(draft.sortOrder),
    advanced: {
      featureFlag: draft.featureFlag.trim() || null,
      beta: draft.beta,
      deprecationNotice: draft.deprecationNotice.trim() || null,
      minAppVersion: draft.minAppVersion.trim() || null,
      rolloutPercent: Number(draft.rolloutPercent),
      regions: listOf(draft.regions).map((region) => region.toUpperCase()),
    },
    platformIntegrationId: draft.platformIntegrationId || null,
  };
}

/** Only the fields that differ from the saved entry (so an untouched field is never rewritten). */
export function changesOf(draft: Draft, saved: Draft): CatalogFields {
  const next = fieldsOf(draft);
  const before = fieldsOf(saved);
  const changes: CatalogFields = {};
  for (const key of Object.keys(next) as (keyof CatalogFields)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(before[key]))
      Object.assign(changes, { [key]: next[key] });
  }
  return changes;
}

export interface DraftError {
  /** The field's element id (focused from the summary). */
  id: string;
  tab: EditTab;
  label: string;
  message: string;
}

/** The API's rules, checked before saving; the first problem's tab opens. */
export function checkDraft(draft: Draft): DraftError[] {
  const errors: DraftError[] = [];
  const add = (id: string, tab: EditTab, label: string, message: string) =>
    errors.push({ id, tab, label, message });
  const name = draft.name.trim();
  if (!name) add('edit-name', 'general', 'Integration Name', 'Enter the integration name.');
  else if (name.length > NAME_MAX)
    add('edit-name', 'general', 'Integration Name', `Keep it to ${NAME_MAX} characters.`);
  const short = draft.shortDescription.trim();
  if (!short) add('edit-short', 'general', 'Short Description', 'Enter a short description.');
  else if (short.length > SHORT_DESCRIPTION_MAX)
    add(
      'edit-short',
      'general',
      'Short Description',
      `Keep it to ${SHORT_DESCRIPTION_MAX} characters.`,
    );
  if (plainTextLength(draft.description) > DESCRIPTION_MAX)
    add(
      'edit-description',
      'general',
      'Detailed Description',
      `Keep it to ${DESCRIPTION_MAX} characters.`,
    );
  const website = urlProblem(draft.websiteUrl, 'website URL');
  if (website) add('edit-website', 'general', 'Website URL', website);

  if (draft.planAccess === 'SELECTED_PLANS' && !draft.planIds.length)
    add(
      'edit-plans',
      'access',
      'Plan Access',
      'Choose at least one plan, or make it available on all plans.',
    );

  if (draft.instructions.trim().length > INSTRUCTIONS_MAX)
    add(
      'edit-instructions',
      'setup',
      'Setup Instructions',
      `Keep them to ${INSTRUCTIONS_MAX} characters.`,
    );
  if (draft.helpText.trim().length > HELP_TEXT_MAX)
    add('edit-help-text', 'setup', 'Help Text', `Keep it to ${HELP_TEXT_MAX} characters.`);
  if (SECRET_PATTERN.test(`${draft.instructions} ${draft.helpText}`))
    add(
      'edit-instructions',
      'setup',
      'Setup Instructions',
      'Customer instructions cannot contain Firmivra keys or secrets.',
    );
  const seen = new Set<string>();
  for (const field of draft.requiredFields) {
    const key = field.key.trim();
    if (!key || !field.label.trim())
      add(
        `edit-field-${field.uid}-key`,
        'setup',
        'Required Fields',
        'Give every field a key and a label.',
      );
    else if (seen.has(key))
      add(
        `edit-field-${field.uid}-key`,
        'setup',
        'Required Fields',
        `The key ${key} is used twice.`,
      );
    seen.add(key);
  }

  if (draft.displayLabel.trim().length > DISPLAY_LABEL_MAX)
    add(
      'edit-display-label',
      'display',
      'Display Label',
      `Keep it to ${DISPLAY_LABEL_MAX} characters.`,
    );
  const badges = listOf(draft.badges);
  if (badges.length > 5 || badges.some((badge) => badge.length > 24))
    add('edit-badges', 'display', 'Badges', 'Use up to 5 badges of 24 characters each.');
  const help = urlProblem(draft.helpUrl, 'help URL');
  if (help) add('edit-help-url', 'display', 'Help / Documentation URL', help);
  if (!/^\d+$/.test(draft.sortOrder.trim()))
    add('edit-order', 'display', 'Catalog Order', 'Enter a whole number from 0.');

  if (draft.featureFlag.trim().length > FEATURE_FLAG_MAX)
    add('edit-flag', 'advanced', 'Feature Flag', `Keep it to ${FEATURE_FLAG_MAX} characters.`);
  if (draft.deprecationNotice.trim().length > DEPRECATION_MAX)
    add(
      'edit-deprecation',
      'advanced',
      'Deprecation Notice',
      `Keep it to ${DEPRECATION_MAX} characters.`,
    );
  if (draft.minAppVersion.trim() && !/^\d+\.\d+(\.\d+)?$/.test(draft.minAppVersion.trim()))
    add('edit-min-version', 'advanced', 'Minimum Version', 'Write the version as 1.2 or 1.2.3.');
  const rollout = draft.rolloutPercent.trim();
  if (!/^\d+$/.test(rollout) || Number(rollout) > 100)
    add('edit-rollout', 'advanced', 'Rollout', 'Enter a whole percent from 0 to 100.');
  if (listOf(draft.regions).some((region) => !/^[A-Za-z]{2}$/.test(region)))
    add('edit-regions', 'advanced', 'Regions', 'Use two-letter state codes, such as TX, CA.');
  return errors;
}
