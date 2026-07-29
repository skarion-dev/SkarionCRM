// apps/crm/src/lib/leadFilters.ts
//
// Shared condition-building and sort-column logic for GET /api/leads and
// GET /api/leads/export.csv — these two routes used to each hand-roll their
// own (differently incomplete) copy of this. One function now, used by both.

import { and, eq, gte, inArray, isNull, like, lte, or, sql, type SQL } from 'drizzle-orm';
import * as schema from '../db/schema.js';

export interface LeadFilterParams {
  isSuperadmin: boolean;
  ownerId: string;
  status?: string;
  statuses?: string[];
  source?: string;
  search?: string;
  owner?: string;
  owners?: string[];
  outreachStatus?: string;
  outreachStatuses?: string[];
  batchId?: string;
  tag?: string;
  tags?: string[];
  createdFrom?: string;
  createdTo?: string;
}

/** Splits a comma-separated query param into a trimmed, non-empty list, or
 * undefined if there's nothing usable — lets callers write `params.statuses
 * ?? []` without worrying about `['']` from an empty string param. */
export function parseCommaList(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/**
 * Builds the WHERE conditions shared by the leads list and CSV export
 * routes. Multi-select params (`statuses`/`owners`/`outreachStatuses`/`tags`)
 * take precedence over their singular counterparts when both are present;
 * the singular ones are kept working for existing bookmarks/saved searches
 * created before multi-select existed.
 */
export function buildLeadConditions(params: LeadFilterParams): SQL[] {
  const conditions: SQL[] = [isNull(schema.leads.deletedAt) as unknown as SQL];

  if (!params.isSuperadmin) {
    conditions.push(eq(schema.leads.ownerId, params.ownerId));
  }

  if (params.statuses?.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conditions.push(inArray(schema.leads.journeyStage, params.statuses as any));
  } else if (params.status) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conditions.push(eq(schema.leads.journeyStage, params.status as any));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (params.source) conditions.push(eq(schema.leads.source, params.source as any));

  if (params.owners?.length) {
    conditions.push(inArray(schema.leads.ownerId, params.owners));
  } else if (params.owner) {
    conditions.push(eq(schema.leads.ownerId, params.owner));
  }

  if (params.outreachStatuses?.length) {
    conditions.push(inArray(schema.leads.outreachStatus, params.outreachStatuses));
  } else if (params.outreachStatus) {
    conditions.push(eq(schema.leads.outreachStatus, params.outreachStatus));
  }

  if (params.batchId) conditions.push(eq(schema.leads.batchId, params.batchId));

  // "Any of these tags" (OR) — matches how tag chips already read elsewhere
  // in the UI, and is simpler than AND semantics for a lead-facing filter.
  const tagList = params.tags?.length ? params.tags : params.tag ? [params.tag] : [];
  if (tagList.length > 0) {
    const tagCondition = or(
      ...tagList.map((t) => sql`${schema.leads.tags} @> ${JSON.stringify([t])}::jsonb`)
    );
    if (tagCondition) conditions.push(tagCondition);
  }

  if (params.createdFrom) {
    conditions.push(gte(schema.leads.createdAt, new Date(params.createdFrom)));
  }
  if (params.createdTo) {
    conditions.push(lte(schema.leads.createdAt, new Date(params.createdTo)));
  }

  if (params.search) {
    const searchLower = params.search.toLowerCase();
    const searchCondition = or(
      like(sql`lower(${schema.leads.email})`, `%${searchLower}%`),
      like(sql`lower(${schema.leads.firstName})`, `%${searchLower}%`),
      like(sql`lower(${schema.leads.lastName})`, `%${searchLower}%`),
      like(sql`lower(${schema.leads.companyName})`, `%${searchLower}%`),
      like(sql`lower(${schema.leads.linkedinUrl})`, `%${searchLower}%`),
      like(sql`lower(${schema.leads.leadNumber})`, `%${searchLower}%`)
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  return conditions;
}

/** Convenience wrapper — most call sites just want a single AND'd condition. */
export function buildLeadWhere(params: LeadFilterParams) {
  return and(...buildLeadConditions(params));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LEAD_SORT_COLUMNS: Record<string, any> = {
  createdAt: schema.leads.createdAt,
  updatedAt: schema.leads.updatedAt,
  firstName: schema.leads.firstName,
  lastName: schema.leads.lastName,
  email: schema.leads.email,
  companyName: schema.leads.companyName,
  status: schema.leads.journeyStage,
  journeyStage: schema.leads.journeyStage,
  outreachStatus: schema.leads.outreachStatus,
  leadNumber: schema.leads.leadNumber,
};

export function resolveLeadSortColumn(sortBy?: string) {
  return LEAD_SORT_COLUMNS[sortBy ?? ''] ?? schema.leads.createdAt;
}
