import { describe, expect, it } from 'vitest';
import { AI_AGENTS, AI_MODELS, selectAiAgentModel, selectAiModel } from '@skarion/ai-toolkit';

describe('AI model routing', () => {
  it('uses fast Flash for enrichment queues and cheap models for routine text agents', () => {
    expect(selectAiModel({}, 'cheap')).toBe('coding-cheap');
    expect(AI_AGENTS.filter((agent) => agent.tier === 'fast').map((agent) => agent.id)).toEqual([
      'candidate-conversation',
      'prospect-profile',
      'profile-normalizer',
      'lead-scorer',
    ]);
    expect(selectAiAgentModel({}, 'profile-normalizer', 'fast')).toBe('coding-fast');
    expect(selectAiAgentModel({}, 'lead-scorer', 'fast')).toBe('coding-fast');
    expect(
      AI_AGENTS.filter(
        (agent) =>
          agent.tier !== 'embedding' &&
          ![
            'prospect-profile',
            'profile-normalizer',
            'candidate-conversation',
            'lead-scorer',
          ].includes(agent.id)
      ).every((agent) => agent.tier === 'cheap')
    ).toBe(true);
    expect(
      AI_AGENTS.filter((agent) => agent.tier === 'embedding').map((agent) => agent.id)
    ).toEqual(['rag-search', 'rag-indexer']);
  });

  it('honors per-agent model overrides', () => {
    expect(
      selectAiAgentModel(
        { AI_AGENT_MODELS: JSON.stringify({ 'crm-copilot': 'gemini-2.5-flash' }) },
        'crm-copilot',
        'fast'
      )
    ).toBe('gemini-2.5-flash');
  });

  it('exposes every configured chat model alias once', () => {
    const ids = AI_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('coding-best');
    expect(ids).toContain('coding-fast');
    expect(ids).toContain('coding-cheap');
  });
});
