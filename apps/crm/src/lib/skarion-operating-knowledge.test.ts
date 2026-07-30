import { describe, expect, it } from 'vitest';
import { buildSkarionOperatingKnowledge } from './skarion-operating-knowledge.js';

const agents = [
  {
    id: 'candidate-conversation',
    name: 'Candidate Conversation Agent',
    description: 'Drafts candidate replies',
    tier: 'fast',
  },
  {
    id: 'lead-scorer',
    name: 'Lead Scoring Agent',
    description: 'Scores cleaned leads',
    tier: 'cheap',
  },
];

describe('Skarion operating knowledge', () => {
  it('always loads candidate quality, positioning, ethics, and every registered agent', () => {
    const knowledge = buildSkarionOperatingKnowledge('What should we do today?', agents);
    expect(knowledge.retrieval.matchedSectionIds).toEqual(
      expect.arrayContaining(['candidate-quality', 'skarion-positioning', 'ethical-boundaries'])
    );
    expect(knowledge.agents.map((agent) => agent.id)).toEqual([
      'candidate-conversation',
      'lead-scorer',
    ]);
    expect(knowledge.sections.map((section) => section.content).join('\n')).toContain(
      'Need + Fit + Openness'
    );
  });

  it('retrieves conversation and objection doctrine for a candidate reply question', () => {
    const knowledge = buildSkarionOperatingKnowledge(
      'Draft a LinkedIn reply explaining our fee and whether we guarantee placement',
      agents
    );
    expect(knowledge.retrieval.matchedSectionIds).toEqual(
      expect.arrayContaining(['conversation-style', 'objections'])
    );
    expect(knowledge.sections.map((section) => section.content).join('\n')).toContain(
      'success-based'
    );
  });

  it('loads the complete indexed playbook for an explicit full-knowledge request', () => {
    const knowledge = buildSkarionOperatingKnowledge(
      'Show me the complete playbook and all Skarion knowledge',
      agents
    );
    expect(knowledge.retrieval.note).toBe('Full institutional playbook context selected.');
    expect(knowledge.sections).toHaveLength(9);
    expect(knowledge.source.importedLines).toBe(1455);
  });
});
