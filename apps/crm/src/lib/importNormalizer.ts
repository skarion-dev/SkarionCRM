/* eslint-disable */
// @ts-nocheck
// src/services/importNormalizer.ts
// Universal import normalizer ported from TalentOS to Skarion CRM.
// Handles CSV/TSV/JSON detection, parsing, field mapping, cleaning, and deduplication.

import Papa from 'papaparse';

export type DetectedFormat = 'csv' | 'tsv' | 'json';

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
  headersDetected: boolean;
}

export interface FieldMapping {
  [header: string]: string | null; // header -> schema field or null for ignore
}

// ============================================================================
// FORMAT DETECTION
// ============================================================================

export function detectFormat(filename: string, content: string): DetectedFormat {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'json') return 'json';
  if (ext === 'tsv') return 'tsv';
  if (ext === 'csv') return 'csv';

  const trimmed = content.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json';

  const firstLine = trimmed.split(/\r?\n/)[0] ?? '';
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  return tabCount > commaCount ? 'tsv' : 'csv';
}

// ============================================================================
// FILE PARSING
// ============================================================================

export function parseFile(
  format: DetectedFormat,
  content: string
): ParsedTable {
  switch (format) {
    case 'csv':
      return parseDelimited(content, ',');
    case 'tsv':
      return parseDelimited(content, '\t');
    case 'json':
      return parseJson(content);
  }
}

const HEADER_LABELS = new Set(
  [
    'title',
    'job title',
    'position',
    'role',
    'job_title',
    'posting title',
    'company',
    'employer',
    'company name',
    'organization',
    'companyname',
    'location',
    'city',
    'job location',
    'joblocation',
    'url',
    'link',
    'job url',
    'posting url',
    'source_url',
    'apply url',
    'posted',
    'date posted',
    'posted_at',
    'publish date',
    'postedat',
    'salary',
    'salary range',
    'comp',
    'compensation',
    'tier',
    'role tier',
    'category',
    'notes',
    'comment',
    'comments',
    'description',
    'full name',
    'fullname',
    'name',
    'email',
    'phone',
    'type',
    'tax id',
    'taxid',
    'invoice number',
    'invoice_number',
    'invoicenumber',
    'issue date',
    'issue_date',
    'due date',
    'due_date',
    'total amount',
    'total_amount',
    'totalamount',
    'amount',
    'transaction date',
    'transaction_date',
    'transactiondate',
    'account id',
    'account_id',
    'accountid',
    'transaction type',
    'transaction_type',
  ].map(normalizeHeaderLabel)
);

function normalizeHeaderLabel(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function looksLikeDataCell(cell: string): boolean {
  const t = cell.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^\d+([.,]\d+)?$/.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) return true;
  if (/@/.test(t)) return true;
  return false;
}

function rowLooksLikeHeader(row: string[]): boolean {
  if (row.length === 0) return false;
  const dataLike = row.filter(looksLikeDataCell).length;
  const labelLike = row.filter((cell) =>
    HEADER_LABELS.has(normalizeHeaderLabel(cell))
  ).length;
  return dataLike / row.length < 0.5 && labelLike > 0;
}

function parseDelimited(content: string, delimiter: ',' | '\t'): ParsedTable {
  const result = Papa.parse<string[]>(content.trim(), {
    delimiter,
    skipEmptyLines: true,
  });
  const rows = (result.data as string[][]).filter((r) => r.length > 0);
  if (rows.length === 0) return { headers: [], rows: [], headersDetected: false };

  const headersDetected = rowLooksLikeHeader(rows[0]);
  const headers = headersDetected
    ? rows[0]
    : rows[0].map((_, i) => `col_${i}`);
  const dataRows = headersDetected ? rows.slice(1) : rows;

  const objRows = dataRows.map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] ?? '';
    });
    return obj;
  });

  return { headers, rows: objRows, headersDetected };
}

function parseJson(content: string): ParsedTable {
  const data = JSON.parse(content);
  const arr = Array.isArray(data) ? data : [data];
  const headerSet = new Set<string>();
  arr.forEach((row) => Object.keys(row ?? {}).forEach((k) => headerSet.add(k)));
  const headers = Array.from(headerSet);

  const rows = arr.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h) => {
      const v = row?.[h];
      obj[h] =
        v === null || v === undefined
          ? ''
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v);
    });
    return obj;
  });

  return { headers, rows, headersDetected: true };
}

// ============================================================================
// FIELD MAPPING
// ============================================================================

