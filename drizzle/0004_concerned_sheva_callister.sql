CREATE TABLE "projections" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"emp_code" text NOT NULL,
	"man_months" double precision,
	"bkg_count" double precision,
	"director_revenue" double precision,
	"remarks" text
);
--> statement-breakpoint
CREATE INDEX "proj_year_idx" ON "projections" USING btree ("year");