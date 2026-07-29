import { describe, expect, it } from 'vitest';
import {
  detectLinkedInExportKind,
  inferLinkedInOwnerProfileUrl,
  spreadsheetRowsToRecords,
  summarizeLinkedInConversations,
  summarizeLinkedInInvitations,
} from './linkedinExport.js';

const owner = 'https://www.linkedin.com/in/skarion-owner';
const lead = 'https://www.linkedin.com/in/example-lead';
const secondLead = 'https://www.linkedin.com/in/second-lead';

describe('LinkedIn export parsing', () => {
  it('converts spreadsheet rows into records and skips blank rows', () => {
    const rows = spreadsheetRowsToRecords([
      [],
      ['CONVERSATION ID', 'FROM', 'DATE'],
      ['conversation-1', 'Saki', new Date('2026-07-20T10:00:00Z')],
      [null, null, null],
    ]);

    expect(rows).toEqual([
      {
        'CONVERSATION ID': 'conversation-1',
        FROM: 'Saki',
        DATE: '2026-07-20T10:00:00.000Z',
      },
    ]);
  });

  it('detects and summarizes message exports while inferring the owner', () => {
    const rows = [
      {
        'CONVERSATION ID': 'conversation-1',
        FROM: 'Saki',
        'SENDER PROFILE URL': owner,
        TO: 'Example Lead',
        'RECIPIENT PROFILE URLS': lead,
        DATE: '2026-07-20T10:00:00Z',
        CONTENT: 'Hello',
      },
      {
        'CONVERSATION ID': 'conversation-1',
        FROM: 'Example Lead',
        'SENDER PROFILE URL': lead,
        TO: 'Saki',
        'RECIPIENT PROFILE URLS': owner,
        DATE: '2026-07-21T10:00:00Z',
        CONTENT: 'Thanks',
      },
      {
        'CONVERSATION ID': 'conversation-2',
        FROM: 'Saki',
        'SENDER PROFILE URL': owner,
        TO: 'Second Lead',
        'RECIPIENT PROFILE URLS': secondLead,
        DATE: '2026-07-22T10:00:00Z',
        CONTENT: 'Hello there',
      },
    ];

    expect(detectLinkedInExportKind(rows)).toBe('messages');
    expect(inferLinkedInOwnerProfileUrl(rows)).toBe(owner);
    const result = summarizeLinkedInConversations(rows);
    expect(result.conversations).toHaveLength(2);
    expect(
      result.conversations.find(({ conversationId }) => conversationId === 'conversation-1')
    ).toMatchObject({
      conversationId: 'conversation-1',
      otherPartyName: 'Example Lead',
      otherPartyProfileUrl: lead,
      lastMessageFromUs: false,
      outboundCount: 1,
    });
    expect(
      result.conversations.find(({ conversationId }) => conversationId === 'conversation-1')
        ?.messages
    ).toHaveLength(2);
  });

  it('requires the owner URL when a single conversation is ambiguous', () => {
    const rows = [
      {
        'CONVERSATION ID': 'conversation-1',
        FROM: 'Example Lead',
        'SENDER PROFILE URL': lead,
        TO: 'Saki',
        'RECIPIENT PROFILE URLS': owner,
        DATE: '2026-07-21T10:00:00Z',
        CONTENT: 'Thanks',
      },
    ];

    expect(inferLinkedInOwnerProfileUrl(rows)).toBeNull();
    expect(summarizeLinkedInConversations(rows, owner).conversations).toHaveLength(1);
  });

  it('keeps inbound messages when LinkedIn omits the sender profile URL', () => {
    const result = summarizeLinkedInConversations(
      [
        {
          'CONVERSATION ID': 'conversation-1',
          FROM: 'Former LinkedIn Member',
          'SENDER PROFILE URL': '',
          TO: 'Saki',
          'RECIPIENT PROFILE URLS': owner,
          DATE: '2026-07-21T10:00:00Z',
          CONTENT: 'Still preserve this reply',
        },
      ],
      owner
    );

    expect(result.conversations[0]).toMatchObject({
      otherPartyName: 'Former LinkedIn Member',
      otherPartyProfileUrl: null,
      lastMessageFromUs: false,
    });
    expect(result.conversations[0]?.messages[0]?.content).toBe('Still preserve this reply');
  });

  it('detects outgoing invitation exports', () => {
    const rows = [
      {
        From: 'Saki',
        To: 'Example Lead',
        'Sent At': '2026-07-22T12:00:00Z',
        Direction: 'OUTGOING',
        inviteeProfileUrl: lead,
      },
    ];
    expect(detectLinkedInExportKind(rows)).toBe('invitations');
    expect(summarizeLinkedInInvitations(rows).invitations[0]).toMatchObject({
      otherPartyName: 'Example Lead',
      otherPartyProfileUrl: lead,
    });
  });
});
