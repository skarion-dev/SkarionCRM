import { describe, expect, it } from 'vitest';
import {
  ensureLinkedInMessageKeys,
  invitationExternalKey,
  linkedinConversationHasReply,
  linkedinMessageKey,
  sanitizeLinkedInMessageClassification,
  shouldClassifyUnmatchedConversation,
} from './linkedinSync.js';

describe('linkedin sync helpers', () => {
  it('recovers deterministic message keys for legacy conversation imports', async () => {
    const message = {
      sentAt: '2026-07-28T12:00:00.000Z',
      direction: 'inbound' as const,
      senderName: 'Candidate',
      senderProfileUrl: 'https://www.linkedin.com/in/candidate',
      content: 'Thanks for reaching out.',
      subject: '',
    };
    const [recovered] = await ensureLinkedInMessageKeys('conversation-1', [message]);
    const [repeated] = await ensureLinkedInMessageKeys('conversation-1', [message]);
    expect(recovered?.externalMessageKey).toBeTruthy();
    expect(repeated?.externalMessageKey).toBe(recovered?.externalMessageKey);
  });

  it('creates stable message keys while distinguishing message content', async () => {
    const base = {
      sentAt: '2026-07-27T18:43:40.000Z',
      direction: 'outbound' as const,
      senderName: 'Abdullah Al Saki',
      senderProfileUrl: 'https://www.linkedin.com/in/alsaki',
      content: 'Career support message',
      subject: '',
    };
    await expect(linkedinMessageKey('conversation-1', base)).resolves.toBe(
      await linkedinMessageKey('conversation-1', { ...base })
    );
    await expect(linkedinMessageKey('conversation-1', base)).resolves.not.toBe(
      await linkedinMessageKey('conversation-1', { ...base, content: 'Different message' })
    );
  });

  it('only queues substantial or career-related unmatched conversations', () => {
    expect(
      shouldClassifyUnmatchedConversation({
        messages: Array.from({ length: 4 }, (_, index) => ({
          sentAt: new Date(index).toISOString(),
          direction: 'inbound' as const,
          senderName: 'Person',
          senderProfileUrl: null,
          content: 'hello',
          subject: '',
        })),
      })
    ).toBe(true);
    expect(
      shouldClassifyUnmatchedConversation({
        messages: [
          {
            sentAt: new Date().toISOString(),
            direction: 'inbound',
            senderName: 'Person',
            senderProfileUrl: null,
            content: 'Can your team help with my job search?',
            subject: '',
          },
        ],
      })
    ).toBe(true);
    expect(
      shouldClassifyUnmatchedConversation({
        messages: [
          {
            sentAt: new Date().toISOString(),
            direction: 'inbound',
            senderName: 'Person',
            senderProfileUrl: null,
            content: 'Happy birthday!',
            subject: '',
          },
        ],
      })
    ).toBe(false);
  });

  it('sanitizes classifier output and creates stable invitation actions', () => {
    expect(
      sanitizeLinkedInMessageClassification({
        skarionRelated: true,
        confidence: 'high',
        rationale: 'Career services discussion.',
      })
    ).toEqual({
      skarionRelated: true,
      confidence: 'high',
      rationale: 'Career services discussion.',
    });
    expect(sanitizeLinkedInMessageClassification({ skarionRelated: 'yes' })).toBeNull();
    expect(invitationExternalKey('https://linkedin.com/in/example', 'accepted')).toBe(
      'accepted:https://linkedin.com/in/example'
    );
  });

  it('keeps a conversation engaged after the owner answers a reply', () => {
    expect(
      linkedinConversationHasReply([
        { direction: 'outbound' },
        { direction: 'inbound' },
        { direction: 'outbound' },
      ])
    ).toBe(true);
    expect(linkedinConversationHasReply([{ direction: 'outbound' }])).toBe(false);
  });
});
