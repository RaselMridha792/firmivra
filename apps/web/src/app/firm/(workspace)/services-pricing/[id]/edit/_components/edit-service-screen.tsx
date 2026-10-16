'use client';

import { useRef } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { ServiceEditor } from './service-editor';
import type { CreateCatalogServiceRequest } from '@firmivra/types';

export function EditServiceScreen({ serviceId }: { serviceId: string }) {
  const query = useApiQuery(['services-pricing', 'service', serviceId], () =>
    api.servicesPricing.service(serviceId),
  );
  const service = query.isError ? undefined : query.data;
  const savedVersionRef = useRef<string | null>(null);
  const save = async (values: CreateCatalogServiceRequest) => {
    if (!service) throw new Error('Load the service before saving changes.');
    const { activate, ...fields } = values;
    const updated = await api.servicesPricing.updateService(serviceId, {
      ...fields,
      version: savedVersionRef.current ?? service.version,
    });
    // If a later availability call fails, a safe retry uses the version we just saved.
    savedVersionRef.current = updated.version;
    const result =
      activate && updated.status !== 'ACTIVE'
        ? await api.servicesPricing.activateService(serviceId)
        : !activate && updated.status === 'ACTIVE'
          ? await api.servicesPricing.deactivateService(serviceId)
          : updated;
    savedVersionRef.current = result.version;
    return result;
  };
  return (
    <div className="min-w-0 space-y-4" data-testid="edit-service-page">
      <PageState query={query}>{() => null}</PageState>
      <fieldset className="min-w-0 border-0 p-0" disabled={!service}>
        <ServiceEditor initial={service} onSaved={save} />
      </fieldset>
    </div>
  );
}
