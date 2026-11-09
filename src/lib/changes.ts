import "server-only";
import { and, asc, eq, max, sql } from "drizzle-orm";
import { getDb, schema as s, type DB } from "./db";
import { appUrl, sendMail } from "./mail";
import { activeModes, currentPeriods, expHeadList, todayIso, usersByRole } from "./data";
import { str } from "./calc/excel";
import { parseDate } from "./validate";
import type { User } from "./auth";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Errors = Record<string, string>;
export type ChangeResult = { ok: true; id?: number; applied?: boolean; ref?: string } | { ok: false; errors: Errors; message?: string };

export const NUDGE_HOURS = 4;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const codeOf = (x: string | null | undefined) => str(x).split("~")[1] ?? "";
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const toNum = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(/[,\s]/g, "")));
const txt = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

export const ENTITY_LABEL: Record<string, string> = { exp: "Exp", emp: "Emp" };
export const ACTION_LABEL: Record<string, string> = {
  create: "New entry", update: "Edit", delete: "Delete", change: "Effective change", correct: "Correct details", exit: "Exit",
};

// =================================================================== Exp

export const EXP_FIELDS = ["payDate", "valueDate", "head", "mode", "rp", "gross", "gst", "tds", "branch", "bkgId", "emp", "project", "narration", "remarks"] as const;
export type ExpData = Record<(typeof EXP_FIELDS)[number], string | number | null>;

export async function normalizeExp(raw: Record<string, unknown>): Promise<{ data: ExpData; errors: Errors }> {
  const db = await getDb();
  const d: ExpData = {
    payDate: parseDate(raw.payDate ?? "") ?? null,
    valueDate: parseDate(raw.valueDate ?? raw.payDate ?? "") ?? null,
    head: txt(raw.head),
    mode: txt(raw.mode),
    rp: txt(raw.rp),
    gross: toNum(raw.gross),
    gst: toNum(raw.gst),
    tds: toNum(raw.tds),
    branch: txt(raw.branch),
    bkgId: txt(raw.bkgId)?.toUpperCase() ?? null,
    emp: txt(raw.emp),
    project: txt(raw.project),
    narration: txt(raw.narration),
    remarks: txt(raw.remarks),
  };
  const e: Errors = {};
  if (!isDate(d.payDate)) e.payDate = "Pay date is required (dd-mm-yyyy)";
  if (!isDate(d.valueDate)) e.valueDate = "Value date is required";
  const heads = await expHeadList();
  if (!d.head) e.head = "Head is required";
  else if (!heads.some((h) => h.head.toLowerCase() === str(d.head).toLowerCase())) e.head = "Unknown head";
  const modes = await activeModes();
  if (!d.mode) e.mode = "Mode is required";
  else if (!modes.some((m) => m.toLowerCase() === str(d.mode).toLowerCase())) e.mode = "Not in the Mode master";
  if (d.rp !== "Receipt" && d.rp !== "Payment") e.rp = "Choose Receipt or Payment";
  for (const k of ["gross", "gst", "tds"] as const) {
    const v = d[k];
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) e[k] = "Must be a positive number";
  }
  if (d.gross === null) e.gross = "Gross is required";
  if (d.bkgId) {
    const [b] = await db.select({ data: s.bookings.data }).from(s.bookings).where(eq(s.bookings.bkgId, str(d.bkgId)));
    if (!b) e.bkgId = "No booking with this BkgID";
    else if (!d.emp) d.emp = (b.data.Emp as string) ?? null; // default the Emp from the booking
  }
  if (!d.emp) e.emp = "Choose the employee";
  else {
    const [x] = await db.select({ id: s.employees.id }).from(s.employees).where(eq(s.employees.emp, str(d.emp))).limit(1);
    if (!x) e.emp = "Not found in Emp";
  }
  return { data: d, errors: e };
}

