ALTER TABLE "exp_entries" ADD COLUMN "doc_base" text;--> statement-breakpoint
ALTER TABLE "exp_entries" ADD COLUMN "line_no" integer;--> statement-breakpoint
CREATE INDEX "exp_docbase_idx" ON "exp_entries" USING btree ("doc_base");--> statement-breakpoint
UPDATE "exp_entries" SET "doc_base" = regexp_replace("doc_no", '-[0-9]{1,3}[A-Z]?$', ''), "line_no" = (substring("doc_no" from '-([0-9]{1,3})[A-Z]?$'))::int WHERE "doc_no" ~ '^.+-[^-]+-[0-9]{1,3}[A-Z]?$';
--> statement-breakpoint
UPDATE "exp_entries" SET "doc_base" = "doc_no" WHERE "doc_base" IS NULL AND "doc_no" IS NOT NULL;
