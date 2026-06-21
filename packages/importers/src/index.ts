export interface CsvRow {
  [key: string]: string | undefined;
}

export interface ImportResult<T> {
  success: T[];
  errors: { row: number; field: string; message: string }[];
  duplicates: { row: number; reason: string }[];
  warnings: { row: number; message: string }[];
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
  linkedinUrl?: string;
  title?: string;
  source?: string;
  status?: string;
  notes?: string;
  outreachStatus?: string;
  approachedAt?: string;
  connectionStatus?: string;
  sourceSheet?: string;
  originalRowNumber?: number;
  tags?: string[];
  emailIsPlaceholder?: boolean;
}

function parseCsv(text: string): CsvRow[] {
  // Simple but robust CSV parser that handles quoted commas and newlines
  const rows: CsvRow[] = [];
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentLine += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === '\n' && !inQuotes) {
      lines.push(currentLine);
      currentLine = '';
    } else if (char === '\r' && !inQuotes) {
      // Skip carriage return (Windows line endings)
      continue;
    } else {
      currentLine += char;
    }
  }
  if (currentLine) lines.push(currentLine);
  
  if (lines.length < 1) return [];
  
  const headers = parseCsvLine(lines[0]!).map((h) => h.trim().replace(/^["']|["']$/g, ''));
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]!);
    const row: CsvRow = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx]?.trim().replace(/^["']|["']$/g, '') || undefined;
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[_\s-]+/g, '').replace(/[^a-z0-9]/g, '');
}

function findColumn(row: CsvRow, aliases: string[]): string | undefined {
  const normalizedRow: Record<string, string | undefined> = {};
  for (const key of Object.keys(row)) {
    normalizedRow[normalizeHeader(key)] = row[key];
  }
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    if (normalizedAlias in normalizedRow) {
      return normalizedRow[normalizedAlias];
    }
  }
  return undefined;
}