async function nextDocNo(tx: Tx): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(424243)`);
  const r = await tx.execute(sql`select max((substring(doc_no from 3))::int) as n from exp_entries where doc_no ~ '^RP[0-9]+$'`);
  const rows = ("rows" in r ? r.rows : r) as { n: number | null }[];
  return `RP${String((rows[0]?.n ?? 0) + 1).padStart(5, "0")}`;
}

async function applyExp(tx: Tx, action: string, targetId: number | null, d: ExpData, userId: number): Promise<string> {
  if (action === "create") {
    const docNo = await nextDocNo(tx);
    await tx.insert(s.expEntries).values({ ...(d as Record<string, unknown>), docNo, createdBy: userId } as never);
    return docNo;
  }
  const [cur] = await tx.select().from(s.expEntries).where(eq(s.expEntries.id, targetId!));
  if (!cur) throw new Error("Exp entry no longer exists");
  if (action === "update") await tx.update(s.expEntries).set({ ...(d as Record<string, unknown>), updatedAt: new Date() } as never).where(eq(s.expEntries.id, targetId!));
  if (action === "delete") await tx.delete(s.expEntries).where(eq(s.expEntries.id, targetId!));
  return cur.docNo ?? String(targetId);
}

export async function requestExp(user: User, action: "create" | "update" | "delete", raw: Record<string, unknown>, targetId?: number): Promise<ChangeResult> {
  if (user.role !== "admin" && user.role !== "master") return { ok: false, errors: {}, message: "Only Admin or Master can change Exp." };
  const db = await getDb();
  let before: Record<string, unknown> | null = null;
  if (action !== "create") {
    const [cur] = await db.select().from(s.expEntries).where(eq(s.expEntries.id, targetId ?? -1));
    if (!cur) return { ok: false, errors: {}, message: "Entry not found" };
    before = cur as never;
  }
  let data: ExpData;
  if (action === "delete") data = before as never;
  else {
    const n = await normalizeExp(raw);
    if (Object.keys(n.errors).length) return { ok: false, errors: n.errors };
    data = n.data;
  }
  return submit(user, "exp", action, targetId ?? null, data as never, before);
}

// =================================================================== Emp

export const EMP_PERIOD_FIELDS = ["reportingHead", "branch", "revShare", "expShare", "type", "designation", "department", "status", "applicable", "company", "remarks", "seatChargeStart"] as const;
export const EMP_PERSON_FIELDS = ["gender", "doj", "email", "mobile", "dob", "salary", "minSalary", "fatherName", "motherName", "permanentAddress", "currentAddress", "pan", "aadhaar", "bankName", "bankAccount", "ifsc"] as const;
const DATE_FIELDS = new Set(["doj", "dob", "seatChargeStart"]);
const NUM_FIELDS = new Set(["revShare", "expShare"]);

function cleanEmpFields(raw: Record<string, unknown>, keys: readonly string[]) {
  const out: Record<string, string | number | null> = {};
  for (const k of keys) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (DATE_FIELDS.has(k)) out[k] = txt(v) ? parseDate(v) : null;
    else if (NUM_FIELDS.has(k)) out[k] = toNum(v);
    else out[k] = txt(v);
  }
  return out;
}

async function empRows() {
  const db = await getDb();
  return db.select().from(s.employees).orderBy(asc(s.employees.seq));
}

export async function requestEmp(user: User, action: "create" | "change" | "correct" | "exit", raw: Record<string, unknown>): Promise<ChangeResult> {
  if (user.role !== "hr" && user.role !== "master") return { ok: false, errors: {}, message: "Only HR or Master can change Emp." };
  const rows = await empRows();
  const current = currentPeriods(rows);
  const names = new Set(rows.map((r) => r.emp));
  const e: Errors = {};
  let data: Record<string, unknown> = {};
  let before: Record<string, unknown> | null = null;

  const checkRH = (rh: unknown, self?: string) => {
    if (!txt(rh)) return "Reporting head is required";
    if (!names.has(str(rh as string)) && str(rh as string) !== self) return "Reporting head not found in Emp (use Name~Code)";
    return null;
  };
  const checkShare = (k: string, v: unknown) => {
    if (v !== null && v !== undefined && (typeof v !== "number" || v < 0 || v > 1)) e[k] = "Enter a fraction between 0 and 1 (e.g. 1 = 100%)";
  };

  if (action === "create") {
    const name = txt(raw.name), code = txt(raw.code);
    if (!name) e.name = "Name is required";
    if (!code) e.code = "Employee code is required";
    else if (/[~|]/.test(code)) e.code = "Code cannot contain ~ or |";
    else if (rows.some((r) => codeOf(r.emp).toLowerCase() === code.toLowerCase())) e.code = "This code already exists";
    const f = cleanEmpFields(raw, [...EMP_PERIOD_FIELDS, ...EMP_PERSON_FIELDS]);
    const emp = `${name}~${code}`;
    const rhErr = checkRH(f.reportingHead, emp);
    if (rhErr) e.reportingHead = rhErr;
    if (!isDate(f.doj)) e.doj = "Date of joining is required";
    checkShare("revShare", f.revShare);
    checkShare("expShare", f.expShare);
    data = { ...f, emp, status: f.status ?? "Active", company: f.company ?? "RV", applicable: f.applicable ?? "Y" };
  }

  if (action === "change" || action === "correct" || action === "exit") {
    const code = txt(raw.code);
    const cur = current.find((r) => codeOf(r.emp).toLowerCase() === str(code).toLowerCase());
    if (!cur) return { ok: false, errors: { code: "Employee not found" } };
    before = cur as never;
    if (action === "change") {
      const eff = parseDate(raw.effectiveFrom ?? "");
      if (!isDate(eff)) e.effectiveFrom = "Effective date is required";
      else if (eff! <= cur.changeDateFrom) e.effectiveFrom = `Must be after the current period start (${cur.changeDateFrom})`;
      else if (cur.changeDateTo && eff! > addDays(cur.changeDateTo, 1)) e.effectiveFrom = "This employee has exited — use New employee to re-join";
      const f = cleanEmpFields(raw, EMP_PERIOD_FIELDS);
      if ("reportingHead" in f) {
        const rhErr = checkRH(f.reportingHead, cur.emp);
        if (rhErr) e.reportingHead = rhErr;
      }
      checkShare("revShare", f.revShare);
      checkShare("expShare", f.expShare);
      const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => String((cur as never)[k] ?? "") !== String(v ?? "")));
      if (!Object.keys(changed).length && !e.effectiveFrom) e.form = "Nothing was changed";
      data = { code: codeOf(cur.emp), emp: cur.emp, periodId: cur.id, effectiveFrom: eff, changes: changed };
    }
    if (action === "correct") {
      const f = cleanEmpFields(raw, [...EMP_PERSON_FIELDS, "remarks", "designation", "department", "applicable", "seatChargeStart"]);
      const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => String((cur as never)[k] ?? "") !== String(v ?? "")));
      if (!Object.keys(changed).length) e.form = "Nothing was changed";
      data = { code: codeOf(cur.emp), emp: cur.emp, periodId: cur.id, changes: changed };
    }
    if (action === "exit") {
      const exitDate = parseDate(raw.exitDate ?? "");
      if (!isDate(exitDate)) e.exitDate = "Exit date is required";
      else if (exitDate! < cur.changeDateFrom) e.exitDate = `Cannot be before the current period start (${cur.changeDateFrom})`;
      if (cur.changeDateTo) e.exitDate = "This employee has already exited";
      const reassign = Array.isArray(raw.reassign) ? (raw.reassign as { emp: string; newHead: string }[]) : [];
      const reportees = current.filter((r) => r.changeDateTo === null && r.reportingHead === cur.emp && r.emp !== cur.emp);
      const plan = reportees.map((r) => {
        const pick = reassign.find((x) => x.emp === r.emp)?.newHead || cur.reportingHead;
        if (pick === cur.emp) e[`reassign:${r.emp}`] = "Pick someone other than the person leaving";
        else if (!names.has(pick)) e[`reassign:${r.emp}`] = "Not found in Emp";
        return { emp: r.emp, periodId: r.id, newHead: pick };
      });
      data = { code: codeOf(cur.emp), emp: cur.emp, periodId: cur.id, exitDate, reassign: plan };
    }
  }
  if (Object.keys(e).length) return { ok: false, errors: e };
  return submit(user, "emp", action, (data.periodId as number) ?? null, data, before);
}

async function nextSeq(tx: Tx) {
  const [r] = await tx.select({ m: max(s.employees.seq) }).from(s.employees);
  return (r?.m ?? 0) + 1;
}

/** Close a period on `to` and open a copy from `to + 1` with `changes` applied. */
async function splitPeriod(tx: Tx, periodId: number, to: string, changes: Record<string, unknown>) {
  const [cur] = await tx.select().from(s.employees).where(eq(s.employees.id, periodId));
  if (!cur) throw new Error("Employee period no longer exists");
  if (cur.changeDateTo !== null) throw new Error(`${cur.emp} is no longer in an open period`);
  await tx.update(s.employees).set({ changeDateTo: to, exitDate: to }).where(eq(s.employees.id, periodId));
  const { id: _id, seq: _seq, ...copy } = cur;
  await tx.insert(s.employees).values({ ...copy, ...(changes as Record<string, unknown>), seq: await nextSeq(tx), changeDateFrom: addDays(to, 1), changeDateTo: null, exitDate: null } as never);
}

async function applyEmp(tx: Tx, action: string, d: Record<string, unknown>): Promise<string> {
  if (action === "create") {
    const { emp, ...f } = d as Record<string, never>;
    await tx.insert(s.employees).values({ ...(f as object), emp, seq: await nextSeq(tx), changeDateFrom: (d.doj as string), changeDateTo: null } as never);
    return String(emp);
  }
  if (action === "change") {
    await splitPeriod(tx, d.periodId as number, addDays(d.effectiveFrom as string, -1), d.changes as Record<string, unknown>);
    return String(d.emp);
  }
  if (action === "correct") {
    await tx.update(s.employees).set(d.changes as never).where(eq(s.employees.id, d.periodId as number));
    return String(d.emp);
  }
  if (action === "exit") {
    const exitDate = d.exitDate as string;
    const [cur] = await tx.select().from(s.employees).where(eq(s.employees.id, d.periodId as number));
    if (!cur || cur.changeDateTo !== null) throw new Error("This employee has already exited");
    await tx.update(s.employees).set({ changeDateTo: exitDate, exitDate, status: "Inactive" }).where(eq(s.employees.id, cur.id));
    for (const r of d.reassign as { periodId: number; newHead: string }[]) await splitPeriod(tx, r.periodId, exitDate, { reportingHead: r.newHead });
    return String(d.emp);
  }
  throw new Error(`Unknown action ${action}`);
}

// =================================================================== shared request / approval

async function submit(user: User, entity: "exp" | "emp", action: string, targetId: number | null, data: Record<string, unknown>, before: Record<string, unknown> | null): Promise<ChangeResult> {
  const db = await getDb();
  if (user.role === "master") {
    const ref = await db.transaction(async (tx) => {
      const ref = entity === "exp" ? await applyExp(tx, action, targetId, data as ExpData, user.id) : await applyEmp(tx, action, data);
      await tx.insert(s.changeRequests).values({
        entity, action, targetId, data, before, status: "approved", requestedBy: user.id, decidedBy: user.id, decidedAt: new Date(), resultRef: ref, comment: "Done directly by Master",
      });
      return ref;
    });
    return { ok: true, applied: true, ref };
  }
  const [cr] = await db.insert(s.changeRequests).values({ entity, action, targetId, data, before, status: "pending", requestedBy: user.id }).returning();
  await notifyMaster(cr.id, entity, action, user.name, data, "is waiting for your approval");
  return { ok: true, id: cr.id };
}

function summary(entity: string, action: string, d: Record<string, unknown>) {
  if (entity === "exp")
    return `${ACTION_LABEL[action]} — ${esc(d.head)} · ${esc(d.mode)} · ${esc(d.rp)} ₹${esc(d.gross)} · ${esc(d.bkgId ?? "")} ${esc(d.emp)} · ${esc(d.payDate)}`;
  return `${ACTION_LABEL[action]} — ${esc(d.emp)}${d.effectiveFrom ? ` from ${esc(d.effectiveFrom)}` : ""}${d.exitDate ? ` exit on ${esc(d.exitDate)}` : ""}`;
}

async function notifyMaster(id: number, entity: string, action: string, who: string, d: Record<string, unknown>, what: string) {
  await sendMail({
    to: (await usersByRole("master")).map((u) => u.email),
    subject: `[Approval needed] ${ENTITY_LABEL[entity]} change #${id} from ${who}`,
    html: `<p>${esc(who)}'s ${ENTITY_LABEL[entity]} change ${what}.</p><p>${summary(entity, action, d)}</p><p><a href="${appUrl(`/changes/${id}`)}">Open change #${id}</a></p>`,
  });
}

