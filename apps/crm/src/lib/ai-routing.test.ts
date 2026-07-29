import { describe, expect, it } from 'vitest';
import { AI_AGENTS, AI_MODELS, selectAiAgentModel, selectAiModel } from '@skarion/ai-toolkit';

describe('AI model routing', () => {
  it('uses cheap models for routine task tiers', () => {
    expect(selectAiModel({}, 'cheap')).toBe('coding-cheap');
    expect(AI_AGENTS.find((agent) => agent.id === 'lead-summarizer')?.tier).toBe('cheap');
    expect(AI_AGENTS.find((agent) => agent.id === 'next-best-action')?.tier).toBe('cheap');
    expect(AI_AGENTS.find((agent) => agent.id === 'document-ocr')?.tier).toBe('cheap');
    expect(AI_AGENTS.find((agent) => agent.id === 'outreach-writer')?.tier).toBe('cheap');
    expect(AI_AGENTS.find((agent) => agent.id === 'profile-normalizer')?.tier).toBe('cheap');
  });

  it('reserves the reasoning tier for executive analysis', () => {
    expect(AI_AGENTS.find((agent) => agent.id === 'lead-intake')?.tier).toBe('fast');
    expect(AI_AGENTS.find((agent) => agent.id === 'lead-scorer')?.tier).toBe('cheap');
    expect(AI_AGENTS.find((agent) => agent.id === 'reporting-ceo')?.tier).toBe('reasoning');
    expect(
      AI_AGENTS.filter((agent) => agent.tier === 'reasoning').map((agent) => agent.id)
    ).toEqual(['reporting-ceo']);
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
