// apps/crm/src/lib/leadNumber.ts
//
// Generates the human-readable "SK0001"-style lead number backed by
// crm.lead_number_seq (see drizzle/0007_lead_number_sequence.sql). Kept
// separate from index.ts so the formatting is testable without a database.

import { sql } from 'drizzle-orm';
import type { CrmDb } from '../db/types.js';

/** No cap — padding to 4 digits just means SK10000+ isn't truncated, it's
 * simply wider once the sequence passes 9999. */
export function formatLeadNumber(seq: number | bigint): string {
  return `SK${String(seq).padStart(4, '0')}`;
}

export async function nextLeadIdentity(
  db: CrmDb
): Promise<{ leadNumber: string; leadSequence: number }> {
  const res = await db.execute(sql`SELECT nextval('crm.lead_number_seq') AS seq`);
  const rows = (res as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
  const seq = rows[0]?.seq as string | number | undefined;
  if (seq === undefined) throw new Error('nextLeadNumber: sequence returned no value');
  const numeric = typeof seq === 'string' ? Number.parseInt(seq, 10) : seq;
  if (!Number.isSafeInteger(numeric)) {
    throw new Error('nextLeadNumber: sequence exceeds JavaScript safe integer range');
  }
  return { leadNumber: formatLeadNumber(numeric), leadSequence: numeric };
}

export async function nextLeadNumber(db: CrmDb): Promise<string> {
  return (await nextLeadIdentity(db)).leadNumber;
}
