-- A lead remains engaged once they have replied, even if our team sent the
-- most recent message afterward. Preserve booked calls and later manual stages.
UPDATE "crm"."lead_channels" channel
SET
  "stage" = 'replied',
  "last_attempt_at" = greatest(channel."last_attempt_at", conversation."last_message_at"),
  "attempt_count" = greatest(channel."attempt_count", conversation."outbound_count"),
  "updated_at" = now()
FROM "crm"."linkedin_conversations" conversation
WHERE channel."lead_id" = conversation."lead_id"
  AND channel."channel" = 'linkedin'
  AND channel."stage" IN (
    'not_started',
    'warm_up_needed',
    'connection_request_sent',
    'connection_accepted',
    'message_sent',
    'awaiting_reply',
    'in_conversation',
    'no_response'
  )
  AND jsonb_path_exists(
    conversation."messages",
    '$[*] ? (@.direction == "inbound")'
  );
--> statement-breakpoint

INSERT INTO "crm"."lead_channels" (
  "lead_id",
  "channel",
  "stage",
  "attempt_count",
  "last_attempt_at",
  "sequence",
  "owner_id",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON (conversation."lead_id")
  conversation."lead_id",
  'linkedin'::"crm"."outreach_channel",
  'replied'::"crm"."lead_channel_stage",
  conversation."outbound_count",
  conversation."last_message_at",
  1,
  lead."owner_id",
  now(),
  now()
FROM "crm"."linkedin_conversations" conversation
INNER JOIN "crm"."leads" lead ON lead."id" = conversation."lead_id"
WHERE conversation."lead_id" IS NOT NULL
  AND lead."deleted_at" IS NULL
  AND lead."review_state" = 'accepted'
  AND jsonb_path_exists(
    conversation."messages",
    '$[*] ? (@.direction == "inbound")'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "crm"."lead_channels" existing
    WHERE existing."lead_id" = conversation."lead_id"
      AND existing."channel" = 'linkedin'
  )
ORDER BY conversation."lead_id", conversation."last_message_at" DESC;
--> statement-breakpoint

UPDATE "crm"."leads" lead
SET
  "journey_stage" = 'engaged',
  "status" = 'contacted',
  "outreach_status" = 'replied',
  "updated_at" = now()
WHERE lead."deleted_at" IS NULL
  AND lead."review_state" = 'accepted'
  AND lead."journey_stage" IN (
    'future',
    'foreign_national',
    'new',
    'ready_to_reach_out',
    'connection_sent',
    'connected',
    'no_response'
  )
  AND EXISTS (
    SELECT 1
    FROM "crm"."linkedin_conversations" conversation
    WHERE conversation."lead_id" = lead."id"
      AND jsonb_path_exists(
        conversation."messages",
        '$[*] ? (@.direction == "inbound")'
      )
  );
