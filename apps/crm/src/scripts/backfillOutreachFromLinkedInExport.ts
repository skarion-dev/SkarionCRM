// apps/crm/src/scripts/backfillOutreachFromLinkedInExport.ts
//
// One-time reconciliation: most leads' crm.lead_channels.lastAttemptAt/
// attemptCount are blank because nothing except a teammate manually
// clicking "log outreach" in the CRM UI ever sets them (see
// POST /api/leads/:id/outreach-actions in index.ts). The owner's own
// LinkedIn data export is real ground truth for "did we actually message
// this person, and did they reply" — this script imports that ground truth
// so the outreach-stale sequence (evaluateOutreachSequence in
// apps/workers/workflow-runner) starts from accurate data instead of
// treating every lead as if it were created and never touched.
//
// This is a script, not a migration: it reconciles live production data
// against an external file, matched against whichever leads exist in the
// database at the moment it's run — re-run it any time you have a fresher
// export.
//
// Usage:
//   DATABASE_URL=postgres://... tsx apps/crm/src/scripts/backfillOutreachFromLinkedInExport.ts \
//     --messages="/path/to/messages.csv" --invitations="/path/to/Invitations.csv" \
//     --owner-url="https://www.linkedin.com/in/yourprofile"

import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, and, isNull, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { canonicalizeLinkedinUrl } from '../lib/leadDedup.js';
import type { CrmDb } from '../db/types.js';

interface ConversationSummary {
  otherPartyUrl: string;
  lastMessageAt: Date;
  lastMessageFromUs: boolean;
  outboundCount: number;
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function parseCsv(path: string): Record<string, string>[] {
  const content = readFileSync(path, 'utf-8');
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  });
  return result.data;
}

/** Groups messages.csv rows by CONVERSATION ID and reduces each thread down
 * to just what the sequence needs: who the other party is, when the last
 * message went out, who sent it, and how many outbound messages there were
 * (used as attemptCount). */
function summarizeConversations(
  rows: Record<string, string>[],
  ownProfileUrl: string
): Map<string, ConversationSummary> {
  const byConversation = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const id = row['CONVERSATION ID'];
    if (!id) continue;
    const list = byConversation.get(id) ?? [];
    list.push(row);
    byConversation.set(id, list);
  }

  const summaries = new Map<string, ConversationSummary>();
  for (const [id, msgs] of byConversation) {
    msgs.sort((a, b) => new Date(a.DATE ?? 0).getTime() - new Date(b.DATE ?? 0).getTime());

    const otherPartyUrl = msgs
      .map((m) =>
        m['SENDER PROFILE URL'] === ownProfileUrl
          ? m['RECIPIENT PROFILE URLS']
          : m['SENDER PROFILE URL']
      )
      .find((url) => url && url !== ownProfileUrl);
    if (!otherPartyUrl) continue;

    const last = msgs[msgs.length - 1];
    if (!last) continue;
    const lastMessageFromUs = last['SENDER PROFILE URL'] === ownProfileUrl;
    const outboundCount = msgs.filter((m) => m['SENDER PROFILE URL'] === ownProfileUrl).length;

    summaries.set(id, {
      otherPartyUrl: otherPartyUrl.split('?')[0] ?? otherPartyUrl,
      lastMessageAt: new Date(last.DATE ?? 0),
      lastMessageFromUs,
      outboundCount,
    });
  }
  return summaries;
}

/** Outgoing invitations still pending as of the export (accepted ones move
 * to Connections.csv and disappear from Invitations.csv entirely, so
 * "present here" already means "not yet accepted"). */
function summarizeOutgoingInvitations(rows: Record<string, string>[]): Map<string, Date> {
  const result = new Map<string, Date>();
  for (const row of rows) {
    if (row.Direction !== 'OUTGOING') continue;
    const url = row.inviteeProfileUrl;
    const sentAt = row['Sent At'];
    if (!url || !sentAt) continue;
    result.set(url, new Date(sentAt));
  }
  return result;
}

