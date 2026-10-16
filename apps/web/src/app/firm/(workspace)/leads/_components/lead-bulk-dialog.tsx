'use client';

import type {
  LeadBulkRequest,
  LeadBulkResult,
  LeadOptions,
  LeadPipelineStatus,
} from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { LEAD_PIPELINE_KEY, STAGES } from './lead-shared';

export type LeadBulkDialogState = {
  ids: string[];
  action: 'ASSIGN' | 'STAGE' | 'CAMPAIGN' | 'TAGS' | 'ARCHIVE';
} | null;

type ActiveLeadBulkDialog = NonNullable<LeadBulkDialogState>;

interface LeadBulkDialogProps {
  state: ActiveLeadBulkDialog;
  options?: LeadOptions;
  onClose: () => void;
}

export function LeadBulkDialog({ state, options, onClose }: LeadBulkDialogProps) {
  const [assignedUserId, setAssignedUserId] = useState('');
  const [stage, setStage] = useState<Exclude<LeadPipelineStatus, 'CONVERTED'>>('SUBMITTED');
  const [campaignId, setCampaignId] = useState('');
  const [tagText, setTagText] = useState('');
  const bulk = useApiMutation((body: LeadBulkRequest) => api.leadPipeline.bulk(body), {
    invalidate: LEAD_PIPELINE_KEY,
  });
  const selectedStaffId = assignedUserId || options?.staff[0]?.userId || '';
  const selectedCampaignId = campaignId || options?.campaigns?.[0]?.id || '';
  const labels = {
    ASSIGN: 'Assign Staff',
    STAGE: 'Change Status',
    CAMPAIGN: 'Add to Campaign',
    TAGS: 'Add Tags',
    ARCHIVE: 'Archive Leads',
  } as const;
  const submit = (body: LeadBulkRequest) =>
    bulk.mutate(body, { onSuccess: (_result: LeadBulkResult) => onClose() });

  return (
    <Modal
      open
      title={labels[state.action]}
      subtitle={`${state.ids.length} selected ${state.ids.length === 1 ? 'lead' : 'leads'}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="lead-bulk-form"
            disabled={
              bulk.isPending ||
              (state.action === 'ASSIGN' && !selectedStaffId) ||
              (state.action === 'CAMPAIGN' && !selectedCampaignId)
            }
            className={
              state.action === 'ARCHIVE'
                ? 'border-danger bg-danger text-on-action hover:bg-danger'
                : ''
            }
          >
            {bulk.isPending ? 'Saving…' : state.action === 'ARCHIVE' ? 'Archive' : 'Apply'}
          </Button>
        </>
      }
    >
      <form
        id="lead-bulk-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (state.action === 'ASSIGN' && selectedStaffId)
            submit({ action: 'ASSIGN', ids: state.ids, assignedUserId: selectedStaffId });
          if (state.action === 'STAGE') submit({ action: 'STAGE', ids: state.ids, stage });
          if (state.action === 'CAMPAIGN' && selectedCampaignId)
            submit({ action: 'CAMPAIGN', ids: state.ids, campaignId: selectedCampaignId });
          if (state.action === 'TAGS') {
            const add = [
              ...new Set(
                tagText
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              ),
            ];
            if (add.length) submit({ action: 'TAGS', ids: state.ids, add: add.slice(0, 10) });
          }
          if (state.action === 'ARCHIVE') submit({ action: 'ARCHIVE', ids: state.ids });
        }}
      >
        {state.action === 'ASSIGN' ? (
          <Select
            label="Staff member"
            value={selectedStaffId}
            onChange={(event) => setAssignedUserId(event.target.value)}
            options={[
              { value: '', label: 'Choose a staff member' },
              ...(options?.staff.map((member) => ({ value: member.userId, label: member.name })) ??
                []),
            ]}
          />
        ) : null}
        {state.action === 'STAGE' ? (
          <Select
            label="New status"
            value={stage}
            onChange={(event) =>
              setStage(event.target.value as Exclude<LeadPipelineStatus, 'CONVERTED'>)
            }
            options={STAGES.filter((item) => item.value !== 'CONVERTED')}
          />
        ) : null}
        {state.action === 'CAMPAIGN' ? (
          options?.campaigns?.length ? (
            <Select
              label="Campaign"
              value={selectedCampaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              options={options.campaigns.map((campaign) => ({
                value: campaign.id,
                label: campaign.name,
              }))}
            />
          ) : (
            <p className="text-sm text-muted">No campaigns are available to select.</p>
          )
        ) : null}
        {state.action === 'TAGS' ? (
          <>
            <Input
              label="Tags"
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
              placeholder="Separate tags with commas"
            />
            {options?.tags.length ? (
              <p className="text-sm text-muted">Existing tags: {options.tags.join(', ')}</p>
            ) : null}
          </>
        ) : null}
        {state.action === 'ARCHIVE' ? (
          <p className="text-sm text-text">
            These leads will be archived and kept in the firm’s history.
          </p>
        ) : null}
        {bulk.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(bulk.error)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
