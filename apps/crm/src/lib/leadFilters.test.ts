import { describe, it, expect } from 'vitest';
import * as schema from '../db/schema.js';
import {
  buildLeadConditions,
  parseCommaList,
  resolveLeadSortColumn,
  LEAD_SORT_COLUMNS,
} from './leadFilters.js';

const base = { isSuperadmin: false, ownerId: 'owner-1' };

describe('parseCommaList', () => {
  it('splits and trims a comma-separated string', () => {
    expect(parseCommaList('new, contacted ,qualified')).toEqual(['new', 'contacted', 'qualified']);
  });

  it('returns undefined for empty/whitespace-only input', () => {
    expect(parseCommaList(undefined)).toBeUndefined();
    expect(parseCommaList('')).toBeUndefined();
    expect(parseCommaList('   ')).toBeUndefined();
    expect(parseCommaList(',,,')).toBeUndefined();
  });
});

describe('resolveLeadSortColumn', () => {
  it('resolves a known column', () => {
    expect(resolveLeadSortColumn('leadNumber')).toBe(LEAD_SORT_COLUMNS.leadNumber);
  });

  it('falls back to createdAt for an unknown or missing column', () => {
    expect(resolveLeadSortColumn('not_a_real_column')).toBe(schema.leads.createdAt);
    expect(resolveLeadSortColumn(undefined)).toBe(schema.leads.createdAt);
  });
});

describe('buildLeadConditions', () => {
  it('scopes non-superadmins to their own leads (deletedAt + ownerId)', () => {
    expect(buildLeadConditions(base)).toHaveLength(2);
  });

  it('does not scope superadmins by owner (deletedAt only)', () => {
    expect(buildLeadConditions({ ...base, isSuperadmin: true })).toHaveLength(1);
  });

  it('adds one condition for a single status filter', () => {
    expect(buildLeadConditions({ ...base, status: 'new' })).toHaveLength(3);
  });

  it('multi-select statuses takes precedence over singular status, not additive', () => {
    const withBoth = buildLeadConditions({
      ...base,
      status: 'new',
      statuses: ['new', 'contacted'],
    });
    const withMultiOnly = buildLeadConditions({ ...base, statuses: ['new', 'contacted'] });
    expect(withBoth).toHaveLength(withMultiOnly.length);
    expect(withBoth).toHaveLength(3);
  });

  it('collapses multiple tags into a single OR condition', () => {
    const withOneTag = buildLeadConditions({ ...base, tag: 'vip' });
    const withThreeTags = buildLeadConditions({ ...base, tags: ['vip', 'warm', 'cold'] });
    expect(withOneTag).toHaveLength(3);
    expect(withThreeTags).toHaveLength(3);
  });

  it('adds one condition per side of a date range', () => {
    expect(
      buildLeadConditions({ ...base, createdFrom: '2026-01-01', createdTo: '2026-06-01' })
    ).toHaveLength(4);
    expect(buildLeadConditions({ ...base, createdFrom: '2026-01-01' })).toHaveLength(3);
  });

  it('adds one condition for search', () => {
    expect(buildLeadConditions({ ...base, search: 'acme' })).toHaveLength(3);
  });

  it('stacks independent filters additively', () => {
    expect(
      buildLeadConditions({
        ...base,
        status: 'new',
        batchId: 'batch-1',
        search: 'acme',
        createdFrom: '2026-01-01',
      })
    ).toHaveLength(6); // deletedAt + ownerId + status + batchId + createdFrom + search
  });
});
