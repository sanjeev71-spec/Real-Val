ALTER TYPE "public"."role" ADD VALUE 'hr';--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"action" text NOT NULL,
	"target_id" integer,
	"data" jsonb NOT NULL,
	"before" jsonb,
	"status" text NOT NULL,
	"requested_by" integer NOT NULL,
	"decided_by" integer,
	"comment" text,
	"result_ref" text,
	"last_nudge_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "modes" (
	"name" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "change_date_to" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "exit_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "applicable" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "doj" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "remarks" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "seat_charge_start" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "mobile" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "dob" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "salary" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "min_salary" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "father_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "mother_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "permanent_address" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "current_address" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pan" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "aadhaar" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bank_account" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "ifsc" text;--> statement-breakpoint
ALTER TABLE "exp_entries" ADD COLUMN "emp" text;--> statement-breakpoint
ALTER TABLE "exp_entries" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "exp_entries" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "exp_entries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
CREATE INDEX "cr_status_idx" ON "change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "emp_emp_idx" ON "employees" USING btree ("emp");--> statement-breakpoint
CREATE UNIQUE INDEX "exp_docno_idx" ON "exp_entries" USING btree ("doc_no");--> statement-breakpoint
INSERT INTO "modes" ("name") VALUES ('Chq'), ('Billing'), ('NOC'), ('SPD'), ('Bank') ON CONFLICT DO NOTHING;
