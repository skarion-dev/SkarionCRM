// apps/crm/web/src/lib/leadFilters.ts
//
// One shared shape for "everything that narrows the leads list" — used by
// the infinite-scroll query, the CSV export, and saved searches, so all
// three always agree on what a filter combination means. Previously each of
// those built its own (differently incomplete) querystring by hand.

export interface LeadFilters {
  search?: string;
  statuses?: string[];
  outreachStatuses?: string[];
  owners?: string[];
  tags?: string[];
  excludedTags?: string[];
  tagMatch?: 'any' | 'all';
  tagPresence?: 'any' | 'tagged' | 'untagged';
  batchId?: string;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** Builds the querystring both `useInfiniteLeads` and `handleExport` send —
 * page/pageSize are appended separately by whichever caller needs them. */
export function buildLeadsQueryString(filters: LeadFilters): string {
  const qs = new URLSearchParams();
  if (filters.search) qs.set('search', filters.search);
  if (filters.statuses?.length) qs.set('statuses', filters.statuses.join(','));
  if (filters.outreachStatuses?.length)
    qs.set('outreachStatuses', filters.outreachStatuses.join(','));
  if (filters.owners?.length) qs.set('owners', filters.owners.join(','));
  if (filters.tags?.length) qs.set('tags', filters.tags.join(','));
  if (filters.excludedTags?.length) qs.set('excludedTags', filters.excludedTags.join(','));
  if (filters.tagMatch && filters.tagMatch !== 'any') qs.set('tagMatch', filters.tagMatch);
  if (filters.tagPresence && filters.tagPresence !== 'any')
    qs.set('tagPresence', filters.tagPresence);
  if (filters.batchId) qs.set('batchId', filters.batchId);
  if (filters.createdFrom) qs.set('createdFrom', filters.createdFrom);
  if (filters.createdTo) qs.set('createdTo', filters.createdTo);
  if (filters.sortBy) qs.set('sortBy', filters.sortBy);
  if (filters.sortOrder) qs.set('sortOrder', filters.sortOrder);
  return qs.toString();
}
