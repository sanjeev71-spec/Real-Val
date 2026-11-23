CREATE SEQUENCE IF NOT EXISTS "data_version_seq";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bump_data_version() RETURNS trigger AS $$ BEGIN PERFORM nextval('data_version_seq'); RETURN NULL; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_dv_bookings ON "bookings";
--> statement-breakpoint
CREATE TRIGGER trg_dv_bookings AFTER INSERT OR UPDATE OR DELETE ON "bookings" FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_dv_exp_entries ON "exp_entries";
--> statement-breakpoint
CREATE TRIGGER trg_dv_exp_entries AFTER INSERT OR UPDATE OR DELETE ON "exp_entries" FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_dv_employees ON "employees";
--> statement-breakpoint
CREATE TRIGGER trg_dv_employees AFTER INSERT OR UPDATE OR DELETE ON "employees" FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_dv_rc_ra ON "rc_ra";
--> statement-breakpoint
CREATE TRIGGER trg_dv_rc_ra AFTER INSERT OR UPDATE OR DELETE ON "rc_ra" FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_dv_override_rules ON "override_rules";
--> statement-breakpoint
CREATE TRIGGER trg_dv_override_rules AFTER INSERT OR UPDATE OR DELETE ON "override_rules" FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_dv_exp_heads ON "exp_heads";
--> statement-breakpoint
CREATE TRIGGER trg_dv_exp_heads AFTER INSERT OR UPDATE OR DELETE ON "exp_heads" FOR EACH STATEMENT EXECUTE FUNCTION bump_data_version();
