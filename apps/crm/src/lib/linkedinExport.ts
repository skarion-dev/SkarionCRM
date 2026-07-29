import { canonicalizeLinkedinUrl } from './leadDedup.js';

export type LinkedInExportRow = Record<string, unknown>;

export interface LinkedInConversationMessage {
  sentAt: string;
  direction: 'outbound' | 'inbound';
  senderName: string;
  senderProfileUrl: string | null;
  content: string;
  subject: string;
}

export interface LinkedInConversationSummary {
  conversationId: string;
  otherPartyName: string;
  otherPartyProfileUrl: string | null;
  lastMessageAt: Date;
  lastMessageFromUs: boolean;
  outboundCount: number;
  messages: LinkedInConversationMessage[];
}

export interface LinkedInInvitationSummary {
  otherPartyName: string;
  otherPartyProfileUrl: string;
  sentAt: Date;
}

export function spreadsheetRowsToRecords(rows: unknown[][]): LinkedInExportRow[] {
  const headerIndex = rows.findIndex((row) =>
    row.some((value) => value !== null && value !== undefined && String(value).trim())
  );
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex]!.map((value) =>
    value === null || value === undefined ? '' : String(value).trim()
  );
  return rows
    .slice(headerIndex + 1)
    .filter((row) =>
      row.some((value) => value !== null && value !== undefined && String(value).trim())
    )
    .map((row) =>
      Object.fromEntries(
        headers
          .map((header, index) => {
            const value = row[index];
            return [
              header,
              value instanceof Date
                ? value.toISOString()
                : value === null || value === undefined
                  ? ''
                  : value,
            ] as const;
          })
          .filter(([header]) => Boolean(header))
      )
    );
}

function normalizedKey(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function rowValue(row: LinkedInExportRow, aliases: string[]): string {
  const wanted = new Set(aliases.map(normalizedKey));
  for (const [key, value] of Object.entries(row)) {
    if (!wanted.has(normalizedKey(key)) || value === null || value === undefined) continue;
    return String(value).trim();
  }
  return '';
}

function splitProfileUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s,;"]+/gi) ?? [];
  return matches
    .map((url) => canonicalizeLinkedinUrl(url))
    .filter((url): url is string => Boolean(url));
}

function splitNames(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function detectLinkedInExportKind(
  rows: LinkedInExportRow[]
): 'messages' | 'invitations' | null {
  const sample = rows.find((row) => Object.keys(row).length > 0);
  if (!sample) return null;
  const keys = new Set(Object.keys(sample).map(normalizedKey));
  if (keys.has('conversationid') && keys.has('senderprofileurl')) return 'messages';
  if (keys.has('direction') && (keys.has('inviteeprofileurl') || keys.has('inviterprofileurl'))) {
    return 'invitations';
  }
  return null;
}

export function inferLinkedInOwnerProfileUrl(rows: LinkedInExportRow[]): string | null {
  const conversationsByUrl = new Map<string, Set<string>>();
  const occurrences = new Map<string, number>();

  rows.forEach((row, index) => {
    const conversationId = rowValue(row, ['CONVERSATION ID']) || `row-${index}`;
    const urls = [
      canonicalizeLinkedinUrl(rowValue(row, ['SENDER PROFILE URL'])),
      ...splitProfileUrls(rowValue(row, ['RECIPIENT PROFILE URLS'])),
    ].filter((url): url is string => Boolean(url));
    for (const url of new Set(urls)) {
      const conversations = conversationsByUrl.get(url) ?? new Set<string>();
      conversations.add(conversationId);
      conversationsByUrl.set(url, conversations);
      occurrences.set(url, (occurrences.get(url) ?? 0) + 1);
    }
  });

  const ranked = [...conversationsByUrl.keys()].sort((left, right) => {
    const conversationDifference =
      (conversationsByUrl.get(right)?.size ?? 0) - (conversationsByUrl.get(left)?.size ?? 0);
    if (conversationDifference !== 0) return conversationDifference;
    return (occurrences.get(right) ?? 0) - (occurrences.get(left) ?? 0);
  });
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best) return null;
  if (
    runnerUp &&
    conversationsByUrl.get(best)?.size === conversationsByUrl.get(runnerUp)?.size &&
    occurrences.get(best) === occurrences.get(runnerUp)
  ) {
    return null;
  }
  return best;
}