export function parseContactsCsv(csvText: string): ImportResult<ContactImportRow> {
  const rows = parseCsv(csvText);
  const result: ImportResult<ContactImportRow> = { success: [], errors: [], duplicates: [], warnings: [] };
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
  const result: ImportResult<CompanyImportRow> = { success: [], errors: [], duplicates: [], warnings: [] };
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
  const result: ImportResult<LeadImportRow> = { success: [], errors: [], duplicates: [], warnings: [] };
  const seenEmails = new Set<string>();
  const seenLinkedIn = new Set<string>();
  const seenNameCompany = new Set<string>();

  const _nameAliases = ['fullname', 'name', 'firstname', 'firstname', 'last name', 'last name', 'first_name', 'last_name'];
  const emailAliases = ['email', 'emailaddress', 'email address', 'e-mail'];
  const companyAliases = ['company', 'companyname', 'company name', 'company', 'university', 'school'];
  const linkedInAliases = ['linkedin', 'linkedinurl', 'linkedin profile', 'profileurl', 'profile url', 'profilelink', 'linkedinlink', 'guessedlinkedinurl'];
  const titleAliases = ['title', 'position', 'jobtitle', 'job title', 'role', 'currentrole'];
  const phoneAliases = ['phone', 'phonenumber', 'phone number', 'mobile', 'tel'];
  const sourceAliases = ['source', 'leadsource', 'lead source', 'category', 'type'];
  const statusAliases = ['status', 'leadstatus', 'lead status', 'outreachstatus', 'outreach status'];
  const notesAliases = ['notes', 'comments', 'personalizednote', 'note', 'remarks'];
  const connectionAliases = ['connection', 'connectionstatus', 'connected', 'approached'];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;

    // Try to find name
    let firstName = findColumn(row, ['firstName', 'first name', 'first_name', 'firstName']);
    let lastName = findColumn(row, ['lastName', 'last name', 'last_name', 'lastName']);
    const fullName = findColumn(row, ['fullName', 'full name', 'fullname', 'name']);

    if (!firstName && !lastName && fullName) {
      // Split full name into first/last
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    // Try to find email
    let email = findColumn(row, emailAliases)?.toLowerCase().trim();
    let emailIsPlaceholder = false;

    if (!email || !isValidEmail(email)) {
      // Generate placeholder email if no valid email
      if (firstName || fullName) {
        const slug = (firstName || fullName || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
        email = `${slug}-${rowNum}@placeholder.skarion`;
        emailIsPlaceholder = true;
        result.warnings.push({ row: rowNum, message: 'No valid email; placeholder generated' });
      } else {
        result.errors.push({ row: rowNum, field: 'email', message: 'Missing email and no name to generate placeholder' });
        return;
      }
    }

    // Check for duplicate email
    if (seenEmails.has(email) && !emailIsPlaceholder) {
      result.duplicates.push({ row: rowNum, reason: `Duplicate email: ${email}` });
      return;
    }
    seenEmails.add(email);

    // Get LinkedIn URL
    let linkedinUrl = findColumn(row, linkedInAliases);
    if (linkedinUrl) {
      linkedinUrl = linkedinUrl.trim();
      if (!linkedinUrl.startsWith('http')) {
        linkedinUrl = `https://${linkedinUrl}`;
      }
      const normalizedLi = linkedinUrl.toLowerCase().replace(/\/+$/, '');
      if (seenLinkedIn.has(normalizedLi)) {
        result.duplicates.push({ row: rowNum, reason: `Duplicate LinkedIn: ${linkedinUrl}` });
        return;
      }
      seenLinkedIn.add(normalizedLi);
    }

    // Get company
    let companyName = findColumn(row, companyAliases);
    if (companyName) {
      companyName = companyName.replace(/\s*[\u00b7\u2022]\s*\d.*$/, '').trim();
    }

    // Get title
    let title = findColumn(row, titleAliases);
    if (title) {
      title = title.replace(/\s*[\u00b7\u2022]\s*\d.*$/, '').trim();
    }

    // Duplicate check by name + company
    const nameCompanyKey = `${(firstName || '').toLowerCase()}|${(lastName || '').toLowerCase()}|${(companyName || '').toLowerCase()}`;
    if (nameCompanyKey !== '||' && seenNameCompany.has(nameCompanyKey)) {
      result.duplicates.push({ row: rowNum, reason: `Duplicate name + company` });
      return;
    }
    if (nameCompanyKey !== '||') seenNameCompany.add(nameCompanyKey);

    // Get source/status
    const source = findColumn(row, sourceAliases) || 'other';
    const status = findColumn(row, statusAliases) || 'new';
    const notes = findColumn(row, notesAliases) || '';
    const connectionStatus = findColumn(row, connectionAliases) || '';

    // Determine outreach status from connection status or status
    let outreachStatus = 'not_approached';
    if (connectionStatus) {
      const cs = connectionStatus.toLowerCase();
      if (cs.includes('connected') || cs.includes('yes') || cs.includes('true') || cs.includes('1')) {
        outreachStatus = 'connected';
      } else if (cs.includes('approached') || cs.includes('contacted') || cs.includes('sent')) {
        outreachStatus = 'approached';
      } else if (cs.includes('replied') || cs.includes('responded')) {
        outreachStatus = 'replied';
      } else if (cs.includes('call') || cs.includes('booked') || cs.includes('meeting')) {
        outreachStatus = 'booked_call';
      } else if (cs.includes('not') || cs.includes('no') || cs.includes('false') || cs.includes('0')) {
        outreachStatus = 'not_interested';
      }
    }

    // Build notes from available fields
    const allNotes = notes;
    const headline = findColumn(row, ['headline', 'head line', 'summary', 'about']);
    const location = findColumn(row, ['location', 'city', 'country']);
    const education = findColumn(row, ['education', 'school', 'university', 'degree']);
    const industry = findColumn(row, ['industry', 'sector']);
    const profileUrl = findColumn(row, ['profileurl', 'profile url', 'profile_link', 'linkedin profile']);
    const score = findColumn(row, ['score', 'totalscore', 'total score', 'rating']);
    const googleSearch = findColumn(row, ['googlesearch', 'google search', 'searchurl']);

    const noteParts: string[] = [];
    if (headline) noteParts.push(`Headline: ${headline}`);
    if (location) noteParts.push(`Location: ${location}`);
    if (education) noteParts.push(`Education: ${education}`);
    if (industry) noteParts.push(`Industry: ${industry}`);
    if (profileUrl) noteParts.push(`Profile: ${profileUrl}`);
    if (score) noteParts.push(`Score: ${score}`);
    if (googleSearch) noteParts.push(`Search: ${googleSearch}`);
    if (allNotes) noteParts.push(`Notes: ${allNotes}`);

    const combinedNotes = noteParts.join('\n');

    result.success.push({
      firstName: firstName || '',
      lastName: lastName || '',
      email,
      emailIsPlaceholder,
      phone: findColumn(row, phoneAliases),
      companyName,
      companyDomain: findColumn(row, ['companydomain', 'company domain', 'domain', 'website']) || undefined,
      linkedinUrl: linkedinUrl || undefined,
      title,
      source: ['website', 'referral', 'social_media', 'cold_call', 'email_campaign', 'event', 'pdf_upload', 'other'].includes(source) ? source : 'other',
      status: ['new', 'contacted', 'qualified', 'disqualified', 'converted'].includes(status) ? status : 'new',
      notes: combinedNotes || undefined,
      outreachStatus,
      approachedAt: undefined,
      connectionStatus: connectionStatus || undefined,
      sourceSheet: undefined,
      originalRowNumber: rowNum,
      tags: undefined,
    });
  });

  return result;
}