const ENTITY_SCHEMAS: Record<string, Record<string, string[]>> = {
  contacts: {
    fullName: [
      'full name',
      'fullname',
      'name',
      'contact name',
      'contact_name',
    ],
    email: ['email', 'e-mail', 'email address', 'emailaddress', 'mail'],
    phone: ['phone', 'phone number', 'phonenumber', 'tel', 'telephone', 'mobile'],
    type: ['type', 'contact type', 'contact_type', 'contacttype', 'category'],
    companyName: [
      'company',
      'company name',
      'companyname',
      'organization',
      'employer',
      'business name',
    ],
    taxId: ['tax id', 'taxid', 'tax_id', 'ein', 'tin', 'vat'],
    address: [
      'address',
      'street',
      'street address',
      'mailing address',
      'billing address',
      'shipping address',
    ],
    notes: ['notes', 'note', 'comments', 'comment', 'description', 'remarks'],
  },
  invoices: {
    invoiceNumber: [
      'invoice number',
      'invoice_number',
      'invoicenumber',
      'invoice #',
      'inv #',
      'inv number',
      'number',
    ],
    contactId: [
      'contact id',
      'contact_id',
      'contactid',
      'customer id',
      'customer_id',
      'client id',
      'client_id',
    ],
    issueDate: [
      'issue date',
      'issue_date',
      'issuedate',
      'date',
      'invoice date',
      'invoice_date',
      'created date',
    ],
    dueDate: [
      'due date',
      'due_date',
      'duedate',
      'payment due',
      'due',
    ],
    totalAmount: [
      'total amount',
      'total_amount',
      'totalamount',
      'amount',
      'total',
      'invoice total',
      'sum',
      'grand total',
    ],
    status: ['status', 'invoice status', 'invoice_status', 'state'],
  },
  transactions: {
    description: ['description', 'desc', 'memo', 'note', 'details', 'narration'],
    amount: ['amount', 'sum', 'total', 'value', 'debit', 'credit', 'payment amount'],
    transactionDate: [
      'transaction date',
      'transaction_date',
      'transactiondate',
      'date',
      'posting date',
      'post_date',
      'txn date',
    ],
    accountId: [
      'account id',
      'account_id',
      'accountid',
      'gl account',
      'chart of account',
      'coa id',
    ],
    transactionType: [
      'transaction type',
      'transaction_type',
      'transactiontype',
      'type',
      'txn type',
      'entry type',
    ],
  },
  employees: {
    fullName: [
      'full name',
      'fullname',
      'name',
      'employee name',
      'employee_name',
    ],
    email: ['email', 'e-mail', 'email address', 'work email'],
    phone: ['phone', 'phone number', 'phonenumber'],
    status: ['status', 'employee status', 'employee_status'],
    hireDate: ['hire date', 'hire_date', 'start date', 'employment date'],
    jobTitle: ['job title', 'job_title', 'title', 'position', 'role'],
    department: ['department', 'dept', 'division', 'team'],
    payRate: ['pay rate', 'pay_rate', 'salary', 'wage', 'hourly rate', 'compensation'],
    payType: ['pay type', 'pay_type', 'paytype', 'pay frequency', 'frequency'],
    address: ['address', 'street address'],
    taxId: ['tax id', 'taxid', 'ssn', 'social security', 'ein'],
    notes: ['notes', 'comments', 'remarks'],
  },
  chart_of_accounts: {
    code: ['code', 'account code', 'account_code', 'gl code', 'number', 'acct #'],
    name: ['name', 'account name', 'account_name', 'description'],
    accountType: [
      'account type',
      'account_type',
      'accounttype',
      'type',
      'category',
    ],
    accountSubtype: [
      'account subtype',
      'account_subtype',
      'subtype',
      'subcategory',
    ],
    parentId: ['parent id', 'parent_id', 'parentid', 'parent'],
    description: ['description', 'desc', 'notes'],
  },
};

const FUZZY_THRESHOLD = 0.75;

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function detectEntityType(headers: string[]): string {
  const normalizedHeaders = headers.map(normalizeHeader);
  const scores: Record<string, number> = {
    contacts: 0,
    invoices: 0,
    transactions: 0,
    employees: 0,
    chart_of_accounts: 0,
  };

  for (const h of normalizedHeaders) {
    if (ENTITY_SCHEMAS.contacts.fullName.some((s) => normalizeHeader(s) === h))
      scores.contacts++;
    if (
      ENTITY_SCHEMAS.invoices.invoiceNumber.some((s) => normalizeHeader(s) === h)
    )
      scores.invoices++;
    if (
      ENTITY_SCHEMAS.transactions.description.some(
        (s) => normalizeHeader(s) === h
      )
    )
      scores.transactions++;
    if (
      ENTITY_SCHEMAS.employees.fullName.some((s) => normalizeHeader(s) === h)
    )
      scores.employees++;
    if (
      ENTITY_SCHEMAS.chart_of_accounts.code.some((s) => normalizeHeader(s) === h)
    )
      scores.chart_of_accounts++;
  }

  let bestType = 'contacts';
  let bestScore = -1;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }
  return bestType;
}

