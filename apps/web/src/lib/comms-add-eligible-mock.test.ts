// C20 (Communications and Messaging Review Two): All Contacts' "Add all eligible" in the mock
// answers and refuses as the API does: it adds the clients the list marks eligible who are not in
// the audience yet, refuses past the limit (409 AUDIENCE_TOO_LARGE, nothing added) and on anything
// but a draft (409 NOT_EDITABLE), and its Undo removes exactly the entries it made (400 for one
// that is not the draft's). Runs the mock directly.
import { describe, expect, it } from 'vitest';
import { createCommunicationsMock } from '../mocks/communications';

// The mock waits a little on every call, as the network would.
const SLOW = { timeout: 30_000 };

describe('communications mock: Add all eligible (C20)', () => {
  it('adds the eligible clients not chosen yet, and Undo removes only those', SLOW, async () => {
    const mock = createCommunicationsMock();
    const d = await mock.create({ channel: 'EMAIL', name: 'Fake reach' });
    const page = await mock.candidates({ communicationId: d.id, view: 'CONTACTS', pageSize: 100 });
    // All Contacts lists clients only, as the API.
    expect(page.items.every((i) => i.kind === 'CLIENT')).toBe(true);
    const [mine, out] = page.items.filter((i) => i.eligible);
    await mock.setAudience(d.id, {
      etag: d.etag,
      clientIds: [mine!.id],
      excludeClientIds: [out!.id],
    });
    const count = await mock.eligibleContacts(d.id);
    expect(count.overLimit).toBe(false);
    const etag = (await mock.get(d.id)).etag;
    const res = await mock.addEligibleContacts(d.id, { etag });
    expect(res.added).toHaveLength(count.count);
    const ids = res.added.map((a) => a.id);
    // Already chosen and left out by hand are skipped; nobody ineligible is added.
    expect(ids).not.toContain(mine!.id);
    expect(ids).not.toContain(out!.id);
    const all = await mock.candidates({ communicationId: d.id, view: 'CONTACTS', pageSize: 100 });
    for (const i of all.items.filter((x) => !x.eligible)) expect(ids).not.toContain(i.id);
    expect((await mock.eligibleContacts(d.id)).count).toBe(0);

    // A later save keeps the entries; Undo then removes exactly them.
    const saved = await mock.get(d.id);
    await mock.setAudience(d.id, {
      etag: saved.etag,
      clientIds: [mine!.id, ...ids],
      excludeClientIds: [out!.id],
    });
    const undone = await mock.removeAudienceEntries(d.id, {
      etag: (await mock.get(d.id)).etag,
      entryIds: res.added.map((a) => a.entryId),
    });
    expect(undone.removed).toBe(ids.length);
    expect(undone.summary.chips.filter((c) => c.kind === 'CLIENT').map((c) => c.id)).toEqual([
      mine!.id,
    ]);
    await expect(
      mock.removeAudienceEntries(d.id, {
        etag: (await mock.get(d.id)).etag,
        entryIds: res.added.map((a) => a.entryId),
      }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('searches as the list does, and refuses past the limit with nothing added', SLOW, async () => {
    const mock = createCommunicationsMock({ audienceLimit: 3 });
    const d = await mock.create({ channel: 'EMAIL', name: 'Fake cap' });
    const wide = await mock.eligibleContacts(d.id);
    expect(wide).toMatchObject({ limit: 3, overLimit: true });
    await expect(mock.addEligibleContacts(d.id, { etag: d.etag })).rejects.toMatchObject({
      status: 409,
      code: 'AUDIENCE_TOO_LARGE',
      message: expect.stringMatching(/more than 3 people one by one/),
    });
    expect((await mock.audience(d.id)).chips).toEqual([]);
    // client1 and client10-client19: narrow it to one.
    const one = await mock.eligibleContacts(d.id, { search: 'client2@' });
    expect(one).toMatchObject({ count: 1, overLimit: false });
    const res = await mock.addEligibleContacts(d.id, { etag: d.etag, search: 'client2@' });
    expect(res.added).toHaveLength(1);
  });

  it(
    'changes a draft only (409 NOT_EDITABLE), and an old version is a conflict',
    SLOW,
    async () => {
      const mock = createCommunicationsMock();
      const sent = (await mock.list({ tab: 'sent', status: 'SENT' })).items[0]!;
      const detail = await mock.get(sent.id);
      await expect(mock.addEligibleContacts(sent.id, { etag: detail.etag })).rejects.toMatchObject({
        status: 409,
        code: 'NOT_EDITABLE',
      });
      await expect(
        mock.removeAudienceEntries(sent.id, { etag: detail.etag, entryIds: [sent.id] }),
      ).rejects.toMatchObject({ status: 409, code: 'NOT_EDITABLE' });
      const d = await mock.create({ channel: 'EMAIL', name: 'Fake old' });
      await expect(mock.addEligibleContacts(d.id, { etag: 'old' })).rejects.toMatchObject({
        status: 409,
        code: 'SAVE_CONFLICT',
      });
    },
  );
});
