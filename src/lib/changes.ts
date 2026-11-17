import "server-only";
import { and, asc, eq, inArray, max, or, sql } from "drizzle-orm";
import { getDb, schema as s, type DB } from "./db";
import { appUrl, sendMail } from "./mail";
import { activeModes, currentPeriods, expHeadList, todayIso, usersByRole } from "./data";
import { str } from "./calc/excel";
import { parseDate } from "./validate";
import type { User } from "./auth";
import { COMPANY } from "./company";
import { resyncEmployees } from "./empSync";
import { lineDocNo, splitDocNo, validDocBase } from "./docNo";

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
  create: "New entry", update: "Edit", delete: "Delete", create_doc: "New document", update_doc: "Edit document", delete_doc: "Delete document", merge_docs: "Merge entries into one document", split_line: "Split a line into its own document", change: "Effective change", correct: "Correct details", exit: "Exit",
};

// =================================================================== Exp

export const EXP_FIELDS = ["payDate", "valueDate", "head", "mode", "rp", "gross", "gst", "tds", "branch", "bkgId", "emp", "project", "narration", "remarks", "purpose", "paymentMode", "instrNo", "instrDate", "chqBank"] as const;
export type ExpData = Record<(typeof EXP_FIELDS)[number], string | number | null>;

export async function normalizeExp(raw: Record<string, unknown>, selfId?: number | null): Promise<{ data: ExpData; errors: Errors }> {
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
    purpose: txt(raw.purpose),
    paymentMode: txt(raw.paymentMode),
    instrNo: txt(raw.instrNo),
    instrDate: txt(raw.instrDate) ? parseDate(raw.instrDate) ?? null : null,
    chqBank: txt(raw.chqBank),
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
  // Cheque / UTR details belong to Mode = Chq only
  if (str(d.mode).toLowerCase() === "chq") {
    if (!d.purpose) e.purpose = "Purpose is required for a Chq entry";
    if (!d.paymentMode) e.paymentMode = "PaymentMode is required (Cheque, RTGS, UPI...)";
    if (!d.instrNo) e.instrNo = "Chq / UTR No is required";
    if (!isDate(d.instrDate)) e.instrDate = "Chq / UTR Date is required";
  } else {
    d.purpose = d.paymentMode = d.instrNo = d.instrDate = d.chqBank = null;
  }
  if (d.instrNo && d.instrDate && d.gross !== null && !e.instrNo) {
    const dup = await db.select({ id: s.expEntries.id, docNo: s.expEntries.docNo }).from(s.expEntries)
      .where(and(sql`lower(${s.expEntries.instrNo}) = ${str(d.instrNo).toLowerCase()}`, eq(s.expEntries.instrDate, str(d.instrDate)), eq(s.expEntries.gross, d.gross as number), eq(s.expEntries.rp, str(d.rp))))
      .limit(3);
    const other = dup.find((x) => x.id !== selfId);
    if (other) e.instrNo = `Looks like a duplicate of ${other.docNo ?? "entry #" + other.id} (same Chq/UTR No, date and amount)`;
  }
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

/** Chq entries are numbered Chq-00001...; everything else RP00001... */
async function nextDocNo(tx: Tx, mode: string | null): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(424243)`);
  const prefix = str(mode).toLowerCase() === "chq" ? "Chq-" : "RP";
  const r = await tx.execute(sql`select max((substring(doc_no from ${prefix.length + 1}::int))::int) as n from exp_entries where doc_no ~ ${"^" + prefix + "[0-9]+$"}`);
  const rows = ("rows" in r ? r.rows : r) as { n: number | null }[];
  return `${prefix}${String((rows[0]?.n ?? 0) + 1).padStart(5, "0")}`;
}

async function applyExp(tx: Tx, action: string, targetId: number | null, d: ExpData, userId: number): Promise<string> {
  if (action === "merge_docs") return applyMerge(tx, d as never);
  if (action === "split_line") return applySplit(tx, d as never);
  if (action.endsWith("_doc")) return applyExpDoc(tx, action, d as unknown as ExpDocData, userId);
  if (action === "create") {
    const docNo = await nextDocNo(tx, d.mode as string | null);
    await tx.insert(s.expEntries).values({ ...(d as Record<string, unknown>), docNo, docBase: docNo, lineNo: null, createdBy: userId } as never);
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
    const n = await normalizeExp(raw, targetId ?? null);
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
    data = { ...f, emp, status: f.status ?? "Active", company: f.company ?? COMPANY.empCompany, applicable: f.applicable ?? "Y" };
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

/** Applies an Emp change, then recomputes the derived columns (Director, chain, seat cost...) of every row. */
async function applyEmp(tx: Tx, action: string, d: Record<string, unknown>): Promise<string> {
  const ref = await applyEmpAction(tx, action, d);
  await resyncEmployees(tx);
  return ref;
}

async function applyEmpAction(tx: Tx, action: string, d: Record<string, unknown>): Promise<string> {
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

// =================================================================== Exp documents (one transaction, many lines)

export type ExpDocLine = ExpData & { id?: number };
export interface ExpDocData { docBase: string | null; lines: ExpDocLine[] }
const MAX_DOC_LINES = 300;

/** All lines of a document, in line order. The base also matches rows imported without a doc_base. */
export async function docLines(db: DB | Tx, base: string) {
  return db.select().from(s.expEntries)
    .where(or(eq(s.expEntries.docBase, base), and(sql`${s.expEntries.docBase} is null`, eq(s.expEntries.docNo, base))))
    .orderBy(asc(s.expEntries.lineNo), asc(s.expEntries.id));
}

/** Validates every line (header defaults are already merged in by the form) and, for a new document, the typed number. */
export async function normalizeExpDoc(raw: Record<string, unknown>, existingBase: string | null): Promise<{ data: ExpDocData; errors: Errors }> {
  const db = await getDb();
  const errors: Errors = {};
  const rawLines = Array.isArray(raw.lines) ? (raw.lines as Record<string, unknown>[]) : [];
  if (!rawLines.length) errors.lines = "Add at least one line";
  if (rawLines.length > MAX_DOC_LINES) errors.lines = `A document can have up to ${MAX_DOC_LINES} lines`;

  let docBase: string | null = existingBase;
  if (!existingBase) {
    const typed = txt(raw.docNo);
    if (typed) {
      if (!validDocBase(typed)) errors.docNo = "Use letters, digits and - _ . / only (2 to 40 characters)";
      else {
        const clash = await db.select({ id: s.expEntries.id }).from(s.expEntries)
          .where(or(sql`lower(${s.expEntries.docBase}) = ${typed.toLowerCase()}`, sql`lower(${s.expEntries.docNo}) = ${typed.toLowerCase()}`)).limit(1);
        if (clash.length) errors.docNo = "This document number is already used";
        docBase = typed;
      }
    }
  }

  const lines: ExpDocLine[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.min(rawLines.length, MAX_DOC_LINES); i++) {
    const rl = rawLines[i];
    const id = typeof rl.id === "number" ? rl.id : undefined;
    const n = await normalizeExp(rl, id ?? null);
    for (const [k, v] of Object.entries(n.errors)) errors[`line.${i}.${k}`] = v;
    if (n.data.instrNo && n.data.instrDate) {
      const key = [str(n.data.instrNo).toLowerCase(), n.data.instrDate, n.data.gross, n.data.rp].join("|");
      if (seen.has(key)) errors[`line.${i}.instrNo`] = "Same Chq/UTR No, date and amount appears twice in this document";
      seen.add(key);
    }
    lines.push({ ...n.data, ...(id !== undefined ? { id } : {}) });
  }
  return { data: { docBase, lines }, errors };
}

/** Next document number: Chq-nnnnn for a Chq document, RPnnnnn otherwise (looks at document numbers, not lines). */
async function nextDocBase(tx: Tx, mode: string | null): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(424243)`);
  const prefix = str(mode).toLowerCase() === "chq" ? "Chq-" : "RP";
  const r = await tx.execute(sql`select max((substring(doc_base from ${prefix.length + 1}::int))::int) as n from exp_entries where doc_base ~ ${"^" + prefix + "[0-9]+$"}`);
  const rows = ("rows" in r ? r.rows : r) as { n: number | null }[];
  return `${prefix}${String((rows[0]?.n ?? 0) + 1).padStart(5, "0")}`;
}

