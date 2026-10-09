'use client';

import type { MyContentItem } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import {
  ArrowLeft,
  ChartColumn,
  ExternalLink,
  FileText,
  HandCoins,
  Info,
  Landmark,
  Link as LinkIcon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { BusinessOnly, isBusinessOnly } from '../../_components/business-only';

/** The design-system icon names the firm can pick (`iconKey`); anything else is a plain link. */
const ICONS: Record<string, LucideIcon> = {
  irs: Landmark,
  sba: HandCoins,
  fdic: Landmark,
  census: ChartColumn,
  document: FileText,
};

/**
 * /{firm}/resources/external-links (docs/mockups/client-portal/External links .png, N09): the
 * firm's EXTERNAL_LINK cards grouped by section. Every link opens in a new tab.
 */
export function ExternalLinksScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const links = useApiQuery(['my-content', slug, 'EXTERNAL_LINK'], () =>
    api.myContent(slug).list({ kind: 'EXTERNAL_LINK' }),
  );
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <header>
        <Link
          href={`/${slug}/business`}
          className="inline-flex items-center gap-2 text-link underline"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to Resources
        </Link>
        <h1 className="mt-2 font-display text-4xl font-bold text-heading">
          External Links & <span className="text-firm-accent">Business Resources</span>
        </h1>
        <p className="mt-2 text-text">
          Trusted government and financial resources to help you manage, fund, and grow your
          business.
        </p>
      </header>
      <p className="flex gap-2 rounded-card bg-folder-surface p-3 text-sm text-text">
        <Info aria-hidden className="size-5 shrink-0 text-firm-primary" />
        These are external resources and will open third-party or government websites. They are
        provided for your convenience and do not constitute legal, tax, or financial advice.
      </p>
      {isBusinessOnly(links.error) ? (
        <BusinessOnly slug={slug} />
      ) : (
        <PageState query={links} empty="Your firm hasn't added any links yet.">
          {(items) => (
            <>
              {sections(items).map(([section, rows]) => (
                <section
                  key={section}
                  aria-label={section}
                  className="grid gap-4 rounded-card bg-folder-surface p-4"
                >
                  <h2 className="font-display text-2xl font-bold text-heading">{section}</h2>
                  <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {rows.map((item) => (
                      <li key={item.id} className="min-w-0">
                        <LinkCard item={item} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </PageState>
      )}
    </div>
  );
}

const sections = (items: MyContentItem[]): [string, MyContentItem[]][] => {
  const groups = new Map<string, MyContentItem[]>();
  for (const item of items) {
    const key = item.category ?? 'More resources';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups];
};

function LinkCard({ item }: { item: MyContentItem }) {
  const Icon = ICONS[item.iconKey ?? ''] ?? LinkIcon;
  return (
    <Card className="grid h-full gap-2">
      <Icon aria-hidden className="size-10 text-firm-primary" />
      <h3 className="font-display text-lg font-bold text-heading">{item.title}</h3>
      {item.description ? <p className="text-sm text-text">{item.description}</p> : null}
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex items-center gap-2 text-sm break-all text-link underline"
        >
          {item.url}
          <ExternalLink aria-hidden className="size-4 shrink-0" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
    </Card>
  );
}
