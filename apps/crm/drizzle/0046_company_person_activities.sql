CREATE TABLE IF NOT EXISTS crm.company_person_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES crm.company_people(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES crm.workspaces(id),
  type text NOT NULL,
  subject text,
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_company_person_activities_person
  ON crm.company_person_activities (person_id, occurred_at);