async function upsertLinkedinChannel(
  db: CrmDb,
  leadId: string,
  ownerId: string,
  patch: {
    stage: 'awaiting_reply' | 'replied' | 'connection_request_sent';
    lastAttemptAt: Date;
    attemptCount: number;
  }
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.leadChannels)
    .where(
      and(eq(schema.leadChannels.leadId, leadId), eq(schema.leadChannels.channel, 'linkedin'))
    );

  if (existing) {
    await db
      .update(schema.leadChannels)
      .set({
        stage: patch.stage,
        lastAttemptAt: patch.lastAttemptAt,
        attemptCount: patch.attemptCount,
        updatedAt: new Date(),
      })
      .where(eq(schema.leadChannels.id, existing.id));
  } else {
    await db.insert(schema.leadChannels).values({
      leadId,
      channel: 'linkedin',
      stage: patch.stage,
      lastAttemptAt: patch.lastAttemptAt,
      attemptCount: patch.attemptCount,
      sequence: 1,
      ownerId,
    });
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Set DATABASE_URL before running this script.');
    process.exit(1);
  }
  const messagesPath = getArg('messages');
  const invitationsPath = getArg('invitations');
  const ownProfileUrl = getArg('owner-url');
  if (!messagesPath || !invitationsPath || !ownProfileUrl) {
    console.error(
      'Usage: tsx backfillOutreachFromLinkedInExport.ts --messages=<path> --invitations=<path> --owner-url=<your linkedin profile url>'
    );
    process.exit(1);
  }

  const sqlClient = neon(databaseUrl);
  const db = drizzle(sqlClient, { schema }) as unknown as CrmDb;

  const conversations = summarizeConversations(parseCsv(messagesPath), ownProfileUrl);
  const invitations = summarizeOutgoingInvitations(parseCsv(invitationsPath));

  let matchedFromMessages = 0;
  let flaggedAsReplied = 0;
  let matchedFromInvitations = 0;
  let unmatched = 0;
  const handledCanonicalUrls = new Set<string>();

  for (const convo of conversations.values()) {
    const canonical = canonicalizeLinkedinUrl(convo.otherPartyUrl);
    if (!canonical) continue;

    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(
        and(eq(sql`lower(${schema.leads.linkedinUrl})`, canonical), isNull(schema.leads.deletedAt))
      );
    if (!lead) {
      unmatched++;
      continue;
    }

    if (convo.lastMessageFromUs) {
      await upsertLinkedinChannel(db, lead.id, lead.ownerId, {
        stage: 'awaiting_reply',
        lastAttemptAt: convo.lastMessageAt,
        attemptCount: convo.outboundCount,
      });
      matchedFromMessages++;
    } else {
      // They replied last and we haven't answered — a different problem
      // than "gone stale", so mark it replied rather than letting the
      // sequence flag it for a follow-up nudge.
      await upsertLinkedinChannel(db, lead.id, lead.ownerId, {
        stage: 'replied',
        lastAttemptAt: convo.lastMessageAt,
        attemptCount: convo.outboundCount,
      });
      flaggedAsReplied++;
    }
    handledCanonicalUrls.add(canonical);
  }

  for (const [profileUrl, sentAt] of invitations) {
    const canonical = canonicalizeLinkedinUrl(profileUrl);
    // A message thread is a stronger signal than a still-pending invite —
    // don't let an old invitation override what the conversation already set.
    if (!canonical || handledCanonicalUrls.has(canonical)) continue;

    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(
        and(eq(sql`lower(${schema.leads.linkedinUrl})`, canonical), isNull(schema.leads.deletedAt))
      );
    if (!lead) {
      unmatched++;
      continue;
    }

    await upsertLinkedinChannel(db, lead.id, lead.ownerId, {
      stage: 'connection_request_sent',
      lastAttemptAt: sentAt,
      attemptCount: 1,
    });
    matchedFromInvitations++;
    handledCanonicalUrls.add(canonical);
  }

  console.log('Backfill complete.');
  console.log(`  Matched from message threads (awaiting reply): ${matchedFromMessages}`);
  console.log(
    `  Matched from message threads (they replied, flagged 'replied'): ${flaggedAsReplied}`
  );
  console.log(`  Matched from pending invitations: ${matchedFromInvitations}`);
  console.log(`  Unmatched (no lead with that LinkedIn URL exists yet): ${unmatched}`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