const lineValues = (l: ExpDocLine) => Object.fromEntries(EXP_FIELDS.map((k) => [k, l[k] ?? null]));

async function applyExpDoc(tx: Tx, action: string, d: ExpDocData, userId: number): Promise<string> {
  if (action === "create_doc") {
    const base = d.docBase ?? (await nextDocBase(tx, d.lines[0]?.mode as string | null));
    const clash = await tx.select({ id: s.expEntries.id }).from(s.expEntries).where(or(eq(s.expEntries.docBase, base), eq(s.expEntries.docNo, base))).limit(1);
    if (clash.length) throw new Error(`Document ${base} already exists`);
    const single = d.lines.length === 1;
    await tx.insert(s.expEntries).values(d.lines.map((l, i) => ({
      ...lineValues(l), docBase: base, lineNo: single ? null : i + 1, docNo: single ? base : lineDocNo(base, i + 1), createdBy: userId,
    })) as never);
    return base;
  }

  const base = d.docBase;
  if (!base) throw new Error("Document number missing");
  const cur = await docLines(tx, base);
  if (!cur.length) throw new Error(`Document ${base} no longer exists`);
  if (action === "delete_doc") {
    await tx.delete(s.expEntries).where(inArray(s.expEntries.id, cur.map((c) => c.id)));
    await tx.delete(s.expAttachments).where(eq(s.expAttachments.docBase, base));
    return base;
  }
  // update_doc: lines with an id are edited, lines without one are added, lines left out are removed
  const keep = new Set(d.lines.filter((l) => l.id !== undefined).map((l) => l.id!));
  for (const l of d.lines) if (l.id !== undefined && !cur.some((c) => c.id === l.id)) throw new Error("A line of this document was changed or removed meanwhile - reopen it");
  const gone = cur.filter((c) => !keep.has(c.id)).map((c) => c.id);
  if (gone.length) await tx.delete(s.expEntries).where(inArray(s.expEntries.id, gone));
  for (const l of d.lines) {
    if (l.id !== undefined) await tx.update(s.expEntries).set({ ...lineValues(l), updatedAt: new Date() } as never).where(eq(s.expEntries.id, l.id));
  }
  let next = Math.max(0, ...cur.map((c) => c.lineNo ?? 0)) + 1;
  for (const l of d.lines.filter((x) => x.id === undefined)) {
    let docNo = lineDocNo(base, next);
    while (await tx.select({ id: s.expEntries.id }).from(s.expEntries).where(eq(s.expEntries.docNo, docNo)).then((r) => r.length)) docNo = lineDocNo(base, ++next);
    await tx.insert(s.expEntries).values({ ...lineValues(l), docBase: base, lineNo: next, docNo, createdBy: userId } as never);
    next++;
  }
  return base;
}

