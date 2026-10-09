'use client';

import { Card } from '@firmivra/ui';
import { CloudUpload, Folder } from 'lucide-react';
import { useParams } from 'next/navigation';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { ButtonLink } from '../../../../(public)/_components/button-link';
import { BusinessOnly, isBusinessOnly } from '../../../resources/_components/business-only';
import { ActionItems, BusinessServices, HelpfulResources } from './business-cards';
import { BusinessDocuments } from './business-documents';

/**
 * "Business Documents, Resources, and Services" (docs/mockups/client-portal/Business Tab.png,
 * N09): the firm's shared files, the open document requests, the client's services and the
 * resource pages. An INDIVIDUAL client gets 403 BUSINESS_ONLY from the resources, so the whole
 * tab shows as for business clients only.
 */
export function BusinessScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const gate = useApiQuery(['my-content', slug, 'RESOURCE'], () =>
    api.myContent(slug).list({ kind: 'RESOURCE' }),
  );
  if (isBusinessOnly(gate.error)) return <BusinessOnly slug={slug} />;
  return (
    <PageState query={gate}>
      {() => (
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <Card className="grid min-w-0 grid-cols-1 gap-4">
            <header className="flex flex-col gap-4 md:flex-row md:items-start">
              <Folder
                aria-hidden
                className="size-16 shrink-0 rounded-full bg-folder-surface p-4 text-firm-primary"
              />
              <div className="flex-1">
                <h1 className="font-display text-3xl font-bold text-heading">
                  Business Documents &amp; Resources
                </h1>
                <p className="text-text">
                  Access important business documents, helpful resources, and tools to keep your
                  business organized and growing.
                </p>
              </div>
              <div className="shrink-0">
                <ButtonLink href={`/${slug}/documents`}>
                  <CloudUpload aria-hidden className="size-5" /> Upload Document
                </ButtonLink>
              </div>
            </header>
            <BusinessDocuments slug={slug} />
          </Card>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <ActionItems slug={slug} />
            <BusinessServices slug={slug} />
          </div>
          <HelpfulResources slug={slug} />
        </div>
      )}
    </PageState>
  );
}
