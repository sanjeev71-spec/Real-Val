ALTER TABLE "projects" DROP CONSTRAINT "projects_pkey";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "id" serial PRIMARY KEY NOT NULL;--> statement-breakpoint
CREATE INDEX "projects_name_idx" ON "projects" USING btree ("name");
