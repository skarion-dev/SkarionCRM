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
  it('shows the shared accepted lead pipeline to regular CRM users', () => {
    expect(buildLeadConditions(base)).toHaveLength(2);
  });

  it('applies the same base visibility to superadmins', () => {
    expect(buildLeadConditions({ ...base, isSuperadmin: true })).toHaveLength(2);
    expect(buildLeadConditions({ ...base, role: 'manager' })).toHaveLength(2);
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

  it('requires every included tag when tagMatch is all', () => {
    expect(
      buildLeadConditions({
        ...base,
        tags: ['excellent fit', 'profile capture complete', 'batch 8'],
        tagMatch: 'all',
      })
    ).toHaveLength(5);
  });

  it('adds one condition for every excluded tag', () => {
    expect(
      buildLeadConditions({
        ...base,
        excludedTags: ['future', 'needs profile capture'],
      })
    ).toHaveLength(4);
  });

  it('can filter to tagged or untagged leads', () => {
    expect(buildLeadConditions({ ...base, tagPresence: 'tagged' })).toHaveLength(3);
    expect(buildLeadConditions({ ...base, tagPresence: 'untagged' })).toHaveLength(3);
    expect(buildLeadConditions({ ...base, tagPresence: 'any' })).toHaveLength(2);
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
    ).toHaveLength(6); // deletedAt + reviewState + status + batchId + date + search
  });
});