export function mapFields(
  headers: string[],
  _sampleRows: Record<string, string>[]
): FieldMapping {
  const entityType = detectEntityType(headers);
  const schema = ENTITY_SCHEMAS[entityType] || {};

  const mapping: FieldMapping = {};
  const usedHeaders = new Set<string>();
  const normalizedHeaders = headers.map((h) => ({
    original: h,
    normalized: normalizeHeader(h),
  }));

  for (const [field, synonyms] of Object.entries(schema)) {
    const normalizedSynonyms = synonyms.map(normalizeHeader);

    let best = normalizedHeaders.find(
      (h) =>
        !usedHeaders.has(h.original) && normalizedSynonyms.includes(h.normalized)
    );

    if (!best) {
      let bestScore = 0;
      for (const h of normalizedHeaders) {
        if (usedHeaders.has(h.original)) continue;
        for (const syn of normalizedSynonyms) {
          const score = similarity(h.normalized, syn);
          if (score > bestScore) {
            bestScore = score;
            best = h;
          }
        }
      }
      if (bestScore < FUZZY_THRESHOLD) best = undefined;
    }

    if (best) {
      mapping[best.original] = field;
      usedHeaders.add(best.original);
    }
  }

  for (const h of headers) {
    if (!usedHeaders.has(h)) {
      mapping[h] = null;
    }
  }

  return mapping;
}

// ============================================================================
// DATA CLEANING
// ============================================================================

export function cleanRow(
  row: Record<string, string>,
  mapping: FieldMapping,
  entityType: string
): Record<string, any> {
  const mapped: Record<string, any> = {};
  for (const [header, value] of Object.entries(row)) {
    const schemaField = mapping[header];
    if (schemaField) {
      mapped[schemaField] = value;
    }
  }

  for (const key of Object.keys(mapped)) {
    if (typeof mapped[key] === 'string') {
      mapped[key] = mapped[key].trim();
      if (mapped[key] === '') mapped[key] = null;
    }
  }

  switch (entityType) {
    case 'contacts':
      return cleanContactRow(mapped);
    case 'invoices':
      return cleanInvoiceRow(mapped);
    case 'transactions':
      return cleanTransactionRow(mapped);
    case 'employees':
      return cleanEmployeeRow(mapped);
    case 'chart_of_accounts':
      return cleanChartOfAccountsRow(mapped);
    default:
      return mapped;
  }
}

function cleanContactRow(row: Record<string, any>): Record<string, any> {
  if (row.email) row.email = row.email.toLowerCase();
  if (row.type) row.type = normalizeContactType(row.type);
  if (row.address && typeof row.address === 'string') {
    row.address = parseAddressString(row.address);
  }
  return row;
}

function cleanInvoiceRow(row: Record<string, any>): Record<string, any> {
  if (row.issueDate) row.issueDate = parseDateLoose(row.issueDate);
  if (row.dueDate) row.dueDate = parseDateLoose(row.dueDate);
  if (row.totalAmount) row.totalAmount = parseDecimal(row.totalAmount);
  if (row.status) row.status = normalizeInvoiceStatus(row.status);
  return row;
}

function cleanTransactionRow(row: Record<string, any>): Record<string, any> {
  if (row.amount) row.amount = parseDecimal(row.amount);
  if (row.transactionDate) row.transactionDate = parseDateLoose(row.transactionDate);
  if (row.transactionType) row.transactionType = normalizeTransactionType(row.transactionType);
  return row;
}

function cleanEmployeeRow(row: Record<string, any>): Record<string, any> {
  if (row.hireDate) row.hireDate = parseDateLoose(row.hireDate);
  if (row.payRate) row.payRate = parseDecimal(row.payRate);
  if (row.status) row.status = normalizeEmployeeStatus(row.status);
  if (row.address && typeof row.address === 'string') {
    row.address = parseAddressString(row.address);
  }
  return row;
}

function cleanChartOfAccountsRow(row: Record<string, any>): Record<string, any> {
  if (row.accountType) row.accountType = normalizeAccountType(row.accountType);
  return row;
}

// Normalization helpers

