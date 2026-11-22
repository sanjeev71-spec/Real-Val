DELETE FROM "projects" p USING "projects" q WHERE p."name" = q."name" AND p."id" > q."id";--> statement-breakpoint
DROP INDEX "projects_name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "projects_name_uq" ON "projects" USING btree ("name");