export async function decideChange(user: User, id: number, approve: boolean, comment: string): Promise<ChangeResult> {
  if (user.role !== "master") return { ok: false, errors: {}, message: "Only Master can approve." };
  if (!approve && !comment.trim()) return { ok: false, errors: { comment: "Add a comment explaining why" } };
  const db = await getDb();
  const [cr] = await db.select().from(s.changeRequests).where(eq(s.changeRequests.id, id));
  if (!cr || cr.status !== "pending") return { ok: false, errors: {}, message: "This change is not pending." };
  let ref: string | null = null;
  try {
    await db.transaction(async (tx) => {
      if (approve) ref = cr.entity === "exp" ? await applyExp(tx, cr.action, cr.targetId, cr.data as ExpData, cr.requestedBy) : await applyEmp(tx, cr.action, cr.data);
      await tx.update(s.changeRequests).set({ status: approve ? "approved" : "rejected", decidedBy: user.id, decidedAt: new Date(), comment: comment || null, resultRef: ref }).where(eq(s.changeRequests.id, id));
    });
  } catch (err) {
    return { ok: false, errors: {}, message: `Could not apply: ${(err as Error).message}` };
  }
  const [req] = await db.select().from(s.users).where(eq(s.users.id, cr.requestedBy));
  await sendMail({
    to: req?.email ?? [],
    subject: `${ENTITY_LABEL[cr.entity]} change #${id} ${approve ? "approved" : "rejected"}${ref ? ` — ${ref}` : ""}`,
    html: `<p>${esc(user.name)} ${approve ? "approved" : "rejected"} your change.</p><p>${summary(cr.entity, cr.action, cr.data)}</p>${comment ? `<p><b>Comment:</b> ${esc(comment)}</p>` : ""}<p><a href="${appUrl(`/changes/${id}`)}">Open change #${id}</a></p>`,
  });
  return { ok: true, id, ref: ref ?? undefined };
}

