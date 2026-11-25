// Q35: the Super Admin Leads & CRM writes for admin-scope.test.ts, each against a record of its
// own (consented contacts, an email template, journeys in the state each write needs, an active
// enrollment, demo requests and a booked appointment), made in the Super Admin's admin scope so
// every write meets something it can change.
import { randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { Fixtures } from '../global-setup.js';
import { records, type SupportWrite } from './admin-support-writes.js';

type CrmWrite = SupportWrite & { paramsFn?: () => Record<string, string> };

const refs = { template: '', consentContact: '', demoContact: '', enrollContact: '' };
const params: Record<string, Record<string, string>> = {};
const tag = () => randomUUID().slice(0, 8);

/** The records the CRM writes act on. */
export async function prepareCrm(fx: Fixtures): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'admin', adminUserId: fx.users.admin.id }, async (tx) => {
      const contact = async (consented: boolean) => {
        const c = await tx.salesContact.create({
          data: { name: 'Fake Scope Lead', email: `scope-crm-${tag()}@example.test` },
        });
        if (consented)
          await tx.salesLeadConsent.create({
            data: { contactId: c.id, consented: true, consentedAt: new Date() },
          });
        return c.id;
      };
      refs.consentContact = await contact(false);
      refs.demoContact = await contact(false);
      refs.enrollContact = await contact(true);

      const category = await tx.commTemplateCategory.create({
        data: { name: `Fake scope CRM category ${tag()}`, position: 101 },
      });
      refs.template = (
        await tx.commTemplate.create({
          data: {
            categoryId: category.id,
            name: `Fake scope CRM template ${tag()}`,
            channel: 'EMAIL',
            subject: 'Fake scope',
            body: 'Fake scope body',
          },
        })
      ).id;
      const steps = [{ delayDays: 1, channel: 'EMAIL', templateId: refs.template }];

      /** A journey; `live` publishes version 1 and makes it ACTIVE; `draft` adds a draft. */
      const journey = async (opts: { live?: boolean; draft?: boolean }) => {
        const j = await tx.salesNurtureJourney.create({
          data: { name: `Fake scope journey ${tag()}` },
        });
        let next = 1;
        if (opts.live) {
          const v = await tx.salesNurtureJourneyVersion.create({
            data: { journeyId: j.id, version: next++, steps, publishedAt: new Date() },
          });
          await tx.salesNurtureJourney.update({
            where: { id: j.id },
            data: { currentVersionId: v.id, status: 'ACTIVE' },
          });
        }
        const draft = opts.draft
          ? await tx.salesNurtureJourneyVersion.create({
              data: { journeyId: j.id, version: next, steps },
            })
          : null;
        return { id: j.id, draftId: draft?.id ?? '', liveVersion: opts.live ? 1 : 0 };
      };
      records.crmJourneyPatch = (await journey({ live: true })).id;
      records.crmJourneyVersion = (await journey({})).id;
      const edit = await journey({ draft: true });
      params.crmVersionEdit = { id: edit.id, versionId: edit.draftId };
      const pub = await journey({ draft: true });
      params.crmVersionPublish = { id: pub.id, versionId: pub.draftId };
      records.crmJourneyEnroll = (await journey({ live: true })).id;

      const stopHost = await journey({ live: true });
      const stopVersion = await tx.salesNurtureJourney.findUniqueOrThrow({
        where: { id: stopHost.id },
        select: { currentVersionId: true },
      });
      records.crmEnrollmentStop = (
        await tx.salesNurtureEnrollment.create({
          data: {
            journeyId: stopHost.id,
            versionId: stopVersion.currentVersionId!,
            contactId: await contact(true),
          },
        })
      ).id;

      const demo = async () =>
        (await tx.salesDemoRequest.create({ data: { contactId: refs.demoContact } })).id;
      records.crmDemoPatch = await demo();
      records.crmDemoBook = await demo();
      records.crmAppointment = (
        await tx.salesDemoAppointment.create({
          data: {
            requestId: await demo(),
            scheduledAt: new Date(Date.now() + 86_400_000),
          },
        })
      ).id;
    });
  } finally {
    await owner.$disconnect();
  }
}

const C = '/api/v1/admin/crm';
const later = () => new Date(Date.now() + 2 * 86_400_000).toISOString();

/** Each CRM write with a body that passes validation, in the order the sweep runs them. */
export function crmWrites(): Record<string, CrmWrite> {
  const steps = () => [{ delayDays: 2, channel: 'EMAIL', templateId: refs.template }];
  return {
    [`PUT ${C}/contacts/:contactId/consent`]: {
      body: { consented: true, consentSource: 'manual', suppressed: false },
      paramsFn: () => ({ contactId: refs.consentContact }),
    },
    [`POST ${C}/journeys`]: { body: () => Promise.resolve({ name: `Fake scope ${tag()}` }) },
    [`PATCH ${C}/journeys/:id`]: { record: 'crmJourneyPatch', body: { status: 'PAUSED' } },
    [`POST ${C}/journeys/:id/versions`]: {
      record: 'crmJourneyVersion',
      body: () => Promise.resolve({ steps: steps() }),
    },
    [`PUT ${C}/journeys/:id/versions/:versionId`]: {
      body: () => Promise.resolve({ steps: steps() }),
      paramsFn: () => params.crmVersionEdit!,
    },
    [`POST ${C}/journeys/:id/versions/:versionId/publish`]: {
      body: {},
      paramsFn: () => params.crmVersionPublish!,
    },
    [`POST ${C}/journeys/:id/enrollments`]: {
      record: 'crmJourneyEnroll',
      body: () => Promise.resolve({ contactId: refs.enrollContact }),
    },
    [`POST ${C}/enrollments/:id/stop`]: { record: 'crmEnrollmentStop', body: { reason: 'Fake' } },
    [`POST ${C}/demos`]: {
      body: () => Promise.resolve({ contactId: refs.demoContact, topic: 'Fake scope demo' }),
    },
    [`PATCH ${C}/demos/appointments/:id`]: {
      record: 'crmAppointment',
      body: () => Promise.resolve({ scheduledAt: later() }),
    },
    [`PATCH ${C}/demos/:id`]: { record: 'crmDemoPatch', body: { notes: 'Fake scope note' } },
    [`POST ${C}/demos/:id/appointments`]: {
      record: 'crmDemoBook',
      body: () => Promise.resolve({ scheduledAt: later(), durationMinutes: 30 }),
    },
  };
}
