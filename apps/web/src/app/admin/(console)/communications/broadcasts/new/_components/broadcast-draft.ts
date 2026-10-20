import type { CommChannel } from '@firmivra/types';

export type BroadcastChannel = Extract<CommChannel, 'EMAIL' | 'SMS' | 'IN_APP'>;

/**
 * Step 1's choices B6 does not keep (description, category, the channels and template chosen
 * before step 3 writes their content), in this tab, per broadcast. The broadcast itself (name,
 * audience, content, schedule) is the API's: the steps carry its id as `?id=`.
 */
export interface BroadcastDraft {
  name: string;
  description: string;
  channels: BroadcastChannel[];
  category: string;
  messageSource: 'template' | 'custom';
  templateId: string;
}

export const BROADCAST_DRAFT_KEY = 'firmivra.broadcast.basic-information';
export const broadcastChannels: BroadcastChannel[] = ['EMAIL', 'SMS', 'IN_APP'];
export const channelLabels: Record<BroadcastChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  IN_APP: 'In-App',
};

export const initialBroadcastDraft: BroadcastDraft = {
  name: '',
  description: '',
  channels: broadcastChannels,
  category: '',
  messageSource: 'template',
  templateId: '',
};

const keyOf = (id: string | null) => (id ? `${BROADCAST_DRAFT_KEY}.${id}` : BROADCAST_DRAFT_KEY);

/** A wizard step's link for a broadcast. */
export const stepHref = (step: '' | 'audience' | 'message' | 'review', id: string) =>
  `/communications/broadcasts/new${step ? `/${step}` : ''}?id=${encodeURIComponent(id)}`;

export function readBroadcastDraft(id: string | null = null): BroadcastDraft | null {
  try {
    const stored = sessionStorage.getItem(keyOf(id));
    if (!stored) return null;
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== 'object') return null;
    if (
      !('name' in value) ||
      typeof value.name !== 'string' ||
      !('description' in value) ||
      typeof value.description !== 'string' ||
      !('category' in value) ||
      typeof value.category !== 'string' ||
      !('templateId' in value) ||
      typeof value.templateId !== 'string' ||
      !('messageSource' in value) ||
      (value.messageSource !== 'template' && value.messageSource !== 'custom') ||
      !('channels' in value) ||
      !Array.isArray(value.channels)
    )
      return null;

    const savedChannels = value.channels;
    const channels = broadcastChannels.filter((channel) => savedChannels.includes(channel));
    return {
      name: value.name,
      description: value.description,
      category: value.category,
      templateId: value.templateId,
      messageSource: value.messageSource,
      channels,
    };
  } catch {
    return null;
  }
}

export function saveBroadcastDraft(draft: BroadcastDraft, id: string | null = null): void {
  try {
    sessionStorage.setItem(keyOf(id), JSON.stringify(draft));
  } catch {
    // Private windows may refuse storage: the broadcast itself is saved by the API.
  }
}
