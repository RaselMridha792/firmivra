// Server-safe icons: this file is read by the module page (a server component) and the sidebar.
import {
  ArrowsClockwise,
  Briefcase,
  Calculator,
  ChartLineUp,
  ChartPieSlice,
  CheckSquare,
  CurrencyDollar,
  Files,
  FileText,
  Globe,
  IdentificationCard,
  Layout,
  PaperPlaneTilt,
  PuzzlePiece,
  ShieldCheck,
  Tag,
} from '@phosphor-icons/react/ssr';
import type { Icon } from '@phosphor-icons/react';

/** A firm workspace module whose page is not built yet. */
export interface FirmModule {
  slug: string;
  label: string;
  icon: Icon;
}

/**
 * The sidebar's modules that have no page yet, in the design's order. Each one opens the shared
 * /modules/<slug> page. When a module is built, remove it here and point its sidebar item
 * (`firmMenu` in the firm layout) to the real page.
 */
export const FIRM_MODULES: readonly FirmModule[] = [
  { slug: 'intake-forms', label: 'Intake Forms', icon: FileText },
  { slug: 'documents', label: 'Documents', icon: Files },
  { slug: 'client-portal', label: 'Client Portal', icon: Globe },
  { slug: 'tax-returns', label: 'Tax Returns', icon: IdentificationCard },
  { slug: 'bookkeeping', label: 'Bookkeeping', icon: Calculator },
  { slug: 'payroll', label: 'Payroll', icon: CurrencyDollar },
  { slug: 'tax-planning', label: 'Tax Planning & Strategy', icon: ChartPieSlice },
  { slug: 'business-advisory', label: 'Business Advisory & Development', icon: Briefcase },
  { slug: 'communications', label: 'Communications', icon: PaperPlaneTilt },
  { slug: 'tasks', label: 'Tasks', icon: CheckSquare },
  { slug: 'automations', label: 'Automations', icon: ArrowsClockwise },
  { slug: 'compliance', label: 'Compliance & Deadlines', icon: ShieldCheck },
  { slug: 'reports', label: 'Reports', icon: ChartLineUp },
  { slug: 'templates', label: 'Templates', icon: Layout },
  { slug: 'services-pricing', label: 'Services & Pricing', icon: Tag },
  { slug: 'integrations', label: 'Integrations', icon: PuzzlePiece },
];

export function findModule(slug: string): FirmModule | undefined {
  return FIRM_MODULES.find((m) => m.slug === slug);
}

export function moduleHref(slug: string): string {
  return `/modules/${slug}`;
}