export async function requestExpDoc(user: User, action: "create_doc" | "update_doc" | "delete_doc", raw: Record<string, unknown>, base?: string | null): Promise<ChangeResult> {
  if (user.role !== "admin" && user.role !== "master") return { ok: false, errors: {}, message: "Only Admin or Master can change Exp." };
  const db = await getDb();
  let before: Record<string, unknown> | null = null;
  let existing: Awaited<ReturnType<typeof docLines>> = [];
  if (action !== "create_doc") {
    if (!base) return { ok: false, errors: {}, message: "Document not found" };
    existing = await docLines(db, base);
    if (!existing.length) return { ok: false, errors: {}, message: "Document not found" };
    before = { docBase: base, lines: existing };
  }
  if (action === "delete_doc") return submit(user, "exp", action, null, { docBase: base, lines: existing } as never, before);
  const n = await normalizeExpDoc(raw, action === "update_doc" ? base ?? null : null);
  if (Object.keys(n.errors).length) return { ok: false, errors: n.errors };
  return submit(user, "exp", action, null, n.data as never, before);
}

/** Master bulk upload: every document is created in one transaction (all or nothing) and the upload is logged once in the audit log. */
export async function bulkCreateExpDocs(user: User, docs: ExpDocData[], fileName: string): Promise<string[]> {
  if (user.role !== "master") throw new Error("Only Master can bulk upload Exp.");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const bases: string[] = [];
    for (const d of docs) bases.push(await applyExpDoc(tx, "create_doc", d, user.id));
    await tx.insert(s.auditLog).values({ userId: user.id, action: "bulk_exp_upload", detail: { fileName, documents: bases.length, lines: docs.reduce((a, d) => a + d.lines.length, 0), docNos: bases } });
    return bases;
  });
}

// =================================================================== merge entries into one document / split a line out

export const MERGE_MIN = 2;
export const MERGE_MAX = 10;
type ExpRowDb = typeof s.expEntries.$inferSelect;
const baseOf = (r: ExpRowDb) => r.docBase ?? r.docNo ?? String(r.id);

/** The entry numbered first (lowest id) gives its document number to the merged document. */
export async function previewMerge(db: DB | Tx, ids: number[]) {
  const uniq = [...new Set(ids)];
  if (uniq.length < MERGE_MIN || uniq.length > MERGE_MAX) return { ok: false as const, message: `Select ${MERGE_MIN} to ${MERGE_MAX} entries` };
  const sel = (await db.select().from(s.expEntries).where(inArray(s.expEntries.id, uniq))).sort((a, b) => a.id - b.id);
  if (sel.length !== uniq.length) return { ok: false as const, message: "Some selected entries no longer exist - reload the list" };
  const base = baseOf(sel[0]);
  const cur = await docLines(db, base);
  const already = new Set(cur.map((c) => c.id));
  let next = Math.max(0, ...cur.map((c) => c.lineNo ?? 0), cur.length > 1 || sel[0].lineNo !== null ? 0 : 1) + 1;
  const plan = sel.map((r) => {
    if (r.id === sel[0].id) return { id: r.id, was: r.docNo ?? "", will: r.lineNo === null ? lineDocNo(base, 1) : r.docNo ?? "", row: r };
    if (already.has(r.id)) return { id: r.id, was: r.docNo ?? "", will: r.docNo ?? "", row: r };
    return { id: r.id, was: r.docNo ?? "", will: lineDocNo(base, next++), row: r };
  });
  const fromBases = [...new Set(sel.map(baseOf).filter((b) => b !== base))];
  const taken = await db.select({ id: s.expEntries.id, docNo: s.expEntries.docNo }).from(s.expEntries).where(inArray(s.expEntries.docNo, plan.map((x) => x.will).filter(Boolean)));
  const clash = taken.find((t) => !uniq.includes(t.id));
  if (clash) return { ok: false as const, message: `The number ${clash.docNo} is already used by another entry; open that document first` };
  return { ok: true as const, base, plan, fromBases };
}

