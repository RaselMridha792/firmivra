'use client';

import type { ClientAccountType, ConvertLeadToClientRequest, LeadProfile } from '@firmivra/types';
import { useParams } from 'next/navigation';
import { createContext, type ReactNode, use, useState } from 'react';

export type CarryOverKey = keyof NonNullable<ConvertLeadToClientRequest['carryOver']>;

/**
 * What Convert to Client will send, as the steps edit it (Octavia's Leads review, item 16: the
 * fields must be editable before completion). Kept by the convert layout, so it lasts while the
 * person moves between the four step pages; it starts from the lead.
 */
export interface ConvertDraft {
  leadId: string;
  accountType: ClientAccountType;
  fullName: string;
  businessName: string;
  email: string;
  phone: string;
  address: string;
  serviceIds: string[];
  primaryStaffUserId: string;
  additionalStaffUserIds: string[];
  carryOver: Record<CarryOverKey, boolean>;
  sendPortalInvite: boolean;
}

export const CARRY_OVER_KEYS: CarryOverKey[] = [
  'contactInfo',
  'notes',
  'communications',
  'appointments',
  'tasks',
  'documents',
  'intakeForms',
  'tags',
  'attribution',
];

/** The draft a lead starts with: its own details, services and assigned staff; carry everything. */
export function draftFrom(lead: LeadProfile): ConvertDraft {
  return {
    leadId: lead.id,
    accountType: lead.businessName ? 'BUSINESS' : 'INDIVIDUAL',
    fullName: `${lead.firstName} ${lead.lastName}`.trim(),
    businessName: lead.businessName ?? '',
    email: lead.email,
    phone: lead.phone ?? '',
    address: lead.address ?? '',
    serviceIds: lead.services.map((s) => s.id),
    primaryStaffUserId: lead.assignedTo?.userId ?? '',
    additionalStaffUserIds: [],
    carryOver: Object.fromEntries(CARRY_OVER_KEYS.map((k) => [k, true])) as Record<
      CarryOverKey,
      boolean
    >,
    sendPortalInvite: true,
  };
}

/** What has to be fixed before Review & Confirm, by field. Empty when the draft can be sent. */
export function draftErrors(draft: ConvertDraft): Partial<Record<keyof ConvertDraft, string>> {
  const errors: Partial<Record<keyof ConvertDraft, string>> = {};
  if (!draft.fullName.trim()) errors.fullName = 'Enter the client’s full name.';
  if (draft.accountType === 'BUSINESS' && !draft.businessName.trim())
    errors.businessName = 'Enter the business name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()))
    errors.email = 'Enter a valid email address.';
  if (!draft.phone.trim()) errors.phone = 'Enter a phone number.';
  if (!draft.serviceIds.length) errors.serviceIds = 'Choose at least one service.';
  if (!draft.primaryStaffUserId) errors.primaryStaffUserId = 'Choose the primary staff member.';
  return errors;
}

/** The request Convert to Client sends, from the draft. */
export const requestFrom = (
  draft: ConvertDraft,
  idempotencyKey: string,
): ConvertLeadToClientRequest => ({
  idempotencyKey,
  accountType: draft.accountType,
  fullName: draft.fullName.trim(),
  businessName: draft.accountType === 'BUSINESS' ? draft.businessName.trim() || null : null,
  email: draft.email.trim(),
  phone: draft.phone.trim(),
  address: draft.address.trim() || null,
  serviceIds: draft.serviceIds,
  primaryStaffUserId: draft.primaryStaffUserId,
  additionalStaffUserIds: draft.additionalStaffUserIds.filter(
    (u) => u !== draft.primaryStaffUserId,
  ),
  carryOver: draft.carryOver,
  sendPortalInvite: draft.sendPortalInvite,
});

const DraftContext = createContext<{
  draft: ConvertDraft | null;
  setDraft: (draft: ConvertDraft) => void;
} | null>(null);

/** Keeps the draft across the convert steps (`leads/[id]/convert/layout.tsx`). */
export function ConvertDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ConvertDraft | null>(null);
  return <DraftContext value={{ draft, setDraft }}>{children}</DraftContext>;
}

/**
 * The draft for this lead: the edited one, or the lead's own values until something is edited.
 * Null while the lead loads.
 */
export function useConvertDraft(lead: LeadProfile | undefined) {
  const { id } = useParams<{ id: string }>();
  const store = use(DraftContext);
  if (!store) throw new Error('useConvertDraft() works only inside <ConvertDraftProvider>');
  const draft =
    store.draft && store.draft.leadId === id ? store.draft : lead ? draftFrom(lead) : null;
  const update = (patch: Partial<Omit<ConvertDraft, 'leadId'>>) => {
    if (draft) store.setDraft({ ...draft, ...patch });
  };
  return { draft, update };
}
