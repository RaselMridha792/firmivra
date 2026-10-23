'use client';

import type { CommunicationChannel } from '@firmivra/types';
import { Button, Drawer } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { Composer } from '../../communications/_components/composer';
import { COMM_ERRORS } from '../../communications/_components/communications-shared';
import { LEAD_PIPELINE_KEY } from './lead-shared';

// Create Campaign on the Leads page (L7 of Octavia's Leads review): the Communications builder in
// a wide panel, so the Leads page underneath keeps its filters and selection. Starting makes a
// draft in Communications and nothing else: no lead joins it and nothing is sent until the member
// adds recipients (here, or with Add to Campaign) and sends it.

const CHANNELS: { value: Extract<CommunicationChannel, 'EMAIL' | 'SMS'>; label: string }[] = [
  { value: 'EMAIL', label: 'Email campaign' },
  { value: 'SMS', label: 'Text message campaign' },
];

export function CreateCampaignPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [id, setId] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The new draft is one of the campaigns Add to Campaign and the filter offer.
  const close = () => {
    void queryClient.invalidateQueries({ queryKey: [...LEAD_PIPELINE_KEY, 'options'] });
    onClose();
  };
  const start = async (channel: Extract<CommunicationChannel, 'EMAIL' | 'SMS'>) => {
    setStarting(channel);
    setProblem(null);
    try {
      setId((await api.communications.create({ channel })).id);
    } catch (error) {
      setProblem(errorMessage(error, COMM_ERRORS));
    } finally {
      setStarting(null);
    }
  };
  return (
    <Drawer
      open
      size="wide"
      title="Create Campaign"
      subtitle="Built in Communications. It stays a draft until you send it, and no lead is added by creating it."
      onClose={close}
    >
      {id ? (
        <Composer id={id} embedded={{ onClose: close, onDone: close }} />
      ) : (
        <div className="flex flex-col gap-4" data-testid="campaign-start">
          <p className="text-sm text-text">
            Choose the kind of campaign. It is saved as a draft in Communications, where it also
            appears, and Add to Campaign offers it once it exists.
          </p>
          <div className="flex flex-wrap gap-3">
            {CHANNELS.map((c) => (
              <Button
                key={c.value}
                variant="secondary"
                disabled={starting !== null}
                onClick={() => void start(c.value)}
              >
                {starting === c.value ? 'Starting…' : c.label}
              </Button>
            ))}
          </div>
          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
