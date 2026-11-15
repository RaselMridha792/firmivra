import { INTAKE_FILE_SIZE_CHOICES } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { IntakeSettings, UpdateIntakeSettingsRequest } from '@firmivra/types';
import {
  changesOf,
  fileSizeOptions,
  legacyRetentionNote,
  retentionKeptLine,
  toDraft,
} from './settings-model';

describe('fileSizeOptions (Max file size per file, I10)', () => {
  it('offers 2, 5, 10, 50 and 100 MB when the saved size is one of them', () => {
    expect(fileSizeOptions(10)).toEqual([2, 5, 10, 50, 100]);
    expect(fileSizeOptions(10, 50)).toEqual([...INTAKE_FILE_SIZE_CHOICES]);
    expect(fileSizeOptions(null)).toEqual([...INTAKE_FILE_SIZE_CHOICES]);
  });

  it("keeps a firm's older saved size, in order, also while another one is chosen", () => {
    expect(fileSizeOptions(25)).toEqual([2, 5, 10, 25, 50, 100]);
    expect(fileSizeOptions(25, 50)).toEqual([2, 5, 10, 25, 50, 100]);
  });

  it('no longer offers the older size once another one is saved', () => {
    expect(fileSizeOptions(50, 50)).not.toContain(25);
  });
});

describe('legacyRetentionNote (Apply to all saved under I12, Review Two 14b)', () => {
  it('shows a saved 50 as it is, with how to change it', () => {
    expect(legacyRetentionNote(50, 50)).toBe('50 years (saved before; choose 1–30 to change)');
  });
  it('says nothing for 1 to 30, nothing saved, or once the value is being changed', () => {
    expect(legacyRetentionNote(30, 30)).toBeNull();
    expect(legacyRetentionNote(null, null)).toBeNull();
    expect(legacyRetentionNote(50, 12)).toBeNull();
    expect(legacyRetentionNote(50, null)).toBeNull();
  });
});

describe('a save with a saved Apply to all over 30 (Review Two 14b)', () => {
  const saved = IntakeSettings.parse({
    general: {
      defaultExpirationDays: 14,
      allowSaveAndResume: true,
      requireSignature: true,
      autoSubmissionId: true,
      defaultOwner: null,
    },
    clientExperience: {
      showProgressBar: true,
      mobileFriendly: true,
      thankYouMessage: null,
      redirectAfterCompletion: false,
      redirectUrl: null,
    },
    notifications: {
      sendClientConfirmation: true,
      notifyAssignedStaff: true,
      firstReminderAfterMinutes: 4320,
      finalReminderAfterMinutes: 10080,
      expirationAlertMinutes: 1440,
      additionalEmails: [],
    },
    automation: {
      autoCreateClient: false,
      autoCreateFollowUpTask: false,
      routeByServiceType: false,
      defaultFollowUpOwner: null,
    },
    branding: { useFirmBranding: true },
    security: {
      encryptedUploads: true,
      acceptedFileTypes: ['PDF'],
      maxFileSizeMb: 10,
      consentRequired: true,
      dataRetentionYears: 50,
      retention: {
        clientDocuments: null,
        firmDocuments: null,
        intakeSubmissions: null,
        portalMessages: null,
        systemEmails: null,
        taxReturnDocuments: null,
      },
    },
    updatedAt: null,
    version: 'v1',
  });

  it('sends only what changed, so the saved 50 never goes back and the save is valid', () => {
    const before = toDraft(saved);
    const next = toDraft(saved);
    next.security.consentRequired = false;
    next.security.retention = { ...next.security.retention, systemEmails: 4 };
    next.branding.useFirmBranding = false;
    const body = changesOf(next, before);
    expect(body.security).toEqual({
      consentRequired: false,
      retention: { ...before.security.retention, systemEmails: 4 },
    });
    expect(UpdateIntakeSettingsRequest.safeParse({ version: 'v1', ...body }).success).toBe(true);
  });
});

describe('retentionKeptLine (the Security panel, Review Two 14b)', () => {
  it('says how long after the job a record is kept, with the date for a job completed today', () => {
    expect(retentionKeptLine(7, new Date('2026-11-15T10:00:00Z'))).toBe(
      'Kept until 7 years after its job is completed (a job completed today: until Nov 15, 2033). While its job isn’t completed, or if it has none, it is kept.',
    );
    expect(retentionKeptLine(1, new Date('2024-02-29T10:00:00Z'))).toContain(
      '1 year after its job is completed (a job completed today: until Mar 1, 2025)',
    );
  });
  it('says nothing holds a category with no minimum', () => {
    expect(retentionKeptLine(null)).toBe('No minimum: nothing holds these records.');
  });
});
