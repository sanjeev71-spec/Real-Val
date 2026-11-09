import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema as s, type DB } from "./db";
import { appUrl, sendMail } from "./mail";
import { getSetting, loadMasters, usersByRole } from "./data";
import { applyLookups, type FormData } from "./masters";
import { normalize, validateBooking, type Errors } from "./validate";
import { NEW_BOOKING_DEFAULTS } from "./fields";
import type { User } from "./auth";
import { str } from "./calc/excel";

export const NUDGE_HOURS = 4;
const SUPERIOR_LINK_DAYS = 7;

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Result = { ok: true; id?: number; bkgId?: string } | { ok: false; errors: Errors; message?: string };

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const summary = (d: FormData) =>
  `<table cellpadding="4" style="border-collapse:collapse">${[
    ["Client", d.Client], ["Project", d.Project], ["Unit", d.UnitNo], ["Associate", d.Emp],
    ["Date of booking", d.BkgLoginDate], ["Form status", d.FormStatus],
  ].map(([k, v]) => `<tr><td style="color:#666">${k}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table>`;

async function log(tx: Tx | DB, submissionId: number, actor: User | string, action: string, comment?: string | null) {
  await tx.insert(s.approvalEvents).values({
    submissionId,
    actorUserId: typeof actor === "string" ? null : actor.id,
    actorLabel: typeof actor === "string" ? actor : `${actor.name} (${actor.role})`,
    action,
    comment: comment || null,
  });
}

/** Next BkgID: RV + 4 digits, one more than the highest existing. Call inside a transaction holding the lock. */
async function nextBkgIds(tx: Tx, count: number): Promise<string[]> {
  const [r] = await tx.execute<{ n: number | null }>(
    sql`select max((substring(bkg_id from 3))::int) as n from bookings where bkg_id ~ '^RV[0-9]+$'`,
  ).then((x) => ("rows" in x ? x.rows : x) as { n: number | null }[]);
  const start = (r?.n ?? 0) + 1;
  return Array.from({ length: count }, (_, i) => `RV${String(start + i).padStart(4, "0")}`);
}

/** Inserts bookings, generating BkgIDs for rows without one. Returns the IDs in order. */
export async function insertBookings(tx: Tx, rows: FormData[], source: string, userId: number, submissionId?: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(424242)`);
  const fresh = await nextBkgIds(tx, rows.filter((r) => !str(r.BkgID)).length);
  const ids: string[] = [];
  for (const r of rows) {
    const bkgId = str(r.BkgID) ? str(r.BkgID).toUpperCase() : fresh.shift()!;
    await tx.insert(s.bookings).values({ bkgId, data: { ...r, BkgID: bkgId }, source, createdBy: userId, submissionId });
    ids.push(bkgId);
  }
  return ids;
}

/** Validate + auto-fill an SCD. Back-office fields are only accepted from Admin/Master. */
export async function prepareScd(raw: Record<string, unknown>, user: User, excludeSubmissionId?: number) {
  const masters = await loadMasters(excludeSubmissionId);
  let data = normalize(raw);
  for (const [k, v] of Object.entries(NEW_BOOKING_DEFAULTS)) if (!str(data[k])) data[k] = v;
  if (user.role === "sales") {
    for (const k of ["SIFStatus", "WorkingRemarks", "RAAchievePertenage", "ExpectedCollectionDate", "SlabRemarks", "UnitAdj",
      "FormRevisedPSF", "AgreementRevisedPSF", "CSlab", "CSlabType", "ASlab", "ASlabType", "BkgID"]) data[k] = null;
    data["RC/RA"] = NEW_BOOKING_DEFAULTS["RC/RA"];
    data.CalcBasis = NEW_BOOKING_DEFAULTS.CalcBasis;
    data["BBA Status"] = NEW_BOOKING_DEFAULTS["BBA Status"];
  }
  data.BkgID = null;
  data = applyLookups(data, masters, true);
  const errors = validateBooking(data, masters, { mode: "scd" });
  return { data, errors };
}

