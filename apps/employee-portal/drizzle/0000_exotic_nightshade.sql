CREATE SCHEMA "hr";
--> statement-breakpoint
CREATE TYPE "hr"."time_off_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "hr"."time_off_type" AS ENUM('vacation', 'sick', 'personal', 'bereavement', 'other');--> statement-breakpoint
CREATE TABLE "hr"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"app" text DEFAULT 'hr' NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr"."departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"manager_user_id" uuid,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "hr"."employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_number" text,
	"department_id" uuid,
	"position" text,
	"hire_date" date,
	"salary" integer,
	"salary_currency" text DEFAULT 'USD',
	"employment_type" text DEFAULT 'full_time',
	"emergency_contact" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "employees_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "hr"."time_off_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" time_off_type NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" time_off_status DEFAULT 'pending' NOT NULL,
	"reason" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
ALTER TABLE "hr"."employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "hr"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr"."time_off_requests" ADD CONSTRAINT "time_off_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hr"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hr_audit_actor" ON "hr"."audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_hr_audit_resource" ON "hr"."audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_hr_audit_created" ON "hr"."audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_departments_name" ON "hr"."departments" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_departments_manager" ON "hr"."departments" USING btree ("manager_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_departments_name_lower" ON "hr"."departments" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "idx_employees_user" ON "hr"."employees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_employees_department" ON "hr"."employees" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "idx_employees_employee_number" ON "hr"."employees" USING btree ("employee_number");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_employees_employee_number_lower" ON "hr"."employees" USING btree (lower("employee_number"));--> statement-breakpoint
CREATE INDEX "idx_time_off_employee" ON "hr"."time_off_requests" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_time_off_status" ON "hr"."time_off_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_time_off_dates" ON "hr"."time_off_requests" USING btree ("start_date","end_date");