export async function nudgeChange(user: User, id: number): Promise<ChangeResult> {
  const db = await getDb();
  const [cr] = await db.select().from(s.changeRequests).where(eq(s.changeRequests.id, id));
  if (!cr || cr.status !== "pending" || cr.requestedBy !== user.id) return { ok: false, errors: {}, message: "Nothing to nudge." };
  if (cr.lastNudgeAt && Date.now() - cr.lastNudgeAt.getTime() < NUDGE_HOURS * 3600_000)
    return { ok: false, errors: {}, message: `Already nudged — try again after ${NUDGE_HOURS} hours.` };
  await db.update(s.changeRequests).set({ lastNudgeAt: new Date() }).where(eq(s.changeRequests.id, id));
  await notifyMaster(id, cr.entity, cr.action, user.name, cr.data, "is still waiting (reminder)");
  return { ok: true, id };
}

export async function withdrawChange(user: User, id: number): Promise<ChangeResult> {
  const db = await getDb();
  const res = await db.update(s.changeRequests).set({ status: "withdrawn", decidedAt: new Date() })
    .where(and(eq(s.changeRequests.id, id), eq(s.changeRequests.requestedBy, user.id), eq(s.changeRequests.status, "pending"))).returning();
  return res.length ? { ok: true, id } : { ok: false, errors: {}, message: "Cannot withdraw." };
}

export { todayIso };