export function summarizeLinkedInConversations(
  rows: LinkedInExportRow[],
  suppliedOwnerProfileUrl?: string | null
): {
  ownerProfileUrl: string | null;
  conversations: LinkedInConversationSummary[];
  skippedRows: number;
} {
  const ownerProfileUrl =
    canonicalizeLinkedinUrl(suppliedOwnerProfileUrl) ?? inferLinkedInOwnerProfileUrl(rows);
  if (!ownerProfileUrl)
    return { ownerProfileUrl: null, conversations: [], skippedRows: rows.length };

  const grouped = new Map<string, LinkedInExportRow[]>();
  const ownerNames = new Set(
    rows
      .filter(
        (row) => canonicalizeLinkedinUrl(rowValue(row, ['SENDER PROFILE URL'])) === ownerProfileUrl
      )
      .map((row) => rowValue(row, ['FROM']).toLowerCase())
      .filter(Boolean)
  );
  let skippedRows = 0;
  for (const row of rows) {
    const conversationId = rowValue(row, ['CONVERSATION ID']);
    if (!conversationId) {
      skippedRows += 1;
      continue;
    }
    const group = grouped.get(conversationId) ?? [];
    group.push(row);
    grouped.set(conversationId, group);
  }

  const conversations: LinkedInConversationSummary[] = [];
  for (const [conversationId, conversationRows] of grouped) {
    const knownOtherParty = conversationRows
      .flatMap((row) => {
        const senderProfileUrl = canonicalizeLinkedinUrl(rowValue(row, ['SENDER PROFILE URL']));
        const recipientProfileUrls = splitProfileUrls(rowValue(row, ['RECIPIENT PROFILE URLS']));
        const candidates: Array<{ profileUrl: string; name: string }> = [];
        if (senderProfileUrl && senderProfileUrl !== ownerProfileUrl) {
          candidates.push({
            profileUrl: senderProfileUrl,
            name: rowValue(row, ['FROM']),
          });
        }
        const recipientNames = splitNames(rowValue(row, ['TO']));
        recipientProfileUrls.forEach((profileUrl, index) => {
          if (profileUrl !== ownerProfileUrl) {
            candidates.push({
              profileUrl,
              name: recipientNames[index] ?? recipientNames[0] ?? '',
            });
          }
        });
        return candidates;
      })
      .find(({ profileUrl }) => profileUrl !== ownerProfileUrl);
    let invalidRows = 0;
    const parsed = conversationRows
      .map((row) => {
        const sentAt = new Date(rowValue(row, ['DATE']));
        const senderName = rowValue(row, ['FROM']);
        const senderProfileUrl = canonicalizeLinkedinUrl(rowValue(row, ['SENDER PROFILE URL']));
        const recipientProfileUrls = splitProfileUrls(rowValue(row, ['RECIPIENT PROFILE URLS']));
        if (!Number.isFinite(sentAt.getTime())) {
          invalidRows += 1;
          return null;
        }

        const outbound =
          senderProfileUrl === ownerProfileUrl ||
          (!senderProfileUrl && ownerNames.has(senderName.toLowerCase()));
        const otherPartyProfileUrl = outbound
          ? (recipientProfileUrls.find((url) => url !== ownerProfileUrl) ??
            knownOtherParty?.profileUrl ??
            null)
          : (senderProfileUrl ?? knownOtherParty?.profileUrl ?? null);
        const otherPartyName = outbound
          ? (splitNames(rowValue(row, ['TO']))[0] ?? knownOtherParty?.name ?? '')
          : senderName || knownOtherParty?.name || '';

        return {
          sentAt,
          outbound,
          otherPartyProfileUrl,
          otherPartyName,
          message: {
            sentAt: sentAt.toISOString(),
            direction: outbound ? ('outbound' as const) : ('inbound' as const),
            senderName,
            senderProfileUrl,
            content: rowValue(row, ['CONTENT']).slice(0, 20_000),
            subject: rowValue(row, ['SUBJECT']).slice(0, 1_000),
          },
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime());

    skippedRows += invalidRows;
    const last = parsed[parsed.length - 1];
    const firstWithName = parsed.find((row) => row.otherPartyName);
    if (!last) continue;

    conversations.push({
      conversationId,
      otherPartyName: firstWithName?.otherPartyName || 'LinkedIn member',
      otherPartyProfileUrl: last.otherPartyProfileUrl ?? knownOtherParty?.profileUrl ?? null,
      lastMessageAt: last.sentAt,
      lastMessageFromUs: last.outbound,
      outboundCount: parsed.filter((row) => row.outbound).length,
      messages: parsed.map((row) => row.message),
    });
  }

  return { ownerProfileUrl, conversations, skippedRows };
}

export function summarizeLinkedInInvitations(rows: LinkedInExportRow[]): {
  invitations: LinkedInInvitationSummary[];
  skippedRows: number;
} {
  const invitations: LinkedInInvitationSummary[] = [];
  let skippedRows = 0;
  for (const row of rows) {
    if (rowValue(row, ['Direction']).toUpperCase() !== 'OUTGOING') continue;
    const otherPartyProfileUrl = canonicalizeLinkedinUrl(rowValue(row, ['inviteeProfileUrl']));
    const sentAt = new Date(rowValue(row, ['Sent At']));
    if (!otherPartyProfileUrl || !Number.isFinite(sentAt.getTime())) {
      skippedRows += 1;
      continue;
    }
    invitations.push({
      otherPartyName: rowValue(row, ['To']) || 'LinkedIn member',
      otherPartyProfileUrl,
      sentAt,
    });
  }
  return { invitations, skippedRows };
}

export function splitLinkedInDisplayName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
}
