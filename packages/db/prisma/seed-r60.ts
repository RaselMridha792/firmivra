// R60 seed rows (Clients Review 2): a synthetic LVP business client linked to the seeded LVP
// client as its owner (client_links, G9). Called once by seed.ts; safe to run again (a fixed id,
// an upsert and a create-once). No real client data.
import type { TxClient } from '../src/client.js';
import { SEED_CLIENT_IDS, SEED_USERS } from './seed-data.js';

/** Fixed ids (RFC 9562 UUIDs, variant 8). */
const ID = {
  business: '00000000-0000-4060-8000-000000000001',
  link: '00000000-0000-4060-8000-000000000002',
} as const;

export async function seedR60(tx: TxClient, businessId: string) {
  await tx.client.upsert({
    where: { id: ID.business },
    update: {},
    create: {
      id: ID.business,
      businessId,
      accountType: 'BUSINESS',
      displayName: 'Sample Bakery LLC (fake)',
      email: 'bakery.sample@lvp.test',
    },
  });
  const linked = await tx.clientLink.count({ where: { id: ID.link } });
  if (linked === 0) {
    await tx.clientLink.create({
      data: {
        id: ID.link,
        businessId,
        clientId: ID.business,
        linkedClientId: SEED_CLIENT_IDS.lvp,
        role: 'OWNER',
        note: 'Owner of the bakery (sample)',
        createdByUserId: SEED_USERS.lvpOwner.id,
      },
    });
  }
}