const approverEmails = async (status: string) =>
  status === "pending_admin"
    ? (await usersByRole("admin")).map((u) => u.email)
    : (await usersByRole("master")).map((u) => u.email);

async function notifyApprovers(id: number, status: string, d: FormData, intro: string) {
  const to = await approverEmails(status);
  await sendMail({
    to,
    subject: `[Approval needed] SCD #${id} — ${d.Client ?? ""} / ${d.Project ?? ""} ${d.UnitNo ?? ""}`,
    html: `<p>${esc(intro)}</p>${summary(d)}<p><a href="${appUrl(`/submissions/${id}`)}">Open SCD #${id} to review</a></p>`,
  });
}

/** Sales -> pending_admin, Admin -> pending_master, Master -> straight into Bkg. */
export async function submitScd(raw: Record<string, unknown>, user: User): Promise<Result> {
  const { data, errors } = await prepareScd(raw, user);
  if (Object.keys(errors).length) return { ok: false, errors };
  const db = await getDb();
  if (user.role === "master") {
    const bkgId = await db.transaction(async (tx) => {
      const [sub] = await tx.insert(s.submissions).values({ data, status: "approved", submittedBy: user.id }).returning();
      const [id] = await insertBookings(tx, [data], "scd", user.id, sub.id);
      await tx.update(s.submissions).set({ bkgId: id }).where(eq(s.submissions.id, sub.id));
      await log(tx, sub.id, user, "submitted_and_approved");
      return id;
    });
    return { ok: true, bkgId };
  }
  const status = user.role === "admin" ? "pending_master" : "pending_admin";
  const [sub] = await db.insert(s.submissions).values({ data, status, submittedBy: user.id }).returning();
  await log(db, sub.id, user, "submitted");
  await notifyApprovers(sub.id, status, data, `${user.name} submitted a new SCD.`);
  return { ok: true, id: sub.id };
}

/** Submitter edits a returned SCD and sends it again. */
export async function resubmitScd(id: number, raw: Record<string, unknown>, user: User): Promise<Result> {
  const db = await getDb();
  const [sub] = await db.select().from(s.submissions).where(eq(s.submissions.id, id));
  if (!sub || sub.submittedBy !== user.id || sub.status !== "returned") return { ok: false, errors: {}, message: "This SCD cannot be resubmitted." };
  const { data, errors } = await prepareScd(raw, user, id);
  if (Object.keys(errors).length) return { ok: false, errors };
  const status = user.role === "admin" ? "pending_master" : "pending_admin";
  await db.update(s.submissions).set({ data, status, updatedAt: new Date() }).where(eq(s.submissions.id, id));
  await log(db, id, user, "resubmitted");
  await notifyApprovers(id, status, data, `${user.name} resubmitted SCD #${id} after changes.`);
  return { ok: true, id };
}

/** Admin/Master edits fields (including back-office fields) while reviewing. */
export async function editPending(id: number, raw: Record<string, unknown>, user: User): Promise<Result> {
  const db = await getDb();
  const [sub] = await db.select().from(s.submissions).where(eq(s.submissions.id, id));
  const canEdit = sub && ((user.role === "admin" && sub.status === "pending_admin") || (user.role === "master" && ["pending_admin", "pending_master"].includes(sub.status)));
  if (!canEdit) return { ok: false, errors: {}, message: "You cannot edit this SCD now." };
  const { data, errors } = await prepareScd(raw, user, id);
  if (Object.keys(errors).length) return { ok: false, errors };
  await db.update(s.submissions).set({ data, updatedAt: new Date() }).where(eq(s.submissions.id, id));
  await log(db, id, user, "edited");
  return { ok: true, id };
}

export type Decision = "approve" | "return" | "reject";

