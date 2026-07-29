INSERT INTO crm.integration_configs (provider, label, status, settings)
VALUES (
  'ai_runtime',
  'AI runtime and model routing',
  'connected',
  jsonb_build_object(
    'defaultProvider', 'vertex_proxy',
    'tierModels', jsonb_build_object(
      'reasoning', 'coding-cheap',
      'fast', 'coding-cheap',
      'cheap', 'coding-cheap',
      'embedding', 'embedding'
    ),
    'agentModels', jsonb_build_object(
      'crm-copilot', 'coding-cheap',
      'reporting-ceo', 'coding-cheap',
      'lead-intake', 'coding-cheap',
      'prospect-profile', 'coding-cheap',
      'profile-normalizer', 'coding-cheap',
      'document-ocr', 'coding-cheap',
      'linkedin-connection-writer', 'coding-cheap',
      'outreach-writer', 'coding-cheap',
      'lead-scorer', 'coding-cheap',
      'next-best-action', 'coding-cheap',
      'lead-summarizer', 'coding-cheap',
      'company-summarizer', 'coding-cheap',
      'contact-summarizer', 'coding-cheap',
      'rag-search', 'embedding',
      'rag-indexer', 'embedding'
    )
  )
)
ON CONFLICT (provider) DO UPDATE SET
  label = EXCLUDED.label,
  status = EXCLUDED.status,
  settings = EXCLUDED.settings,
  updated_at = now();
