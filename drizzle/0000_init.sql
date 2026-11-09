CREATE TYPE "public"."role" AS ENUM('master', 'admin', 'sales');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending_admin', 'pending_master', 'returned', 'rejected', 'approved');--> statement-breakpoint
CREATE TABLE "approval_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"actor_user_id" integer,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"bkg_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"source" text NOT NULL,
	"submission_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_bkg_id_unique" UNIQUE("bkg_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"seq" integer NOT NULL,
	"emp" text NOT NULL,
	"reporting_head" text NOT NULL,
	"rev_share" double precision,
	"exp_share" double precision,
	"branch" text,
	"status" text,
	"type" text,
	"designation" text,
	"email" text,
	"change_date_from" date NOT NULL,
	"change_date_to" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exp_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_no" text,
	"pay_date" date,
	"value_date" date,
	"head" text,
	"mode" text,
	"rp" text,
	"gross" double precision,
	"gst" double precision,
	"tds" double precision,
	"branch" text,
	"bkg_id" text,
	"project" text,
	"narration" text,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "exp_heads" (
	"head" text PRIMARY KEY NOT NULL,
	"type" text
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"unit_no" text NOT NULL,
	"area" double precision
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "override_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"override_employee" text NOT NULL,
	"share_pct" double precision,
	"branch" text,
	"exclude_director" text,
	"effective_from" date,
	"effective_to" date,
	"active" text,
	"target_director" text,
	"target_downline" text
);
--> statement-breakpoint
CREATE TABLE "price_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date,
	"bsp" double precision,
	"oc" double precision,
	"payment_plan" text,
	"slab" double precision,
	"slab_type" text,
	"structure_date" date,
	"possession_date" date
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"name" text PRIMARY KEY NOT NULL,
	"location" text,
	"builder" text
);
--> statement-breakpoint
CREATE TABLE "rc_ra" (
	"name" text PRIMARY KEY NOT NULL,
	"rc" double precision,
	"ra" double precision
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"status" "submission_status" NOT NULL,
	"submitted_by" integer NOT NULL,
	"bkg_id" text,
	"last_nudge_at" timestamp with time zone,
	"superior_email" text,
	"superior_token_hash" text,
	"superior_token_expires" timestamp with time zone,
	"superior_decision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"emp_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "evt_sub_idx" ON "approval_events" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "bkg_project_unit_idx" ON "bookings" USING btree (("data"->>'Project'),("data"->>'UnitNo'));--> statement-breakpoint
CREATE INDEX "bkg_emp_idx" ON "bookings" USING btree (("data"->>'Emp'));--> statement-breakpoint
CREATE INDEX "exp_bkg_idx" ON "exp_entries" USING btree ("bkg_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_unit_idx" ON "inventory" USING btree ("project","unit_no");--> statement-breakpoint
CREATE INDEX "otp_email_idx" ON "otp_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "sub_status_idx" ON "submissions" USING btree ("status");