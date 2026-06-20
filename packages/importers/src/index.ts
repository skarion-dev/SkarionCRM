export interface CsvRow {
  [key: string]: string | undefined;
}

export interface ImportResult<T> {
  success: T[];
  errors: { row: number; field: string; message: string }[];
  duplicates: { row: number; reason: string }[];
}

export interface ContactImportRow {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  title?: string;
  companyName?: string;
}

export interface CompanyImportRow {
  name: string;
  domain?: string;
  industry?: string;
  size?: string;
}

export interface LeadImportRow {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  companyName?: string;
  companyDomain?: string;
  source?: string;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]!.split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''));
    const row: CsvRow = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || undefined;
    });
    rows.push(row);
  }
  return rows;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function parseContactsCsv(csvText: string): ImportResult<ContactImportRow> {
  const rows = parseCsv(csvText);
  const result: ImportResult<ContactImportRow> = { success: [], errors: [], duplicates: [] };
  const seenEmails = new Set<string>();

  rows.forEach((row, idx) => {
    const email = row.email?.toLowerCase();
    if (!email || !isValidEmail(email)) {
      result.errors.push({ row: idx + 2, field: 'email', message: 'Invalid or missing email' });
      return;
    }
    if (seenEmails.has(email)) {
      result.duplicates.push({ row: idx + 2, reason: `Duplicate email: ${email}` });
      return;
    }
    seenEmails.add(email);
    const firstName = row.firstName || row['first name'] || row.first_name;
    const lastName = row.lastName || row['last name'] || row.last_name;
    if (!firstName || !lastName) {
      result.errors.push({ row: idx + 2, field: 'name', message: 'Missing first or last name' });
      return;
    }
    result.success.push({
      firstName,
      lastName,
      email,
      phone: row.phone,
      title: row.title,
      companyName: row.companyName || row.company || row['company name'],
    });
  });

  return result;
}

export function parseCompaniesCsv(csvText: string): ImportResult<CompanyImportRow> {
  const rows = parseCsv(csvText);
  const result: ImportResult<CompanyImportRow> = { success: [], errors: [], duplicates: [] };
  const seenDomains = new Set<string>();

  rows.forEach((row, idx) => {
    const name = row.name || row.company || row['company name'];
    if (!name) {
      result.errors.push({ row: idx + 2, field: 'name', message: 'Missing company name' });
      return;
    }
    const domain = row.domain?.toLowerCase();
    if (domain) {
      if (seenDomains.has(domain)) {
        result.duplicates.push({ row: idx + 2, reason: `Duplicate domain: ${domain}` });
        return;
      }
      seenDomains.add(domain);
    }
    result.success.push({ name, domain, industry: row.industry, size: row.size });
  });

  return result;
}

export function parseLeadsCsv(csvText: string): ImportResult<LeadImportRow> {
  const rows = parseCsv(csvText);
  const result: ImportResult<LeadImportRow> = { success: [], errors: [], duplicates: [] };
  const seenEmails = new Set<string>();

  rows.forEach((row, idx) => {
    const email = row.email?.toLowerCase();
    if (!email || !isValidEmail(email)) {
      result.errors.push({ row: idx + 2, field: 'email', message: 'Invalid or missing email' });
      return;
    }
    if (seenEmails.has(email)) {
      result.duplicates.push({ row: idx + 2, reason: `Duplicate email: ${email}` });
      return;
    }
    seenEmails.add(email);
    const firstName = row.firstName || row['first name'] || row.first_name;
    const lastName = row.lastName || row['last name'] || row.last_name;
    if (!firstName || !lastName) {
      result.errors.push({ row: idx + 2, field: 'name', message: 'Missing first or last name' });
      return;
    }
    result.success.push({
      firstName,
      lastName,
      email,
      phone: row.phone,
      companyName: row.companyName || row.company || row['company name'],
      companyDomain: row.companyDomain || row.domain || row['company domain'],
      source: row.source || row['lead source'] || 'other',
    });
  });

  return result;
}
