import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

async function createContact(name: string) {
  return owner.salesContact.create({ data: { name } });
}

beforeAll(async () => {
  f = await createTwoFirms(owner, 'q35crm');
});

describe('Q35 CRM schema', () => {
  it('creates a lead consent per contact', async () => {
    const contact = await createContact('Synthetic Lead');
    const consent = await A().salesLeadConsent.create({
      data: {
        businessId: f.firmA,
        contactId: contact.id,
        consented: true,
        consentSource: 'website_form',
      },
    });
    expect(consent).toMatchObject({ contactId: contact.id, consented: true });
    expect(await A().salesLeadConsent.findMany({ where: { contactId: contact.id } })).toHaveLength(
      1,
    );
    expect(await B().salesLeadConsent.findMany()).toEqual([]);
  });

  it('creates a nurture journey with a version', async () => {
    const journey = await A().salesNurtureJourney.create({
      data: {
        businessId: f.firmA,
        name: 'Synthetic Journey',
        status: 'DRAFT',
      },
    });
    const version = await A().salesNurtureJourneyVersion.create({
      data: {
        businessId: f.firmA,
        journeyId: journey.id,
        version: 1,
        steps: [{ delayDays: 1, templateId: 'synthetic', channel: 'email' }],
      },
    });
    expect(version).toMatchObject({ journeyId: journey.id, version: 1 });
    expect(
      await A().salesNurtureJourneyVersion.findMany({ where: { journeyId: journey.id } }),
    ).toHaveLength(1);
    expect(await B().salesNurtureJourneyVersion.findMany()).toEqual([]);
  });

  it('enrolls a contact in a journey version', async () => {
    const contact = await createContact('Enrolled Lead');
    const journey = await A().salesNurtureJourney.create({
      data: { businessId: f.firmA, name: 'Enroll Journey', status: 'ACTIVE' },
    });
    const version = await A().salesNurtureJourneyVersion.create({
      data: {
        businessId: f.firmA,
        journeyId: journey.id,
        version: 1,
        steps: [],
        publishedAt: new Date(),
      },
    });
    const enrollment = await A().salesNurtureEnrollment.create({
      data: {
        businessId: f.firmA,
        journeyId: journey.id,
        versionId: version.id,
        contactId: contact.id,
        status: 'ACTIVE',
      },
    });
    expect(enrollment).toMatchObject({ contactId: contact.id, status: 'ACTIVE' });
    // duplicate enrollment refused
    await expect(
      failure(
        A().salesNurtureEnrollment.create({
          data: {
            businessId: f.firmA,
            journeyId: journey.id,
            versionId: version.id,
            contactId: contact.id,
            status: 'ACTIVE',
          },
        }),
      ),
    ).resolves.toBeTruthy();
    expect(await B().salesNurtureEnrollment.findMany()).toEqual([]);
  });

  it('creates a demo request and appointment', async () => {
    const contact = await createContact('Demo Lead');
    const request = await A().salesDemoRequest.create({
      data: {
        businessId: f.firmA,
        contactId: contact.id,
        topic: 'Platform demo',
        status: 'PENDING',
      },
    });
    const appointment = await A().salesDemoAppointment.create({
      data: {
        businessId: f.firmA,
        requestId: request.id,
        scheduledAt: new Date(),
        status: 'SCHEDULED',
      },
    });
    expect(appointment).toMatchObject({ requestId: request.id, status: 'SCHEDULED' });
    expect(
      await A().salesDemoAppointment.findMany({ where: { requestId: request.id } }),
    ).toHaveLength(1);
    expect(await B().salesDemoAppointment.findMany()).toEqual([]);
  });

  it('cross-firm isolation: firm B cannot see firm A CRM data', async () => {
    const contactA = await createContact('Firm A Lead');
    await A().salesLeadConsent.create({
      data: { businessId: f.firmA, contactId: contactA.id, consented: true },
    });
    expect(await B().salesLeadConsent.findMany()).toEqual([]);
    expect(await B().salesNurtureJourney.findMany()).toEqual([]);
    expect(await B().salesDemoRequest.findMany()).toEqual([]);
  });
});
