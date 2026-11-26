"use server";
import { canUploadEmp } from "@/lib/company";
import { revalidatePath as revalidate } from "next/cache";
import { bumpData } from "@/lib/cache";

// every save refreshes the cached calculations as well as the pages
const revalidatePath: typeof revalidate = (path, type) => {
  bumpData();
  revalidate(path, type);
};
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { normEmail, requestOtp, requireUser, signOut, verifyOtp, type Role } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import * as wf from "@/lib/workflow";
import { parseCombined, parseUpload } from "@/lib/bulk";
import { checkBkgUpload, type BkgUploadCounts, type BkgUploadRow } from "@/lib/bkgUpload";
import { checkExpUpload, type ExpBulkCounts, type ExpBulkRow } from "@/lib/bulkExp";

// ---- sign-in
export async function sendCodeAction(email: string) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return { ok: false, message: "Enter a valid email" };
  await requestOtp(email);
  return { ok: true };
}
export async function verifyCodeAction(email: string, code: string) {
  const ok = await verifyOtp(email, code);
  if (!ok) return { ok: false, message: "That code is wrong or expired. Request a new one." };
  redirect("/");
}
export async function signOutAction() {
  await signOut();
  redirect("/login");
}

// ---- SCD
export async function submitScdAction(data: Record<string, unknown>) {
  const user = await requireUser();
  const r = await wf.submitScd(data, user);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
export async function saveScdAction(id: number, data: Record<string, unknown>) {
  const user = await requireUser();
  const r = user.role === "sales" || (await isOwnReturned(id, user.id)) ? await wf.resubmitScd(id, data, user) : await wf.editPending(id, data, user);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
async function isOwnReturned(id: number, uid: number) {
  const db = await getDb();
  const [sub] = await db.select().from(s.submissions).where(eq(s.submissions.id, id));
  return !!sub && sub.submittedBy === uid && sub.status === "returned";
}
export async function decideAction(id: number, decision: wf.Decision, comment: string) {
  const user = await requireUser(["admin", "master"]);
  const r = await wf.decide(id, decision, comment, user);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
export async function nudgeAction(id: number) {
  const user = await requireUser();
  const r = await wf.nudge(id, user);
  revalidatePath(`/submissions/${id}`);
  return r;
}
export async function superiorRequestAction(id: number, email: string, note: string) {
  const user = await requireUser(["master"]);
  const r = await wf.requestSuperior(id, email, note, user);
  revalidatePath(`/submissions/${id}`);
  return r;
}
export async function superiorDecideAction(token: string, decision: "approved" | "rejected", comment: string) {
  return wf.superiorDecide(token, decision, comment);
}

// ---- bulk upload (Master only)
async function readFile(form: FormData, kind?: "bkg" | "exp") {
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) throw new Error("Choose a CSV or XLSX file");
  if (f.size > 5_000_000) throw new Error("File is larger than 5 MB");
  return { name: f.name, rows: await parseUpload(f.name, await f.arrayBuffer(), kind) };
}
// ---- Bkg upload: add new bookings and / or correct existing ones (Master applies at once, Admin needs Master approval)
const bkgOpts = (form: FormData) => ({ allowAdd: form.get("allowAdd") === "1", allowUpdate: form.get("allowUpdate") === "1" });
export async function bkgUploadCheckAction(form: FormData): Promise<{ ok: boolean; message?: string; rows?: BkgUploadRow[]; warnings?: string[]; counts?: BkgUploadCounts }> {
  await requireUser(["admin", "master"]);
  try {
    const { rows } = await readFile(form, "bkg");
    const res = await checkBkgUpload(rows, bkgOpts(form));
    return { ok: true, rows: res.rows, warnings: res.warnings, counts: res.counts };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
export async function bkgUploadCommitAction(form: FormData): Promise<{ ok: boolean; message?: string; applied?: boolean; id?: number; counts?: BkgUploadCounts }> {
  const user = await requireUser(["admin", "master"]);
  try {
    const { name, rows } = await readFile(form, "bkg");
    const res = await checkBkgUpload(rows, bkgOpts(form));
    if (res.rows.some((r) => Object.keys(r.errors).length)) return { ok: false, message: "Some rows have errors - check again." };
    const r = await ch.requestBkgUpload(user, { fileName: name, creates: res.creates, updates: res.updates });
    if (!r.ok) return { ok: false, message: r.message ?? "Could not save." };
    revalidatePath("/", "layout");
    return { ok: true, applied: r.applied ?? false, id: r.id, counts: res.counts };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---- Exp upload: add new transactions and / or change existing lines (Master applies at once, Admin needs Master approval)
const expOpts = (form: FormData) => ({ allowAdd: form.get("allowAdd") === "1", allowUpdate: form.get("allowUpdate") === "1" });
export async function bulkExpCheckAction(form: FormData): Promise<{ ok: boolean; message?: string; rows?: ExpBulkRow[]; warnings?: string[]; counts?: ExpBulkCounts }> {
  await requireUser(["admin", "master"]);
  try {
    const { rows } = await readFile(form, "exp");
    const res = await checkExpUpload(rows, expOpts(form));
    return { ok: true, rows: res.rows, warnings: res.warnings, counts: res.counts };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
export async function bulkExpCommitAction(form: FormData): Promise<{ ok: boolean; message?: string; applied?: boolean; id?: number; counts?: ExpBulkCounts }> {
  const user = await requireUser(["admin", "master"]);
  try {
    const { name, rows } = await readFile(form, "exp");
    const res = await checkExpUpload(rows, expOpts(form));
    if (res.rows.some((r) => Object.keys(r.errors).length)) return { ok: false, message: "Some rows have errors - check again." };
    const r = await ch.requestExpUpload(user, { fileName: name, creates: res.creates, updates: res.updates, adds: res.adds, merges: res.merges }, res.before);
    if (!r.ok) return { ok: false, message: r.message ?? "Could not save." };
    revalidatePath("/", "layout");
    return { ok: true, applied: r.applied ?? false, id: r.id, counts: res.counts };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---- users (Master only)
export async function saveUserAction(input: { id?: number; email: string; name: string; role: Role; empCode: string; active: boolean }) {
  const me = await requireUser(["master"]);
  const db = await getDb();
  const email = normEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !input.name.trim()) return { ok: false, message: "Name and a valid email are required" };
  if (input.role === "master" && email !== me.email) return { ok: false, message: "There is only one Master account" };
  if (input.id === me.id && (!input.active || input.role !== "master")) return { ok: false, message: "You cannot demote or disable your own Master account" };
  const values = { email, name: input.name.trim(), role: input.role, empCode: input.empCode.trim() || null, active: input.active };
  try {
    if (input.id) await db.update(s.users).set(values).where(eq(s.users.id, input.id));
    else await db.insert(s.users).values(values);
  } catch {
    return { ok: false, message: "That email is already a user" };
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

// ---- Exp / Emp change requests
import * as ch from "@/lib/changes";
import { adaptCombinedEmp, checkEmpUpload, prepareEmpUpload, type EmpUploadRow } from "@/lib/empUpload";

export async function expRequestAction(action: "create" | "update" | "delete", data: Record<string, unknown>, targetId?: number) {
  const user = await requireUser(["admin", "master"]);
  const r = await ch.requestExp(user, action, data, targetId);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
export async function expDocAction(action: "create_doc" | "update_doc" | "delete_doc", data: Record<string, unknown>, base?: string | null) {
  const user = await requireUser(["admin", "master"]);
  const r = await ch.requestExpDoc(user, action, data, base);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
export async function empRequestAction(action: "create" | "change" | "correct" | "exit", data: Record<string, unknown>) {
  const user = await requireUser(["hr", "master"]);
  const r = await ch.requestEmp(user, action, data);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
export async function decideChangeAction(id: number, approve: boolean, comment: string) {
  const user = await requireUser(["master"]);
  const r = await ch.decideChange(user, id, approve, comment);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
export async function nudgeChangeAction(id: number) {
  const user = await requireUser();
  return ch.nudgeChange(user, id);
}
export async function withdrawChangeAction(id: number) {
  const user = await requireUser();
  const r = await ch.withdrawChange(user, id);
  revalidatePath("/", "layout");
  return r;
}

// ---- Projection targets (Master only)
export async function saveProjectionAction(year: number, rows: { empCode: string; manMonths: number | null; bkgCount: number | null; directorRevenue: number | null; remarks: string | null }[]) {
  await requireUser(["master"]);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, message: "Choose a valid year" };
  const db = await getDb();
  const emps = new Set((await db.selectDistinct({ e: s.employees.emp }).from(s.employees)).map((x) => (x.e.split("~")[1] ?? "").toLowerCase()));
  const errors: string[] = [];
  rows.forEach((r, i) => {
    if (!r.empCode || !emps.has(r.empCode.trim().toLowerCase())) errors.push(`Row ${i + 1}: ${r.empCode || "employee code"} is not in Emp`);
    for (const v of [r.manMonths, r.bkgCount, r.directorRevenue]) if (v !== null && (!Number.isFinite(v) || v < 0)) errors.push(`Row ${i + 1}: figures must be positive numbers`);
  });
  if (errors.length) return { ok: false, message: errors.slice(0, 5).join(" · ") };
  await db.transaction(async (tx) => {
    await tx.delete(s.projections).where(eq(s.projections.year, year));
    if (rows.length)
      await tx.insert(s.projections).values(rows.map((r, i) => ({
        year, seq: i, empCode: r.empCode.trim(), manMonths: r.manMonths, bkgCount: r.bkgCount, directorRevenue: r.directorRevenue, remarks: r.remarks?.trim() || null,
      })));
  });
  revalidatePath("/reports/projection");
  revalidatePath("/admin/projection");
  return { ok: true, message: `Saved ${rows.length} rows for ${year}` };
}

// ---- Masters (Master only)
export async function saveModeAction(name: string, active: boolean) {
  await requireUser(["master"]);
  const n = name.trim();
  if (!n) return { ok: false, message: "Enter a mode name" };
  const db = await getDb();
  await db.insert(s.modes).values({ name: n, active }).onConflictDoUpdate({ target: s.modes.name, set: { active } });
  revalidatePath("/admin/masters");
  return { ok: true };
}
export async function saveHeadAction(head: string, type: string) {
  await requireUser(["master"]);
  const h = head.trim();
  if (!h || !type.trim()) return { ok: false, message: "Enter head and type" };
  const db = await getDb();
  await db.insert(s.expHeads).values({ head: h, type: type.trim() }).onConflictDoUpdate({ target: s.expHeads.head, set: { type: type.trim() } });
  revalidatePath("/admin/masters");
  return { ok: true };
}

export async function savePartnersAction(list: string[]) {
  await requireUser(["master"]);
  const clean = [...new Set(list.map((x) => x.trim()).filter(Boolean))];
  const db = await getDb();
  const names = new Set((await db.selectDistinct({ emp: s.employees.emp }).from(s.employees)).map((e) => e.emp));
  const bad = clean.filter((x) => !names.has(x));
  if (bad.length) return { ok: false, message: `Not found in Emp: ${bad.join(", ")}` };
  const { setSetting } = await import("@/lib/data");
  await setSetting("partners", JSON.stringify(clean));
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---- Exp drafts (a half-entered document, private to its author)
export async function saveDraftAction(id: number | null, title: string, data: Record<string, unknown>) {
  const user = await requireUser(["admin", "master"]);
  const db = await getDb();
  const t = title.trim().slice(0, 80) || "Untitled draft";
  if (JSON.stringify(data).length > 600_000) return { ok: false as const, message: "This draft is too large to save" };
  if (id) {
    const res = await db.update(s.expDrafts).set({ title: t, data, updatedAt: new Date() }).where(and(eq(s.expDrafts.id, id), eq(s.expDrafts.userId, user.id))).returning({ id: s.expDrafts.id });
    if (res.length) return { ok: true as const, id };
  }
  const [row] = await db.insert(s.expDrafts).values({ userId: user.id, title: t, data }).returning({ id: s.expDrafts.id });
  return { ok: true as const, id: row.id };
}
export async function deleteDraftAction(id: number) {
  const user = await requireUser(["admin", "master"]);
  const db = await getDb();
  await db.delete(s.expDrafts).where(and(eq(s.expDrafts.id, id), eq(s.expDrafts.userId, user.id)));
  revalidatePath("/exp/new");
  return { ok: true };
}

// ---- Clean-up (Master approves one proposal at a time)
export async function applyCleanupAction(id: string, canonical?: string) {
  const user = await requireUser(["master"]);
  const { applyCleanup } = await import("@/lib/cleanup");
  const r = await applyCleanup(user.id, id, canonical);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

// ---- merge entries into one Exp document / split a line out
export async function mergePreviewAction(ids: number[]) {
  await requireUser(["admin", "master"]);
  const db = await getDb();
  const p = await ch.previewMerge(db, ids);
  if (!p.ok) return p;
  return { ok: true as const, base: p.base, rows: p.plan.map((x) => ({ id: x.id, was: x.was, will: x.will, payDate: x.row.payDate, head: x.row.head, rp: x.row.rp, gross: x.row.gross, narration: x.row.narration })) };
}
export async function mergeExpAction(ids: number[]) {
  const user = await requireUser(["admin", "master"]);
  const r = await ch.requestMerge(user, ids);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
export async function renameExpDocAction(oldBase: string, newBase: string) {
  const user = await requireUser(["master"]);
  const r = await ch.requestRename(user, oldBase, newBase);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
export async function splitExpLineAction(lineId: number) {
  const user = await requireUser(["admin", "master"]);
  const r = await ch.requestSplit(user, lineId);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

// ---- Project / Inventory / Price list masters (TRPL; Admin and Master, applied at once - they only suggest values on a booking)
import { applyMasterUpload, checkMasterUpload, deleteMasterRow, saveMasterRow, seedProjectsFromBkg, syncBookingsToProjects, type MasterCheck, type MasterCheckRow } from "@/lib/masterData";
import { isMasterKind } from "@/lib/masterDefs";

type MasterCheckRes = { ok: boolean; message?: string; rows?: MasterCheckRow[]; warnings?: string[]; counts?: MasterCheck["counts"]; applied?: boolean };
let masterUserId = 0;
async function masterGuard(kind: string) {
  masterUserId = (await requireUser(["admin", "master"])).id;
  if (!isMasterKind(kind)) throw new Error("Unknown master");
  return kind;
}
export async function masterRowSaveAction(kind: string, id: string | null, input: Record<string, unknown>) {
  try {
    const k = await masterGuard(kind);
    const uid = masterUserId;
    const r = await saveMasterRow(k, id, input);
    if (r.ok && k === "projects") {
      const n = (await syncBookingsToProjects(uid, "Project Master: " + String(input.name ?? ""))).bookings;
      if (n) r.message = n + " booking(s) updated with the new Builder / Location.";
    }
    if (r.ok) revalidatePath("/", "layout");
    return r;
  } catch (e) {
    return { ok: false, message: (e as Error).message } as { ok: boolean; errors?: Record<string, string>; message?: string };
  }
}
export async function masterRowDeleteAction(kind: string, id: string) {
  try {
    const k = await masterGuard(kind);
    await deleteMasterRow(k, id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
export async function masterUploadAction(kind: string, form: FormData, commit: boolean): Promise<MasterCheckRes> {
  try {
    const k = await masterGuard(kind);
    const { rows } = await readFile(form);
    const res = await checkMasterUpload(k, rows);
    const out = { ok: true, rows: res.rows, warnings: res.warnings, counts: res.counts };
    if (!commit) return out;
    if (res.rows.some((r) => Object.keys(r.errors).length)) return { ...out, ok: false, message: "Some rows have errors - check again." };
    if (!res.creates.length && !res.updates.length) return { ...out, ok: false, message: "Nothing to add or change in this file." };
    const uid = masterUserId;
    await applyMasterUpload(k, res);
    let message: string | undefined;
    if (k === "projects") {
      const n = (await syncBookingsToProjects(uid, "Project Master upload")).bookings;
      if (n) message = n + " booking(s) updated with the new Builder / Location.";
    }
    revalidatePath("/", "layout");
    return { ...out, applied: true, message };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
export async function syncBookingsAction() {
  try {
    await masterGuard("projects");
    const n = (await syncBookingsToProjects(masterUserId, "Project Master applied to all bookings")).bookings;
    revalidatePath("/", "layout");
    return { ok: true, bookings: n };
  } catch (e) {
    return { ok: false, bookings: 0, message: (e as Error).message };
  }
}
export async function projectsFromBkgAction() {
  try {
    await masterGuard("projects");
    const r = await seedProjectsFromBkg(); // one time only
    revalidatePath("/", "layout");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---- Edit one booking on the form (Master saves at once; Admin's change goes to Master for approval)
import { editRow } from "@/lib/bkgUpload";
import { normalize } from "@/lib/validate";
export async function bkgEditAction(bkgId: string, data: Record<string, unknown>): Promise<{ ok: boolean; applied?: boolean; id?: number; errors?: Record<string, string>; message?: string }> {
  const user = await requireUser(["admin", "master"]);
  try {
    const db = await getDb();
    const [b] = await db.select().from(s.bookings).where(eq(s.bookings.bkgId, bkgId));
    if (!b) return { ok: false, message: "Booking not found." };
    const stored = normalize(b.data as Record<string, unknown>);
    const form = normalize(data);
    const row = editRow(b.bkgId, stored, form);
    const res = await checkBkgUpload([row], { allowAdd: false, allowUpdate: true });
    const r = res.rows[0];
    if (Object.keys(r.errors).length) return { ok: false, errors: r.errors, message: "Please fix the highlighted fields: " + Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(" · ") };
    if (!res.updates.length) return { ok: false, message: "Nothing was changed." };
    const out = await ch.requestBkgUpload(user, { fileName: `Edit of ${b.bkgId} on the form`, creates: [], updates: res.updates });
    if (!out.ok) return { ok: false, message: out.message ?? "Could not save." };
    revalidatePath("/", "layout");
    return { ok: true, applied: out.applied ?? false, id: out.id };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---- Emp upload: new employees, history changes, corrections and exits (Master applies at once, HR needs Master approval)
export async function empUploadCheckAction(form: FormData): Promise<{ ok: boolean; message?: string; rows?: EmpUploadRow[]; warnings?: string[] }> {
  const user = await requireUser(["hr", "master"]);
  if (!canUploadEmp(user.role)) return { ok: false, message: "Only Master can upload Emp." };
  try {
    const { rows } = await readFile(form);
    const p = await prepareEmpUpload(rows);
    if (!p.rows.length) return { ok: false, message: `Nothing to upload: no row has an Action, or no cell differs from the stored value.${p.warnings.length ? " " + p.warnings[0] : ""}` };
    const res = await checkEmpUpload(p.rows, p.rowNos);
    return { ok: true, rows: res.rows, warnings: [...p.warnings, ...res.warnings] };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
export async function empUploadCommitAction(form: FormData): Promise<{ ok: boolean; message?: string; applied?: boolean; id?: number; count?: number }> {
  const user = await requireUser(["hr", "master"]);
  if (!canUploadEmp(user.role)) return { ok: false, message: "Only Master can upload Emp." };
  try {
    const { name, rows } = await readFile(form);
    const p = await prepareEmpUpload(rows);
    const res = await checkEmpUpload(p.rows, p.rowNos);
    if (res.rows.some((r) => Object.keys(r.errors).length)) return { ok: false, message: "Some rows have errors - check again." };
    const r = await ch.requestEmpUpload(user, name, res.items);
    if (!r.ok) return { ok: false, message: r.message ?? "Could not save." };
    revalidatePath("/", "layout");
    return { ok: true, applied: r.applied ?? false, id: r.id, count: res.items.length };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---- Combined upload: one .xlsx with the sheets Emp, Bkg and Exp (Master only). Applied in that order, each as its own logged change.
export interface AllSheetResult { sheet: "Emp" | "Bkg" | "Exp"; present: boolean; included: boolean; todo: number; summary: string; badRows: number; errors: string[]; warnings: string[] }
export interface AllCheckResult { ok: boolean; message?: string; sheets?: AllSheetResult[] }
export interface AllCommitResult { ok: boolean; message?: string; done?: { sheet: string; applied: boolean; id?: number; summary: string }[] }

const allFlags = (form: FormData) => ({
  Emp: form.get("includeEmp") === "1", Bkg: form.get("includeBkg") === "1", Exp: form.get("includeExp") === "1",
  allowAdd: form.get("allowAdd") === "1", allowUpdate: form.get("allowUpdate") === "1",
});
const errList = (rows: { row: number; errors: Record<string, string> }[]) => {
  const bad = rows.filter((r) => Object.keys(r.errors).length);
  return { badRows: bad.length, errors: bad.slice(0, 25).map((r) => `Row ${r.row}: ${Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(" · ")}`) };
};
async function readCombined(form: FormData) {
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) throw new Error("Choose the combined .xlsx file");
  if (!/\.xlsx$/i.test(f.name)) throw new Error("The combined upload needs an .xlsx file with the sheets Bkg, Exp and Emp");
  if (f.size > 5_500_000) throw new Error("File is larger than 5.5 MB - keep only the rows you changed or added");
  return { name: f.name, ...(await parseCombined(await f.arrayBuffer())) };
}

export async function allUploadCheckAction(form: FormData): Promise<AllCheckResult> {
  await requireUser(["master"]);
  try {
    const fl = allFlags(form);
    const file = await readCombined(form);
    const sheets: AllSheetResult[] = [];
    const empty = (sheet: AllSheetResult["sheet"]): AllSheetResult => ({ sheet, present: false, included: false, todo: 0, summary: "no such sheet (or no rows) in the file", badRows: 0, errors: [], warnings: [] });
    if (!file.emp && !file.bkg && !file.exp) throw new Error("No sheet named Bkg, Exp or Emp with rows was found in the file");

    if (!file.emp) sheets.push(empty("Emp"));
    else if (!fl.Emp) sheets.push({ ...empty("Emp"), present: true, summary: `${file.emp.length} row(s) - left out` });
    else {
      const a = await adaptCombinedEmp(file.emp);
      const r = await checkEmpUpload(a.rows, a.rowNos);
      sheets.push({ sheet: "Emp", present: true, included: true, todo: r.items.length, summary: `${r.items.length} change(s) from ${r.rows.length} row(s) with an Action`, ...errList(r.rows), warnings: [...a.warnings, ...r.warnings] });
    }
    if (!file.bkg) sheets.push(empty("Bkg"));
    else if (!fl.Bkg) sheets.push({ ...empty("Bkg"), present: true, summary: `${file.bkg.length} row(s) - left out` });
    else {
      const r = await checkBkgUpload(file.bkg, { allowAdd: fl.allowAdd, allowUpdate: fl.allowUpdate });
      sheets.push({ sheet: "Bkg", present: true, included: true, todo: r.counts.added + r.counts.changed, summary: `${r.counts.added} new · ${r.counts.changed} changed · ${r.counts.unchanged} unchanged`, ...errList(r.rows), warnings: r.warnings });
    }
    if (!file.exp) sheets.push(empty("Exp"));
    else if (!fl.Exp) sheets.push({ ...empty("Exp"), present: true, summary: `${file.exp.length} row(s) - left out` });
    else {
      const r = await checkExpUpload(file.exp, { allowAdd: fl.allowAdd, allowUpdate: fl.allowUpdate });
      sheets.push({ sheet: "Exp", present: true, included: true, todo: r.counts.newLines + r.counts.changed, summary: `${r.counts.newLines} new line(s) in ${r.counts.newDocs} document(s) · ${r.counts.changed} changed · ${r.counts.unchanged} unchanged`, ...errList(r.rows), warnings: r.warnings });
    }
    return { ok: true, sheets };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function allUploadCommitAction(form: FormData): Promise<AllCommitResult> {
  const user = await requireUser(["master"]);
  const done: NonNullable<AllCommitResult["done"]> = [];
  try {
    const fl = allFlags(form);
    const file = await readCombined(form);
    const fail = (sheet: string, message: string): AllCommitResult => ({ ok: false, message: `${sheet}: ${message}${done.length ? ` (already applied: ${done.map((d) => d.sheet).join(", ")})` : ""}`, done });
    // Emp first, so that the Bkg and Exp checks below see the new employees
    if (fl.Emp && file.emp) {
      const a = await adaptCombinedEmp(file.emp);
      const res = await checkEmpUpload(a.rows, a.rowNos);
      if (res.rows.some((r) => Object.keys(r.errors).length)) return fail("Emp", "some rows have errors - check again");
      if (res.items.length) {
        const r = await ch.requestEmpUpload(user, file.name, res.items);
        if (!r.ok) return fail("Emp", r.message ?? "could not save");
        done.push({ sheet: "Emp", applied: r.applied ?? false, id: r.id, summary: `${res.items.length} change(s)` });
      }
    }
    if (fl.Bkg && file.bkg) {
      const res = await checkBkgUpload(file.bkg, { allowAdd: fl.allowAdd, allowUpdate: fl.allowUpdate });
      if (res.rows.some((r) => Object.keys(r.errors).length)) return fail("Bkg", "some rows have errors - check again");
      if (res.counts.added + res.counts.changed) {
        const r = await ch.requestBkgUpload(user, { fileName: file.name, creates: res.creates, updates: res.updates });
        if (!r.ok) return fail("Bkg", r.message ?? "could not save");
        done.push({ sheet: "Bkg", applied: r.applied ?? false, id: r.id, summary: `${res.counts.added} new, ${res.counts.changed} changed` });
      }
    }
    if (fl.Exp && file.exp) {
      const res = await checkExpUpload(file.exp, { allowAdd: fl.allowAdd, allowUpdate: fl.allowUpdate });
      if (res.rows.some((r) => Object.keys(r.errors).length)) return fail("Exp", "some rows have errors - check again");
      if (res.counts.newLines + res.counts.changed) {
        const r = await ch.requestExpUpload(user, { fileName: file.name, creates: res.creates, updates: res.updates, adds: res.adds, merges: res.merges }, res.before);
        if (!r.ok) return fail("Exp", r.message ?? "could not save");
        done.push({ sheet: "Exp", applied: r.applied ?? false, id: r.id, summary: `${res.counts.newLines} new line(s), ${res.counts.changed} changed` });
      }
    }
    revalidatePath("/", "layout");
    return { ok: true, done };
  } catch (e) {
    return { ok: false, message: (e as Error).message, done };
  }
}
