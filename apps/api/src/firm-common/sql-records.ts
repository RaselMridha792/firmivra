import { randomUUID } from 'node:crypto';
import { Prisma, type TxClient } from '@firmivra/db';
import { missing } from './context.js';
/** Identifiers are code-owned. Values always use parameters and the DB's own record casts. */
const fields = {
  appointment_types:
    'id business_id name duration_minutes buffer_before_minutes buffer_after_minutes allowed_methods client_booking_enabled active is_intro_call created_at updated_at',
  working_hours: 'id business_id provider_membership_id weekday start_minute end_minute',
  blocked_times: 'id business_id provider_membership_id starts_at ends_at reason created_at',
  appointments:
    'id business_id client_id client_name provider_membership_id provider_name type_id type_name starts_at ends_at occupied_starts_at occupied_ends_at buffer_before_minutes buffer_after_minutes timezone method location meeting_url instructions status version created_by_user_id request_key request_fingerprint created_at updated_at',
  appointment_histories:
    'id business_id appointment_id action actor_user_id previous_starts_at previous_ends_at previous_status new_starts_at new_ends_at new_status reason created_at',
  appointment_reminders:
    'id business_id appointment_id appointment_version recipient_user_id kind event_key due_at next_attempt_at lease_until lease_token attempts status last_error_code created_at',
  external_links:
    'id business_id section title description url source icon_key sort_order active audience created_at updated_at',
} as const;
export type ModuleTable = keyof typeof fields;
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase());
function identifier(table: ModuleTable) {
  if (!Object.hasOwn(fields, table)) throw new Error('Unknown module table');
  return Prisma.raw(table);
}
function payload(table: ModuleTable, data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const column = snake(key);
    if (!fields[table].split(' ').includes(column)) throw new Error('Unknown module field');
    if (value !== undefined) out[column] = value;
  }
  return out;
}
export function camelRecord<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  ) as T;
}
export class SqlRecords {
  constructor(
    readonly tx: TxClient,
    readonly businessId: string,
  ) {}
  async many<T>(
    table: ModuleTable,
    condition: Prisma.Sql = Prisma.empty,
    order: Prisma.Sql = Prisma.sql`id ASC`,
    limit = 500,
  ): Promise<T[]> {
    const rows = await this.tx.$queryRaw<{ row: Record<string, unknown> }[]>(
      Prisma.sql`SELECT to_jsonb(r) AS row FROM ${identifier(table)} r WHERE business_id=${this.businessId}::uuid ${condition} ORDER BY ${order} LIMIT ${limit}`,
    );
    return rows.map((row) => camelRecord<T>(row.row));
  }
  async one<T>(table: ModuleTable, id: string): Promise<T> {
    const [row] = await this.many<T>(table, Prisma.sql`AND id=${id}::uuid`, Prisma.sql`id`, 1);
    if (!row) throw missing();
    return row;
  }
  async insert<T>(table: ModuleTable, data: Record<string, unknown>): Promise<T> {
    const record = payload(table, { id: randomUUID(), ...data, businessId: this.businessId });
    const columns = Object.keys(record).map((column) => Prisma.raw(column));
    const [row] = await this.tx.$queryRaw<{ row: Record<string, unknown> }[]>(
      Prisma.sql`INSERT INTO ${identifier(table)} AS r (${Prisma.join(columns)}) SELECT ${Prisma.join(columns)} FROM jsonb_populate_record(NULL::${identifier(table)},${JSON.stringify(record)}::jsonb) RETURNING to_jsonb(r) AS row`,
    );
    if (!row) throw missing();
    return camelRecord<T>(row.row);
  }
  async patch<T>(table: ModuleTable, id: string, data: Record<string, unknown>): Promise<T> {
    if ('id' in data || 'businessId' in data) throw new Error('Cannot change record identity');
    const record = payload(table, data),
      columns = Object.keys(record).map((column) => Prisma.raw(column));
    if (!columns.length) return this.one<T>(table, id);
    const [row] = await this.tx.$queryRaw<{ row: Record<string, unknown> }[]>(
      Prisma.sql`UPDATE ${identifier(table)} AS r SET (${Prisma.join(columns)})=(SELECT ${Prisma.join(columns)} FROM jsonb_populate_record(NULL::${identifier(table)},${JSON.stringify(record)}::jsonb)) WHERE business_id=${this.businessId}::uuid AND id=${id}::uuid RETURNING to_jsonb(r) AS row`,
    );
    if (!row) throw missing();
    return camelRecord<T>(row.row);
  }
}
