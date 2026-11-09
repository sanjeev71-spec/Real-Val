import { sql } from "drizzle-orm";
import {
  boolean, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["master", "admin", "sales"]);
export const submissionStatus = pgEnum("submission_status", [
  "pending_admin", // sales user submitted, waiting for an Admin
  "pending_master", // admin approved (or admin submitted), waiting for Master
  "returned", // sent back to the submitter for changes
  "rejected",
  "approved", // written to Bkg
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull(),
  empCode: text("emp_code"), // "Name~Code" as in Emp
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const otpCodes = pgTable("otp_codes", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("otp_email_idx").on(t.email)]);

// ---- masters (mirrors the Excel Master / Emp / Exp sheets)
export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  seq: integer("seq").notNull(), // row order in Excel (matters for first-match lookups)
  emp: text("emp").notNull(),
  reportingHead: text("reporting_head").notNull(),
  revShare: doublePrecision("rev_share"),
  expShare: doublePrecision("exp_share"),
  branch: text("branch"),
  status: text("status"),
  type: text("type"),
  designation: text("designation"),
  email: text("email"),
  changeDateFrom: date("change_date_from").notNull(),
  changeDateTo: date("change_date_to").notNull(),
});

export const expEntries = pgTable("exp_entries", {
  id: serial("id").primaryKey(),
  docNo: text("doc_no"),
  payDate: date("pay_date"),
  valueDate: date("value_date"),
  head: text("head"),
  mode: text("mode"),
  rp: text("rp"),
  gross: doublePrecision("gross"),
  gst: doublePrecision("gst"),
  tds: doublePrecision("tds"),
  branch: text("branch"),
  bkgId: text("bkg_id"),
  project: text("project"),
  narration: text("narration"),
  remarks: text("remarks"),
}, (t) => [index("exp_bkg_idx").on(t.bkgId)]);

export const projects = pgTable("projects", {
  name: text("name").primaryKey(),
  location: text("location"),
  builder: text("builder"),
});

export const inventory = pgTable("inventory", {
  id: serial("id").primaryKey(),
  project: text("project").notNull(),
  unitNo: text("unit_no").notNull(),
  area: doublePrecision("area"),
}, (t) => [uniqueIndex("inv_unit_idx").on(t.project, t.unitNo)]);

export const priceList = pgTable("price_list", {
  id: serial("id").primaryKey(),
  project: text("project").notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to"), // null = open-ended (Excel used TODAY())
  bsp: doublePrecision("bsp"),
  oc: doublePrecision("oc"),
  paymentPlan: text("payment_plan"),
  slab: doublePrecision("slab"), // DSlab
  slabType: text("slab_type"), // DSlabType
  structureDate: date("structure_date"),
  possessionDate: date("possession_date"),
});

export const rcRa = pgTable("rc_ra", {
  name: text("name").primaryKey(),
  rc: doublePrecision("rc"),
  ra: doublePrecision("ra"),
});

export const expHeads = pgTable("exp_heads", {
  head: text("head").primaryKey(),
  type: text("type"),
});

export const overrideRules = pgTable("override_rules", {
  id: serial("id").primaryKey(),
  overrideEmployee: text("override_employee").notNull(),
  sharePct: doublePrecision("share_pct"),
  branch: text("branch"),
  excludeDirector: text("exclude_director"),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  active: text("active"),
  targetDirector: text("target_director"),
  targetDownline: text("target_downline"),
});

// ---- Bkg: input columns only (keyed by the Excel headers); calculated columns are computed on read.
export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  bkgId: text("bkg_id").notNull().unique(),
  data: jsonb("data").$type<Record<string, string | number | null>>().notNull(),
  source: text("source").notNull(), // scd | bulk | excel
  submissionId: integer("submission_id"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("bkg_project_unit_idx").on(sql`(${t.data}->>'Project')`, sql`(${t.data}->>'UnitNo')`),
  index("bkg_emp_idx").on(sql`(${t.data}->>'Emp')`),
]);

// ---- SCD submissions and their approval trail
export const submissions = pgTable("submissions", {
  id: serial("id").primaryKey(),
  data: jsonb("data").$type<Record<string, string | number | null>>().notNull(),
  status: submissionStatus("status").notNull(),
  submittedBy: integer("submitted_by").notNull(),
  bkgId: text("bkg_id"),
  lastNudgeAt: timestamp("last_nudge_at", { withTimezone: true }),
  superiorEmail: text("superior_email"),
  superiorTokenHash: text("superior_token_hash"),
  superiorTokenExpires: timestamp("superior_token_expires", { withTimezone: true }),
  superiorDecision: text("superior_decision"), // approved | rejected
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sub_status_idx").on(t.status)]);

export const approvalEvents = pgTable("approval_events", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id").notNull(),
  actorUserId: integer("actor_user_id"),
  actorLabel: text("actor_label").notNull(),
  action: text("action").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("evt_sub_idx").on(t.submissionId)]);

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: text("action").notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
