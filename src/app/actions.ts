"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { normEmail, requestOtp, requireUser, signOut, verifyOtp, type Role } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import * as wf from "@/lib/workflow";
import { checkRows, commitRows, parseUpload, type BulkRow } from "@/lib/bulk";

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
