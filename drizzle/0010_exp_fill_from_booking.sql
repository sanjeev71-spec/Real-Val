-- Exp lines with a BkgID but a blank Emp / Project take the booking's Emp / Project (blank = auto from the booking).
UPDATE "exp_entries" e SET "emp" = b."data"->>'Emp' FROM "bookings" b
  WHERE b."bkg_id" = upper(e."bkg_id") AND coalesce(e."emp", '') = '' AND coalesce(b."data"->>'Emp', '') <> '';
--> statement-breakpoint
UPDATE "exp_entries" e SET "project" = b."data"->>'Project' FROM "bookings" b
  WHERE b."bkg_id" = upper(e."bkg_id") AND coalesce(e."project", '') = '' AND coalesce(b."data"->>'Project', '') <> '';
