'use client';

import { Button, Select } from '@firmivra/ui';
import { Megaphone, Tag } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { LEAD_PIPELINE_KEY, SOURCE_LABELS } from '../../_components/lead-shared';
import { CardFrame } from './profile-cards';
import { useProfile } from './profile-frame';
import { wsKey } from './profile-shared';

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="contents">
    <dt className="text-text">{label}</dt>
    <dd className="text-heading">{value}</dd>
  </div>
);

/**
 * Campaigns tab: where the lead came from (source and campaign, so marketing can be measured),
 * its tags, and adding it to a campaign.
 */
export function CampaignsTab() {
  const { id, profile } = useProfile();
  const options = useApiQuery(wsKey(id, 'options'), () => api.leadPipeline.options());
  const campaigns = options.data?.campaigns ?? [];
  const [picked, setPicked] = useState('');
  const add = useApiMutation(
    () => api.leadPipeline.bulk({ action: 'CAMPAIGN', ids: [id], campaignId: picked }),
    { invalidate: LEAD_PIPELINE_KEY },
  );
  const [done, setDone] = useState<string>();
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <CardFrame icon={Megaphone} title="Source & Campaign" testId="card-campaign">
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
          <Row label="Lead Source" value={profile ? SOURCE_LABELS[profile.source] : '—'} />
          <Row label="Source detail" value={profile?.sourceDetail ?? '—'} />
          <Row label="Campaign" value={profile?.campaign?.name ?? 'Not in a campaign'} />
        </dl>
        <div className="mt-4 flex flex-col gap-3 border-t border-divider pt-4">
          <Select
            label="Add to a campaign"
            value={picked}
            disabled={!profile || campaigns.length === 0}
            onChange={(event) => setPicked(event.target.value)}
            options={[
              {
                value: '',
                label: options.isError
                  ? 'Campaigns are not available right now'
                  : campaigns.length
                    ? 'Choose a campaign…'
                    : 'No campaigns yet',
              },
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!picked || add.isPending}
              onClick={() =>
                add.mutate(undefined, { onSuccess: () => setDone('Added to the campaign.') })
              }
            >
              Add to Campaign
            </Button>
            {add.isError ? (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(add.error)}
              </p>
            ) : done ? (
              <p role="status" className="text-sm text-success">
                {done}
              </p>
            ) : null}
          </div>
          {campaigns.length === 0 && !options.isPending && !options.isError ? (
            <p className="text-sm text-muted">
              Campaigns are created in Communications. The lead keeps its source either way.
            </p>
          ) : null}
        </div>
      </CardFrame>
      <CardFrame icon={Tag} title="Tags" testId="card-tags">
        {profile?.tags.length ? (
          <ul className="flex flex-wrap gap-2">
            {profile.tags.map((tag) => (
              <li key={tag} className="rounded-md bg-accent-soft px-3 py-1 text-sm text-accent">
                {tag}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-canvas p-6 text-center text-sm text-muted">
            This lead has no tags yet. Add them from Edit Lead.
          </p>
        )}
      </CardFrame>
    </div>
  );
}
