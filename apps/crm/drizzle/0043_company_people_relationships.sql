ALTER TABLE crm.companies
  ADD COLUMN IF NOT EXISTS normalized_name text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS linkedin_external_id text,
  ADD COLUMN IF NOT EXISTS talentos_id text,
  ADD COLUMN IF NOT EXISTS research_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS researched_at timestamptz,
  ADD COLUMN IF NOT EXISTS research_summary text,
  ADD COLUMN IF NOT EXISTS research_sources jsonb,
  ADD COLUMN IF NOT EXISTS last_talentos_sync_at timestamptz;

DO $$ BEGIN
  CREATE TYPE crm.company_person_type AS ENUM ('recruiter', 'hiring_manager', 'company_leadership');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_companies_normalized_name ON crm.companies (normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_linkedin_external_unique
  ON crm.companies (linkedin_external_id)
  WHERE linkedin_external_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_talentos_unique
  ON crm.companies (talentos_id)
  WHERE talentos_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS crm.company_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES crm.workspaces(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  display_name text NOT NULL,
  headline text,
  location text,
  about text,
  email text,
  linkedin_url text,
  linkedin_profile_key text,
  current_title text,
  current_company_id uuid REFERENCES crm.companies(id) ON DELETE SET NULL,
  raw_profile jsonb,
  owner_id uuid NOT NULL,
  captured_by_api_key_id uuid,
  captured_by_api_key_label text,
  last_captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid
);
CREATE INDEX IF NOT EXISTS idx_company_people_workspace ON crm.company_people (workspace_id);
CREATE INDEX IF NOT EXISTS idx_company_people_current_company ON crm.company_people (current_company_id);
CREATE INDEX IF NOT EXISTS idx_company_people_name ON crm.company_people (last_name, first_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_people_linkedin_unique
  ON crm.company_people (workspace_id, linkedin_profile_key)
  WHERE linkedin_profile_key IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_people_email_unique
  ON crm.company_people (workspace_id, lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS crm.company_person_categories (
  person_id uuid NOT NULL REFERENCES crm.company_people(id) ON DELETE CASCADE,
  category crm.company_person_type NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, category)
);
CREATE INDEX IF NOT EXISTS idx_company_person_categories_category
  ON crm.company_person_categories (category);

CREATE TABLE IF NOT EXISTS crm.company_person_employments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES crm.company_people(id) ON DELETE CASCADE,
  company_id uuid REFERENCES crm.companies(id) ON DELETE SET NULL,
  company_name_snapshot text NOT NULL,
  title text,
  start_date text,
  end_date text,
  is_current boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'linkedin_extension',
  raw_evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_person_employments_person
  ON crm.company_person_employments (person_id);
CREATE INDEX IF NOT EXISTS idx_company_person_employments_company
  ON crm.company_person_employments (company_id);
CREATE INDEX IF NOT EXISTS idx_company_person_employments_current
  ON crm.company_person_employments (is_current);

CREATE TABLE IF NOT EXISTS crm.company_research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES crm.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  requested_by uuid NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  source_snapshot jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_research_jobs_company ON crm.company_research_jobs (company_id);
CREATE INDEX IF NOT EXISTS idx_company_research_jobs_status ON crm.company_research_jobs (status);

CREATE TABLE IF NOT EXISTS crm.talentos_company_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending_configuration',
  requested_by uuid NOT NULL,
  cursor text,
  records_seen integer NOT NULL DEFAULT 0,
  records_matched integer NOT NULL DEFAULT 0,
  records_created integer NOT NULL DEFAULT 0,
  records_needing_review integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_talentos_company_sync_runs_status ON crm.talentos_company_sync_runs (status);
CREATE INDEX IF NOT EXISTS idx_talentos_company_sync_runs_created ON crm.talentos_company_sync_runs (created_at);
