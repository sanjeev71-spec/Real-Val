"use server";
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
import { checkRows, commitRows, parseUpload, type BulkRow } from "@/lib/bulk";
import { checkExpRows, type ExpBulkRow } from "@/lib/bulkExp";

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
async function readFile(form: FormData) {
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) throw new Error("Choose a CSV or XLSX file");
  if (f.size > 5_000_000) throw new Error("File is larger than 5 MB");
  return { name: f.name, rows: await parseUpload(f.name, await f.arrayBuffer()) };
}
export async function bulkCheckAction(form: FormData): Promise<{ ok: boolean; message?: string; rows?: BulkRow[]; unknownColumns?: string[]; fileName?: string }> {
  await requireUser(["master"]);
  try {
    const { name, rows } = await readFile(form);
    const res = await checkRows(rows);
    return { ok: true, ...res, fileName: name };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
export async function bulkCommitAction(form: FormData) {
  const user = await requireUser(["master"]);
  try {
    const { name, rows } = await readFile(form);
    const res = await commitRows(rows, user, name);
    if (res.ok) revalidatePath("/", "layout");
    return res.ok ? { ok: true, ids: res.ids } : { ok: false, message: "Some rows have errors — check again." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---- Exp bulk upload (Master only)
export async function bulkExpCheckAction(form: FormData): Promise<{ ok: boolean; message?: string; rows?: ExpBulkRow[]; warnings?: string[]; documents?: number }> {
  await requireUser(["master"]);
  try {
    const { rows } = await readFile(form);
    const { docs: _docs, ...res } = await checkExpRows(rows);
    void _docs;
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
export async function bulkExpCommitAction(form: FormData): Promise<{ ok: boolean; message?: string; docNos?: string[] }> {
  const user = await requireUser(["master"]);
  try {
    const { name, rows } = await readFile(form);
    const res = await checkExpRows(rows);
    if (res.rows.some((r) => Object.keys(r.errors).length)) return { ok: false, message: "Some rows have errors - check again." };
    const docNos = await ch.bulkCreateExpDocs(user, res.docs, name);
    revalidatePath("/", "layout");
    return { ok: true, docNos };
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
export async function splitExpLineAction(lineId: number) {
  const user = await requireUser(["admin", "master"]);
  const r = await ch.requestSplit(user, lineId);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
