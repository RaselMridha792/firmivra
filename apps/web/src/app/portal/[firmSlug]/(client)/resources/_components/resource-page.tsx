'use client';

import type { ResourcePage as PageKey } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { ArrowLeft, ArrowRight, Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { BusinessOnly, isBusinessOnly } from './business-only';

/**
 * One resource page (N10): the firm's RESOURCE sections for `page`, in order. Each section's
 * body is Markdown; it shows as plain text until the shared Markdown component is on main.
 */
export function ResourcePage({
  page,
  heading,
  highlight,
  intro,
}: {
  page: PageKey;
  heading: string;
  highlight: string;
  intro: string;
}) {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const content = useApiQuery(['my-content', slug, 'RESOURCE', page], () =>
    api.myContent(slug).list({ kind: 'RESOURCE', category: page }),
  );
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-4">
      <header className="lg:col-span-3">
        <Link
          href={`/${slug}/business`}
          className="inline-flex items-center gap-2 text-link underline"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to Resources
        </Link>
        <h1 className="mt-2 font-display text-4xl font-bold text-heading">
          {heading} <span className="text-firm-accent">{highlight}</span>
        </h1>
        <p className="mt-2 text-text">{intro}</p>
      </header>
      <Card className="grid gap-3 bg-folder-surface!">
        <Lightbulb aria-hidden className="size-8 text-firm-accent" />
        <h2 className="font-display text-xl font-bold text-heading">Need Professional Help?</h2>
        <p className="text-sm text-text">Our team can help you put this into practice.</p>
        <Link
          href={`/${slug}/appointments`}
          className="inline-flex items-center gap-2 text-link underline"
        >
          Schedule an Appointment <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Card>
      <div className="lg:col-span-4">
        {isBusinessOnly(content.error) ? (
          <BusinessOnly slug={slug} />
        ) : (
          <PageState query={content} empty="Your firm hasn't added anything here yet.">
            {(items) => (
              <div className="grid gap-4 md:grid-cols-2">
                {items.map((item) => (
                  <Card key={item.id} data-testid="resource-section" className="min-w-0">
                    <h2 className="font-display text-xl font-bold text-heading">{item.title}</h2>
                    {item.description ? (
                      <p className="mt-1 text-sm text-muted">{item.description}</p>
                    ) : null}
                    <p className="mt-3 text-sm whitespace-pre-wrap text-text">{item.body}</p>
                  </Card>
                ))}
              </div>
            )}
          </PageState>
        )}
      </div>
    </div>
  );
}