export async function decide(id: number, decision: Decision, comment: string, user: User): Promise<Result> {
  const db = await getDb();
  const [sub] = await db.select().from(s.submissions).where(eq(s.submissions.id, id));
  if (!sub) return { ok: false, errors: {}, message: "Not found" };
  const asAdmin = user.role === "admin" && sub.status === "pending_admin";
  const asMaster = user.role === "master" && ["pending_admin", "pending_master"].includes(sub.status);
  if (!asAdmin && !asMaster) return { ok: false, errors: {}, message: "This SCD is not waiting for you." };
  if (decision !== "approve" && !comment.trim()) return { ok: false, errors: { comment: "Add a comment explaining why" } };
  const [submitter] = await db.select().from(s.users).where(eq(s.users.id, sub.submittedBy));
  const data = sub.data as FormData;

  if (decision === "return" || decision === "reject") {
    const status = decision === "return" ? "returned" : "rejected";
    await db.update(s.submissions).set({ status, updatedAt: new Date() }).where(eq(s.submissions.id, id));
    await log(db, id, user, decision === "return" ? "sent_back" : "rejected", comment);
    await sendMail({
      to: submitter?.email ?? [],
      subject: `SCD #${id} ${decision === "return" ? "sent back for changes" : "rejected"}`,
      html: `<p>${esc(user.name)} ${decision === "return" ? "sent your SCD back for changes" : "rejected your SCD"}.</p>
        <p><b>Comment:</b> ${esc(comment)}</p>${summary(data)}<p><a href="${appUrl(`/submissions/${id}`)}">Open SCD #${id}</a></p>`,
    });
    return { ok: true, id };
  }

  if (asAdmin) {
    await db.update(s.submissions).set({ status: "pending_master", updatedAt: new Date() }).where(eq(s.submissions.id, id));
    await log(db, id, user, "admin_approved", comment);
    await notifyApprovers(id, "pending_master", data, `${user.name} (Admin) approved SCD #${id}; it now needs your validation.`);
    return { ok: true, id };
  }

  // Master validation -> write to Bkg (re-check the unit is still free)
  const { data: fresh, errors } = await prepareScdForMaster(data, id);
  if (Object.keys(errors).length) return { ok: false, errors, message: "Fix these before approving." };
  const bkgId = await db.transaction(async (tx) => {
    const [bid] = await insertBookings(tx, [fresh], "scd", user.id, id);
    await tx.update(s.submissions).set({ status: "approved", bkgId: bid, data: { ...fresh, BkgID: bid }, updatedAt: new Date() }).where(eq(s.submissions.id, id));
    await log(tx, id, user, "master_approved", comment);
    return bid;
  });
  const admins = (await db
    .select({ email: s.users.email })
    .from(s.approvalEvents)
    .innerJoin(s.users, eq(s.users.id, s.approvalEvents.actorUserId))
    .where(and(eq(s.approvalEvents.submissionId, id), eq(s.approvalEvents.action, "admin_approved")))).map((x) => x.email);
  await sendMail({
    to: submitter?.email ?? [],
    cc: admins,
    subject: `SCD #${id} approved — booking ${bkgId} created`,
    html: `<p>Your SCD was validated and added to Bkg as <b>${bkgId}</b>.</p>${summary(fresh)}<p><a href="${appUrl(`/bookings/${bkgId}`)}">Open booking ${bkgId}</a></p>`,
  });
  return { ok: true, id, bkgId };
}

async function prepareScdForMaster(data: FormData, id: number) {
  const masters = await loadMasters(id);
  const d = applyLookups(normalize(data), masters, true);
  d.BkgID = null;
  return { data: d, errors: validateBooking(d, masters, { mode: "scd" }) };
}

/** Submitter (or an approver) resends the approval email; limited to once every NUDGE_HOURS. */
export async function nudge(id: number, user: User): Promise<Result> {
  const db = await getDb();
  const [sub] = await db.select().from(s.submissions).where(eq(s.submissions.id, id));
  if (!sub || !["pending_admin", "pending_master"].includes(sub.status)) return { ok: false, errors: {}, message: "Nothing to nudge." };
  if (sub.submittedBy !== user.id && user.role === "sales") return { ok: false, errors: {}, message: "Not your SCD." };
  if (sub.lastNudgeAt && Date.now() - sub.lastNudgeAt.getTime() < NUDGE_HOURS * 3600_000)
    return { ok: false, errors: {}, message: `Already nudged — you can nudge again after ${NUDGE_HOURS} hours.` };
  await db.update(s.submissions).set({ lastNudgeAt: new Date() }).where(eq(s.submissions.id, id));
  await log(db, id, user, "nudged");
  await notifyApprovers(id, sub.status, sub.data as FormData, `Reminder from ${user.name}: SCD #${id} is still waiting for approval.`);
  return { ok: true, id };
}

