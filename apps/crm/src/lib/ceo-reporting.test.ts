import { describe, expect, it } from 'vitest';
import {
  buildCeoSystemInstruction,
  parseCeoQuestion,
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
  leadsByOutreachStatus: [],
  leadsBySource: [],
  leadClassifications: [],
  opportunitiesByStage: [],
  tasksByPriority: [],
  recentLeads: [],
  recentLinkedinConversations: [],
  upcomingOpportunities: [],
};

describe('Reporting CEO guardrails', () => {
  it('accepts a normal question and rejects empty or oversized input', () => {
    expect(parseCeoQuestion('  Show lead risk  ')).toBe('Show lead risk');
    expect(parseCeoQuestion('   ')).toBeNull();
    expect(parseCeoQuestion('x'.repeat(8_001))).toBeNull();
    expect(parseCeoQuestion({ message: 'hello' })).toBeNull();
  });

  it('embeds verified metrics and chart constraints in the system instruction', () => {
    const instruction = buildCeoSystemInstruction(snapshot);
    expect(instruction).toContain('"leads":10');
    expect(instruction).toContain('Never invent revenue');
    expect(instruction).toContain('Supported chart types are "bar", "line", and "pie"');
    expect(instruction).toContain('read-only executive analysis agent');
  });
});