const CONTACT_TYPE_SYNONYMS: Record<string, string> = {
  client: 'client',
  customer: 'client',
  vendor: 'vendor',
  supplier: 'vendor',
  employee: 'employee',
  staff: 'employee',
  contractor: 'contractor',
  freelancer: 'contractor',
  prospect: 'prospect',
  lead: 'prospect',
  partner: 'partner',
  affiliate: 'partner',
};

const INVOICE_STATUS_SYNONYMS: Record<string, string> = {
  draft: 'draft',
  sent: 'sent',
  viewed: 'viewed',
  paid: 'paid',
  partially_paid: 'partially_paid',
  'partially paid': 'partially_paid',
  partial: 'partially_paid',
  overdue: 'overdue',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  refunded: 'refunded',
  refund: 'refunded',
};

const TRANSACTION_TYPE_SYNONYMS: Record<string, string> = {
  deposit: 'deposit',
  credit: 'deposit',
  withdrawal: 'withdrawal',
  debit: 'withdrawal',
  transfer: 'transfer',
  adjustment: 'adjustment',
  'journal entry': 'journal_entry',
  journal_entry: 'journal_entry',
};

const EMPLOYEE_STATUS_SYNONYMS: Record<string, string> = {
  active: 'active',
  inactive: 'inactive',
  terminated: 'inactive',
  archived: 'archived',
  on_leave: 'inactive',
  'on leave': 'inactive',
  suspended: 'inactive',
};

const ACCOUNT_TYPE_SYNONYMS: Record<string, string> = {
  asset: 'asset',
  liability: 'liability',
  equity: 'equity',
  revenue: 'revenue',
  income: 'revenue',
  expense: 'expense',
  cost: 'expense',
};

function normalizeContactType(v: string): string | null {
  const t = v.trim().toLowerCase();
  return CONTACT_TYPE_SYNONYMS[t] ?? null;
}

function normalizeInvoiceStatus(v: string): string | null {
  const t = v.trim().toLowerCase();
  return INVOICE_STATUS_SYNONYMS[t] ?? null;
}

function normalizeTransactionType(v: string): string | null {
  const t = v.trim().toLowerCase();
  return TRANSACTION_TYPE_SYNONYMS[t] ?? null;
}

function normalizeEmployeeStatus(v: string): string | null {
  const t = v.trim().toLowerCase();
  return EMPLOYEE_STATUS_SYNONYMS[t] ?? null;
}

function normalizeAccountType(v: string): string | null {
  const t = v.trim().toLowerCase();
  return ACCOUNT_TYPE_SYNONYMS[t] ?? null;
}

function parseDateLoose(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = String(v).trim();
  if (!t) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);

  const mdMatch = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdMatch) {
    return `${mdMatch[3]}-${mdMatch[1].padStart(2, '0')}-${mdMatch[2].padStart(2, '0')}`;
  }

  const mdDashMatch = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdDashMatch) {
    return `${mdDashMatch[3]}-${mdDashMatch[1].padStart(2, '0')}-${mdDashMatch[2].padStart(2, '0')}`;
  }

  const parsed = new Date(t);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseDecimal(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = String(v)
    .trim()
    .replace(/[$,€£¥]/g, '')
    .replace(/\s+/g, '');
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? String(n) : null;
}

function parseAddressString(v: string): Record<string, any> {
  try {
    const parsed = JSON.parse(v);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch {
    // not JSON
  }
  const parts = v
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    street: parts[0] || null,
    city: parts[1] || null,
    state: parts[2] || null,
    zip: parts[3] || null,
    country: parts[4] || null,
  };
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

export function deduplicate(
  rows: any[],
  existingRecords: any[],
  keys: string[]
): { newRows: any[]; duplicates: any[] } {
  const newRows: any[] = [];
  const duplicates: any[] = [];

  for (const row of rows) {
    const isDuplicate = existingRecords.some((existing) => {
      return keys.every((key) => {
        const rowVal = row[key];
        const existingVal = existing[key];
        const a =
          rowVal === null || rowVal === undefined
            ? ''
            : String(rowVal).trim().toLowerCase();
        const b =
          existingVal === null || existingVal === undefined
            ? ''
            : String(existingVal).trim().toLowerCase();
        return a === b && a !== '';
      });
    });

    if (isDuplicate) {
      duplicates.push(row);
    } else {
      newRows.push(row);
    }
  }

  return { newRows, duplicates };
}

export function getDedupKeys(entityType: string): string[] {
  switch (entityType) {
    case 'contacts':
      return ['email'];
    case 'invoices':
      return ['invoiceNumber'];
    case 'transactions':
      return ['description', 'amount', 'transactionDate'];
    case 'employees':
      return ['email'];
    case 'chart_of_accounts':
      return ['code'];
    default:
      return ['id'];
  }
}
