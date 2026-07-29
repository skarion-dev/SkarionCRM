import { describe, it, expect } from 'vitest';
import type { CrmDb } from '../db/types.js';
import { formatLeadNumber, nextLeadNumber } from './leadNumber.js';

describe('formatLeadNumber', () => {
  it('pads to 4 digits', () => {
    expect(formatLeadNumber(1)).toBe('SK0001');
    expect(formatLeadNumber(42)).toBe('SK0042');
    expect(formatLeadNumber(999)).toBe('SK0999');
  });

  it('does not truncate past 9999', () => {
    expect(formatLeadNumber(10000)).toBe('SK10000');
    expect(formatLeadNumber(123456)).toBe('SK123456');
  });

  it('accepts a bigint', () => {
    expect(formatLeadNumber(7n)).toBe('SK0007');
  });
});

function mockDb(seqValue: string | number): CrmDb {
  return {
    execute: () => Promise.resolve({ rows: [{ seq: seqValue }] }),
  } as unknown as CrmDb;
}

describe('nextLeadNumber', () => {
  it('formats the sequence value returned by the database', async () => {
    const db = mockDb(42);
    expect(await nextLeadNumber(db)).toBe('SK0042');
  });

  it('handles a stringified bigint (as neon-http returns bigint columns)', async () => {
    const db = mockDb('10001');
    expect(await nextLeadNumber(db)).toBe('SK10001');
  });

  it('throws if the sequence query returns no rows', async () => {
    const db = { execute: () => Promise.resolve({ rows: [] }) } as unknown as CrmDb;
    await expect(nextLeadNumber(db)).rejects.toThrow();
  });
});
