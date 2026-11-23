import type { Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { Env } from '../../src/config/env.js';
import type { NotifyService } from '../../src/notify/notify.types.js';
import { sendSubmittedNotice } from '../../src/intake-workspace/submitted-notice.js';
import { describe, expect, it, vi } from 'vitest';

const businessId = '0199b6a0-0000-7000-8000-000000000001';
const intakeId = '0199b6a0-0000-7000-8000-000000000002';

function dependencies(settings: { notifyAdditionalEmails: string[] } | null, contactEmail: string) {
  const tx = {
    intakeSettings: { findUnique: vi.fn().mockResolvedValue(settings) },
    intake: {
      findFirst: vi.fn().mockResolvedValue({ form: { title: 'Synthetic intake' } }),
    },
    businessSettings: {
      findUnique: vi.fn().mockResolvedValue({ contactEmail }),
    },
  };
  const database = {
    withScope: vi.fn((_scope: unknown, run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  } as unknown as Database;
  const notify = { send: vi.fn().mockResolvedValue(undefined) } as unknown as NotifyService;
  const logger = { warn: vi.fn() } as unknown as Logger;
  const env = { APP_BASE_URL: 'https://app.example.test' } as Env;
  return { tx, database, notify, logger, env };
}

describe('sendSubmittedNotice', () => {
  it('sends the firm contact notice when settings have not been created yet', async () => {
    const deps = dependencies(null, 'firm@example.test');

    await sendSubmittedNotice(deps, businessId, intakeId);

    expect(deps.notify.send).toHaveBeenCalledWith({
      template: 'intake.submitted-notice',
      to: 'firm@example.test',
      businessId,
      data: {
        formTitle: 'Synthetic intake',
        link: 'https://app.example.test/intake-forms',
      },
    });
  });

  it('respects an existing empty list that removed the firm contact', async () => {
    const deps = dependencies({ notifyAdditionalEmails: [] }, 'firm@example.test');

    await sendSubmittedNotice(deps, businessId, intakeId);

    expect(deps.notify.send).not.toHaveBeenCalled();
    expect(deps.tx.businessSettings.findUnique).not.toHaveBeenCalled();
  });
});
