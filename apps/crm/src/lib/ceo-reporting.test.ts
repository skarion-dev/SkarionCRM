import { describe, expect, it } from 'vitest';
import {
  buildCeoActionPrompt,
  buildCeoActionSystemInstruction,
  buildCeoSystemInstruction,
  detectCeoDatabaseActionIntent,
  parseCeoQuestion,
  sanitizeCeoDatabaseAction,
  type CeoOperationalContext,
  type CeoReportingSnapshot,
} from './ceo-reporting.js';

const snapshot: CeoReportingSnapshot = {
  generatedAt: '2026-07-29T00:00:00.000Z',
  reportingWindowDays: 30,
  totals: {
    leads: 10,
    contacts: 3,
    companies: 2,
    opportunities: 1,
    openTasks: 4,
    overdueTasks: 1,
    activitiesInWindow: 7,
    leadsCreatedInWindow: 5,
    averageLeadScore: 72,
    linkedinConversations: 2,
    linkedinMessages: 8,
    leadsWithLinkedinConversations: 2,
    lastLinkedinMessageAt: '2026-07-28T00:00:00.000Z',
  },
  leadsByStatus: [{ label: 'new', value: 6 }],
  leadsBySource: [],
  leadClassifications: [],
  opportunitiesByStage: [],
  tasksByPriority: [],
  recentLeads: [],
  recentLinkedinConversations: [],
  upcomingOpportunities: [],
};

const operationalContext: CeoOperationalContext = {
  scope: ['leads:ready_to_reach_out'],
  recordLimit: 500,
  truncated: [],
  leads: [
    {
      id: 'a77b7dc2-efab-478e-960b-3080e9d9b167',
      leadNumber: 'SK0001',
      email: 'candidate@example.com',
      emailQuality: 'valid_format_non_placeholder',
    },
  ],
  contacts: [],
  companies: [],
  opportunities: [],
  tasks: [],
  activities: [],
  linkedinConversations: [],
};

describe('Reporting CEO guardrails', () => {
  it('accepts a normal question and rejects empty or oversized input', () => {
    expect(parseCeoQuestion('  Show lead risk  ')).toBe('Show lead risk');
    expect(parseCeoQuestion('   ')).toBeNull();
    expect(parseCeoQuestion('x'.repeat(8_001))).toBeNull();
    expect(parseCeoQuestion({ message: 'hello' })).toBeNull();
  });

  it('embeds verified metrics and chart constraints in the system instruction', () => {
    const instruction = buildCeoSystemInstruction(snapshot, operationalContext);
    expect(instruction).toContain('"leads":10');
    expect(instruction).toContain('candidate@example.com');
    expect(instruction).toContain('Never invent revenue');
    expect(instruction).toContain('Supported chart types are "bar", "line", and "pie"');
    expect(instruction).toContain('operational CEO agent');
    expect(instruction).toContain('passwords, API keys, tokens');
  });

  it('detects explicit database commands but not analysis or negated commands', () => {
    expect(detectCeoDatabaseActionIntent('Move these leads to engaged')).toBe(true);
    expect(detectCeoDatabaseActionIntent('Create a follow-up task for this lead')).toBe(true);
    expect(detectCeoDatabaseActionIntent('Which leads should I approach?')).toBe(false);
    expect(detectCeoDatabaseActionIntent("Don't change the lead status")).toBe(false);
  });

  it('sanitizes supported changes and rejects destructive or arbitrary operations', () => {
    expect(
      sanitizeCeoDatabaseAction({
        entity: 'lead',
        operation: 'update',
        recordIds: ['a77b7dc2-efab-478e-960b-3080e9d9b167', 'bad-id'],
        changes: {
          journeyStage: 'engaged',
          email: 'updated@example.com',
          password: 'do-not-allow',
        },
        reason: 'Candidate replied',
      })
    ).toEqual({
      entity: 'lead',
      operation: 'update',
      recordIds: ['a77b7dc2-efab-478e-960b-3080e9d9b167'],
      changes: { journeyStage: 'engaged', email: 'updated@example.com' },
      reason: 'Candidate replied',
    });
    expect(
      sanitizeCeoDatabaseAction({
        entity: 'lead',
        operation: 'delete',
        recordIds: ['a77b7dc2-efab-478e-960b-3080e9d9b167'],
        changes: { journeyStage: 'engaged' },
      })
    ).toBeNull();
  });

  it('instructs the model to use verified IDs and require confirmation', () => {
    expect(buildCeoActionSystemInstruction()).toContain('Never propose deletion');
    expect(buildCeoActionPrompt('Move this lead to engaged', operationalContext)).toContain(
      'a77b7dc2-efab-478e-960b-3080e9d9b167'
    );
  });
});
