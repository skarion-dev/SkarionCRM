CREATE TABLE "identity"."login_otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"pending_token_hash" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."login_otp_codes" ADD CONSTRAINT "login_otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_login_otp_pending_token_hash" ON "identity"."login_otp_codes" USING btree ("pending_token_hash");--> statement-breakpoint
CREATE INDEX "idx_login_otp_user" ON "identity"."login_otp_codes" USING btree ("user_id");