WITH legacy_dump AS (
  SELECT
    conversation."imported_by",
    max(conversation."owner_profile_url") AS owner_profile_url,
    max(conversation."created_at") AS dumped_at,
    count(*)::integer AS conversation_count,
    sum(conversation."message_count")::integer AS message_count
  FROM "crm"."linkedin_conversations" conversation
  WHERE jsonb_typeof(conversation."messages") = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM "crm"."linkedin_sync_imports" existing_import
      WHERE existing_import."imported_by" = conversation."imported_by"
        AND existing_import."kind" = 'messages'
    )
  GROUP BY conversation."imported_by"
)
INSERT INTO "crm"."linkedin_sync_imports" (
  "kind",
  "file_hash",
  "original_filename",
  "status",
  "total_rows",
  "new_items",
  "matched_items",
  "ignored_items",
  "flagged_items",
  "imported_by",
  "owner_profile_url",
  "details",
  "created_at",
  "updated_at"
)
SELECT
  'messages',
  'legacy-linkedin-conversations-' || legacy_dump."imported_by"::text,
  'Messages.csv (recovered legacy import)',
  'processing',
  legacy_dump.message_count,
  legacy_dump.message_count,
  0,
  0,
  0,
  legacy_dump."imported_by",
  legacy_dump.owner_profile_url,
  jsonb_build_object(
    'conversations',
    legacy_dump.conversation_count,
    'recoveredLegacyImport',
    true
  ),
  legacy_dump.dumped_at,
  now()
FROM legacy_dump
ON CONFLICT ("imported_by", "kind", "file_hash") DO NOTHING;
--> statement-breakpoint

INSERT INTO "crm"."linkedin_sync_jobs" (
  "import_id",
  "kind",
  "external_key",
  "lead_id",
  "payload",
  "status",
  "next_attempt_at",
  "created_at",
  "updated_at"
)
SELECT
  recovered_import."id",
  'message_conversation',
  conversation."external_conversation_id",
  conversation."lead_id",
  jsonb_build_object(
    'conversationId',
    conversation."external_conversation_id",
    'otherPartyName',
    conversation."other_party_name",
    'otherPartyProfileUrl',
    conversation."other_party_profile_url",
    'ownerProfileUrl',
    conversation."owner_profile_url",
    'messages',
    conversation."messages",
    'fullConversationMessageCount',
    conversation."message_count",
    'fullConversationExcerpt',
    conversation."messages"
  ),
  'pending',
  now(),
  now(),
  now()
FROM "crm"."linkedin_conversations" conversation
INNER JOIN "crm"."linkedin_sync_imports" recovered_import
  ON recovered_import."imported_by" = conversation."imported_by"
  AND recovered_import."kind" = 'messages'
  AND recovered_import."file_hash" =
    'legacy-linkedin-conversations-' || conversation."imported_by"::text
WHERE jsonb_typeof(conversation."messages") = 'array'
ON CONFLICT ("import_id", "kind", "external_key") DO NOTHING;
