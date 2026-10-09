// The shapes a case file in test/isolation/cases/ exports, and the "world" its records live in.
// A world is one set of firm P's records built on demand from the record definitions: the
// refusal tests share one, and each write case's positive control gets a fresh one, so a write
// that archives, cancels or deletes never changes what another case sees. Firm Q gets a world
// too, and firm P a second one (client Y's), for the requests that name a record in the body.
import { randomUUID } from 'node:crypto';
import type { TxClient } from '@firmivra/db';

export interface Person {
  id: string;
  email: string;
}

/** The firm's own services, shared by every world of it. */
export interface OwnIds {
  service: string;
  bookkeeping: string;
}

export interface SeedContext {
  tx: TxClient;
  /** The world's firm: P, or Q for firm Q's own records. */
  businessId: string;
  /** The firm's Owner (P's also runs every firm route's positive control). */
  owner: Person;
  /** The firm's own services, shared by every world of it. */
  own: OwnIds;
  /** Another record of this world, created first if it isn't yet. */
  get(key: string): Promise<string>;
  /** Records a second id the same step made (a staff member's membership, for example). */
  set(key: string, id: string): void;
  /** A new login in the database, for records that need a person (a client, a staff member). */
  person(label: string, pool: 'STAFF' | 'CLIENT'): Promise<Person>;
  /** The world's client: the portal routes' positive control acts as this person. */
  setClient(person: Person): void;
}

export interface RecordDef {
  /** Creates the record in the world's firm and returns its id. */
  create(ctx: SeedContext): Promise<string>;
  /**
   * The record belongs to one client (their engagement, their document), so another client's
   * portal lists must never show it. Firm-wide records (a meeting type, a tip) are false.
   */
  clientPrivate?: boolean;
}

export interface BodyContext {
  own: OwnIds;
}

export interface RecordCase {
  /** Each record param of the path (every param but firmSlug and the fixed ones), and its record. */
  params: Record<string, string>;
  /**
   * A body that passes validation, so the record lookup is what answers. `own` is the acting
   * firm's, so on firm Q's requests only firm P's records can be the reason for a 404.
   */
  body?: object | ((c: BodyContext) => object);
  /**
   * Each top-level body field that names a record (every `...Id`, `...Ids` or `ids` field of the
   * route's body schema), and its record; an `Ids` field gets a list of one. Added to `body`.
   * The suite then sends each field in turn with firm P's (or client X's) record, the rest of the
   * request being the other firm's (or client's) own, and expects a refusal.
   */
  bodyIds?: Record<string, string>;
  /**
   * What firm P's own people get, when it isn't 2xx: a found record in a state that refuses the
   * action (409), or a download with no file store in tests (503). Never 400, 403 or 404. A body
   * naming another firm's or client's record must get some other 4xx.
   */
  expect?: number;
}

/** What each file in test/isolation/cases/ exports; every export is optional. */
export interface CaseModule {
  records?: Record<string, RecordDef>;
  /** `METHOD /api/v1/...` of each firm or portal route with a record param or body id field. */
  cases?: Record<string, RecordCase>;
  /** `METHOD /api/v1/...` of each route that is neither a firm nor a portal route, and why. */
  excluded?: Record<string, string>;
}

export class World {
  readonly rec: Record<string, string> = {};
  client?: Person;
  private readonly pending = new Map<string, Promise<string>>();

  constructor(
    private readonly defs: Record<string, RecordDef>,
    private readonly base: Omit<SeedContext, 'get' | 'set' | 'person' | 'setClient'>,
  ) {}

  get(key: string): Promise<string> {
    const known = this.rec[key];
    if (known) return Promise.resolve(known);
    let p = this.pending.get(key);
    if (!p) {
      const def = this.defs[key];
      if (!def) throw new Error(`No record "${key}": add it to a cases/<module>.ts records export`);
      p = def.create(this.context()).then((id) => (this.rec[key] = id));
      this.pending.set(key, p);
    }
    return p;
  }

  async getAll(keys: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const key of keys) out[key] = await this.get(key);
    return out;
  }

  private context(): SeedContext {
    return {
      ...this.base,
      get: (key) => this.get(key),
      set: (key, id) => {
        this.rec[key] = id;
      },
      person: async (label, pool) => {
        const id = randomUUID();
        const email = `iso-${label}-${id.slice(0, 8)}@iso.test`;
        await this.base.tx.user.create({
          data: { id, cognitoSub: id, pool, email, name: `Fake ${label}` },
        });
        return { id, email };
      },
      setClient: (person) => {
        this.client = person;
      },
    };
  }
}
