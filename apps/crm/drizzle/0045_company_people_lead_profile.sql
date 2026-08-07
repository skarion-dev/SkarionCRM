ALTER TABLE crm.company_people
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS experience text,
  ADD COLUMN IF NOT EXISTS education text,
  ADD COLUMN IF NOT EXISTS skills text,
  ADD COLUMN IF NOT EXISTS current_role_dates text,
  ADD COLUMN IF NOT EXISTS open_to_work boolean,
  ADD COLUMN IF NOT EXISTS years_experience text,
  ADD COLUMN IF NOT EXISTS connection_degree text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS tags jsonb,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'linkedin-extension',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS outreach_status text NOT NULL DEFAULT 'not_approached',
  ADD COLUMN IF NOT EXISTS journey_stage text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS profile_capture_status crm.profile_capture_status NOT NULL DEFAULT 'captured',
  ADD COLUMN IF NOT EXISTS profile_normalization_status text NOT NULL DEFAULT 'not_queued',
  ADD COLUMN IF NOT EXISTS data_completeness integer NOT NULL DEFAULT 0;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS crm.company_person_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES crm.workspaces(id),
  person_id uuid NOT NULL REFERENCES crm.company_people(id) ON DELETE CASCADE,
  captured_by uuid NOT NULL,
  captured_by_api_key_id uuid,
  captured_by_api_key_label text,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_company_person_captures_person
  ON crm.company_person_captures (person_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_company_person_captures_workspace
  ON crm.company_person_captures (workspace_id, created_at);
--> statement-breakpoint

INSERT INTO crm.company_person_captures (
  workspace_id, person_id, captured_by, captured_by_api_key_id,
  captured_by_api_key_label, payload, payload_hash, created_at
)
SELECT
  person.workspace_id, person.id, person.owner_id, person.captured_by_api_key_id,
  person.captured_by_api_key_label, COALESCE(person.raw_profile, '{}'::jsonb),
  md5(COALESCE(person.raw_profile, '{}'::jsonb)::text),
  COALESCE(person.last_captured_at, person.created_at)
FROM crm.company_people person
WHERE person.deleted_at IS NULL
  AND person.raw_profile IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM crm.company_person_captures capture
    WHERE capture.person_id = person.id
  );
