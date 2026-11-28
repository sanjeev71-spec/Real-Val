CREATE TABLE IF NOT EXISTS "booking_snapshots" (
	"bkg_id" text PRIMARY KEY NOT NULL,
	"status" text,
	"sold" boolean NOT NULL,
	"ra_closed" boolean NOT NULL,
	"director" text,
	"parts" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"grp" text NOT NULL,
	"bkg_id" text NOT NULL,
	"kind" text NOT NULL,
	"director" text,
	"rev" double precision DEFAULT 0 NOT NULL,
	"share" double precision DEFAULT 0 NOT NULL,
	"share_ra" double precision DEFAULT 0 NOT NULL,
	"detail" text,
	"effective_date" date NOT NULL,
	"captured_on" date NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"date_confirmed" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"original_effective" date,
	"corrected_by" integer,
	"corrected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bev_bkg_idx" ON "booking_events" ("bkg_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bev_eff_idx" ON "booking_events" ("effective_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bev_grp_idx" ON "booking_events" ("grp");
