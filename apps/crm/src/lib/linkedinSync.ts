import type { LinkedInConversationMessage, LinkedInConversationSummary } from './linkedinExport.js';

export interface LinkedInMessageDelta extends LinkedInConversationMessage {
  externalMessageKey: string;
}

export interface LinkedInMessageJobPayload {
  conversationId: string;
  otherPartyName: string;
  otherPartyProfileUrl: string | null;
  ownerProfileUrl: string;
  messages: LinkedInMessageDelta[];
  fullConversationMessageCount: number;
  fullConversationExcerpt: LinkedInConversationMessage[];
}

export interface LinkedInMessageClassification {
  skarionRelated: boolean;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

export async function linkedinMessageKey(
  conversationId: string,
  message: LinkedInConversationMessage
): Promise<string> {
  return sha256(
    [
      conversationId,
      message.sentAt,
      message.direction,
      message.senderProfileUrl ?? '',
      message.senderName,
      message.subject,
      message.content,
    ].join('\u001f')
  );
}

export function shouldClassifyUnmatchedConversation(
  conversation: Pick<LinkedInConversationSummary, 'messages'>
): boolean {
  if (conversation.messages.length >= 4) return true;
  const text = conversation.messages
    .map((message) => `${message.subject} ${message.content}`)
    .join(' ')
    .toLowerCase();
  return /\b(skarion|career|job search|resume|interview|application|recruiter|meeting invite|our team)\b/.test(
    text
  );
}

export function linkedinConversationHasReply(
  messages: Array<Pick<LinkedInConversationMessage, 'direction'>>
): boolean {
  return messages.some((message) => message.direction === 'inbound');
}

export function sanitizeLinkedInMessageClassification(
  value: unknown
): LinkedInMessageClassification | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.skarionRelated !== 'boolean') return null;
  const confidence =
    candidate.confidence === 'high' ||
    candidate.confidence === 'medium' ||
    candidate.confidence === 'low'
      ? candidate.confidence
      : 'low';
  return {
    skarionRelated: candidate.skarionRelated,
    confidence,
    rationale:
      typeof candidate.rationale === 'string'
        ? candidate.rationale.slice(0, 1000)
        : 'Classified by the LinkedIn Message Updater.',
  };
}

export function linkedinMessageClassificationPrompt(payload: LinkedInMessageJobPayload): string {
  const transcript = payload.fullConversationExcerpt
    .slice(-30)
    .map(
      (message) =>
        `[${message.sentAt}] ${message.direction.toUpperCase()} ${message.senderName}: ${message.content.slice(
          0,
          1500
        )}`
    )
    .join('\n');
  return `Decide whether this LinkedIn conversation is related to Skarion's work.

Skarion-related includes career support, candidate outreach, job-search help,
resume or LinkedIn positioning, applications, interview preparation, market
advice, recruiter outreach, service discussions, onboarding, or scheduling a
meeting about those services. Ignore personal networking, friendships, sales
pitches to us, generic congratulations, and unrelated chats.

Return JSON only:
{"skarionRelated":true|false,"confidence":"high|medium|low","rationale":"short reason"}

Other party: ${payload.otherPartyName}
Profile: ${payload.otherPartyProfileUrl ?? 'unknown'}
Transcript:
${transcript}`;
}

export function invitationExternalKey(profileUrl: string, action: 'pending' | 'accepted'): string {
  return `${action}:${profileUrl}`;
}