/** Master asks their superior to look at an SCD. Sent from the no-reply mailer, Reply-To and CC Master. */
export async function requestSuperior(id: number, superiorEmail: string, note: string, user: User): Promise<Result> {
  if (user.role !== "master") return { ok: false, errors: {}, message: "Only Master can do this." };
  const email = superiorEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, errors: { superiorEmail: "Invalid email" } };
  const db = await getDb();
  const [sub] = await db.select().from(s.submissions).where(eq(s.submissions.id, id));
  if (!sub || !["pending_admin", "pending_master"].includes(sub.status)) return { ok: false, errors: {}, message: "SCD is not pending." };
  const token = randomBytes(32).toString("base64url");
  await db.update(s.submissions).set({
    superiorEmail: email,
    superiorTokenHash: createHash("sha256").update(token).digest("hex"),
    superiorTokenExpires: new Date(Date.now() + SUPERIOR_LINK_DAYS * 86400_000),
    superiorDecision: null,
  }).where(eq(s.submissions.id, id));
  await log(db, id, user, "superior_requested", `${email}${note ? ` — ${note}` : ""}`);
  await sendMail({
    to: email,
    cc: user.email,
    replyTo: user.email,
    subject: `Approval requested by ${user.name}: SCD #${id} — ${(sub.data as FormData).Client ?? ""}`,
    html: `<p>${esc(user.name)} has asked for your approval on this booking.</p>${note ? `<p><b>Note:</b> ${esc(note)}</p>` : ""}
      ${summary(sub.data as FormData)}<p><a href="${appUrl(`/superior/${token}`)}">Review and approve / reject</a> (link valid ${SUPERIOR_LINK_DAYS} days, single use)</p>`,
  });
  await setSettingSafe("superior_email", email);
  return { ok: true, id };
}

async function setSettingSafe(k: string, v: string) {
  const { setSetting } = await import("./data");
  await setSetting(k, v);
}

export async function superiorLookup(token: string) {
  const db = await getDb();
  const hash = createHash("sha256").update(token).digest("hex");
  const [sub] = await db
    .select()
    .from(s.submissions)
    .where(and(eq(s.submissions.superiorTokenHash, hash), gt(s.submissions.superiorTokenExpires, new Date())));
  return sub ?? null;
}

export async function superiorDecide(token: string, decision: "approved" | "rejected", comment: string): Promise<Result> {
  const sub = await superiorLookup(token);
  if (!sub || sub.superiorDecision) return { ok: false, errors: {}, message: "This link has expired or was already used." };
  const db = await getDb();
  await db.update(s.submissions).set({ superiorDecision: decision, superiorTokenHash: null }).where(eq(s.submissions.id, sub.id));
  await log(db, sub.id, `Superior (${sub.superiorEmail})`, decision === "approved" ? "superior_approved" : "superior_rejected", comment);
  await sendMail({
    to: (await usersByRole("master")).map((u) => u.email),
    subject: `Superior ${decision} SCD #${sub.id}`,
    html: `<p>${esc(sub.superiorEmail)} <b>${decision}</b> SCD #${sub.id}.</p>${comment ? `<p><b>Comment:</b> ${esc(comment)}</p>` : ""}
      <p><a href="${appUrl(`/submissions/${sub.id}`)}">Open SCD #${sub.id}</a> to validate.</p>`,
  });
  return { ok: true, id: sub.id };
}

export async function lastSuperiorEmail() {
  return getSetting("superior_email");
}

export async function eventsFor(id: number) {
  const db = await getDb();
  return db.select().from(s.approvalEvents).where(eq(s.approvalEvents.submissionId, id)).orderBy(desc(s.approvalEvents.createdAt));
}
