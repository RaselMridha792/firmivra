import type { CommChannel } from '@firmivra/types';

export type BroadcastChannel = Extract<CommChannel, 'EMAIL' | 'SMS' | 'IN_APP'>;

/** Browser-only form state, not an API request or a persisted server broadcast. */
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

/** The existing Audience route can consume this draft without a new route or an invented API. */
export function readBroadcastDraft(): BroadcastDraft | null {
  try {
    const stored = sessionStorage.getItem(BROADCAST_DRAFT_KEY);
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

export function saveBroadcastDraft(draft: BroadcastDraft): void {
  sessionStorage.setItem(BROADCAST_DRAFT_KEY, JSON.stringify(draft));
}