export async function requestMerge(user: User, ids: number[]): Promise<ChangeResult> {
  if (user.role !== "admin" && user.role !== "master") return { ok: false, errors: {}, message: "Only Admin or Master can change Exp." };
  const db = await getDb();
  const p = await previewMerge(db, ids);
  if (!p.ok) return { ok: false, errors: {}, message: p.message };
  const lines = p.plan.map((x) => ({ ...Object.fromEntries(EXP_FIELDS.map((k) => [k, x.row[k] ?? null])), id: x.id, docNo: x.was }));
  return submit(user, "exp", "merge_docs", null, { docBase: p.base, ids: p.plan.map((x) => x.id), mergedBases: p.fromBases, lines } as never, { docBase: p.base, lines: p.plan.map((x) => ({ id: x.id, docNo: x.was })) });
}

async function applyMerge(tx: Tx, d: { ids?: number[] }): Promise<string> {
  const p = await previewMerge(tx, d.ids ?? []);
  if (!p.ok) throw new Error(p.message);
  const first = p.plan[0];
  if (first.will !== first.was) await tx.update(s.expEntries).set({ docBase: p.base, lineNo: 1, docNo: first.will, updatedAt: new Date() }).where(eq(s.expEntries.id, first.id));
  for (const x of p.plan.slice(1)) {
    if (x.will === x.was) continue;
    const n = splitDocNo(x.will).line;
    await tx.update(s.expEntries).set({ docBase: p.base, lineNo: n, docNo: x.will, updatedAt: new Date() }).where(eq(s.expEntries.id, x.id));
  }
  // files attached to a document that no longer has any line follow the merged document
  for (const b of p.fromBases) {
    if (!(await docLines(tx, b)).length) await tx.update(s.expAttachments).set({ docBase: p.base }).where(eq(s.expAttachments.docBase, b));
  }
  return p.base;
}

/** Takes one line out of a multi-line document and makes it a document of its own (automatic number). */
export async function requestSplit(user: User, lineId: number): Promise<ChangeResult> {
  if (user.role !== "admin" && user.role !== "master") return { ok: false, errors: {}, message: "Only Admin or Master can change Exp." };
  const db = await getDb();
  const [line] = await db.select().from(s.expEntries).where(eq(s.expEntries.id, lineId));
  if (!line) return { ok: false, errors: {}, message: "Entry not found" };
  const base = baseOf(line);
  const siblings = await docLines(db, base);
  if (siblings.length < 2) return { ok: false, errors: {}, message: "This document has only one line" };
  const row = { ...Object.fromEntries(EXP_FIELDS.map((k) => [k, line[k] ?? null])), id: line.id, docNo: line.docNo };
  return submit(user, "exp", "split_line", null, { docBase: base, lineId, lines: [row] } as never, { docBase: base, lines: siblings.map((x) => ({ id: x.id, docNo: x.docNo })) });
}

async function applySplit(tx: Tx, d: { lineId?: number }): Promise<string> {
  const [line] = await tx.select().from(s.expEntries).where(eq(s.expEntries.id, d.lineId ?? -1));
  if (!line) throw new Error("The line no longer exists");
  if ((await docLines(tx, baseOf(line))).length < 2) throw new Error("The document has only one line now");
  const base = await nextDocBase(tx, line.mode);
  await tx.update(s.expEntries).set({ docBase: base, lineNo: null, docNo: base, updatedAt: new Date() }).where(eq(s.expEntries.id, line.id));
  return base;
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
  if (entity === "exp" && Array.isArray(d.lines)) {
    const ls = d.lines as ExpDocLine[];
    const net = ls.reduce((a, l) => a + (l.rp === "Receipt" ? 1 : -1) * (Number(l.gross) || 0), 0);
    return `${ACTION_LABEL[action]} — ${esc(d.docBase ?? "(new number)")} · ${ls.length} lines · net ₹${net}`;
  }
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
