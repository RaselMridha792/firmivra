import type { AdvisoryResource } from '@firmivra/types';

interface ResourceDef extends AdvisoryResource {
  /** The words sent to a client with it. */
  summary: string;
}

const r = (
  key: string,
  title: string,
  category: string,
  kind: AdvisoryResource['kind'],
  clientFacing: boolean,
  summary: string,
): ResourceDef => ({ key, title, category, kind, clientFacing, url: null, summary });

/** The approved library of guides and checklists (no table yet: see the notes). */
export const RESOURCES: readonly ResourceDef[] = [
  r(
    'business-formation-checklist',
    'Business Formation Checklist',
    'Formation / EIN',
    'CHECKLIST',
    true,
    'The steps to form your business and get your EIN.',
  ),
  r(
    'brand-basics-guide',
    'Brand Basics Guide',
    'Branding',
    'GUIDE',
    true,
    'Name, logo and voice: the basics of a brand that fits your business.',
  ),
  r(
    'website-launch-checklist',
    'Website Launch Checklist',
    'Website',
    'CHECKLIST',
    true,
    'What to have ready before your website goes live.',
  ),
  r(
    'business-banking-checklist',
    'Business Banking Checklist',
    'Banking',
    'CHECKLIST',
    true,
    'What a bank asks for when you open a business account.',
  ),
  r(
    'funding-readiness-checklist',
    'Funding Readiness Checklist',
    'Funding',
    'CHECKLIST',
    true,
    'What lenders and investors look for before they say yes.',
  ),
  r(
    'business-plan-template',
    'Business Plan Template',
    'Business Planning',
    'TEMPLATE',
    true,
    'A simple outline for a business plan you can fill in.',
  ),
  r(
    'market-research-guide',
    'Market Research Guide',
    'Market Research',
    'GUIDE',
    true,
    'How to learn who your customers are and what they will pay.',
  ),
  r(
    'cash-flow-basics',
    'Cash Flow Basics',
    'Financial Management',
    'GUIDE',
    true,
    'How to read and forecast your cash flow.',
  ),
  r(
    'growth-operations-playbook',
    'Growth and Operations Playbook',
    'Growth / Operations',
    'GUIDE',
    true,
    'Systems that help a growing business stay organized.',
  ),
  r(
    'advisory-health-score-reference',
    'Business Health Score (staff reference)',
    'Education',
    'GUIDE',
    false,
    'How the health score is worked out.',
  ),
];
export const resourceOf = (key: string) => RESOURCES.find((x) => x.key === key);
export const toResource = ({ summary: _summary, ...rest }: ResourceDef): AdvisoryResource => rest;
