import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { eq, sql } from "drizzle-orm";
import { getDb, schema as s } from "./db";
import { isoToSerial, str } from "./calc/excel";
import { parseDate } from "./validate";
import { getSetting, setSetting } from "./data";
import { MASTER_DEFS, masterKeyOfHeader, type MasterKind } from "./masterDefs";

// Project / Inventory / Price list masters (TRPL). They only SUGGEST values on a booking, so changes apply at once.
export type MVal = string | number | null;
export type MRow = Record<string, MVal> & { _id: string };
export interface MasterChange { field: string; from: MVal; to: MVal }
export interface MasterCheckRow { row: number; kind: "new" | "changed" | "unchanged"; label: string; changes: MasterChange[]; values: Record<string, MVal>; errors: Record<string, string> }
export interface MasterCheck {
  rows: MasterCheckRow[]; warnings: string[]; counts: { added: number; changed: number; unchanged: number };
  creates: Record<string, MVal>[]; updates: { id: string; values: Record<string, MVal> }[];
}
export const MASTER_UPLOAD_MAX = 5000;

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const same = (a: MVal, b: MVal) => (blank(a) && blank(b)) || (typeof a === "number" && typeof b === "number" ? a === b : String(a ?? "") === String(b ?? ""));
const FAR = 99999999;

/** All rows of one master with a stable id (project name, or the table id). */
export async function loadMasterRows(kind: MasterKind): Promise<MRow[]> {
  const db = await getDb();
  if (kind === "projects") {
    return (await db.select().from(s.projects).orderBy(s.projects.name, s.projects.builder, s.projects.location)).map((p) => ({ _id: String(p.id), name: p.name, builder: p.builder, location: p.location }));
  }
  if (kind === "inventory") {
    return (await db.select().from(s.inventory).orderBy(s.inventory.project, s.inventory.unitNo)).map((u) => ({ _id: String(u.id), project: u.project, unitNo: u.unitNo, area: u.area }));
  }
  return (await db.select().from(s.priceList).orderBy(s.priceList.project, s.priceList.dateFrom)).map((p) => ({
    _id: String(p.id), project: p.project, dateFrom: p.dateFrom, dateTo: p.dateTo, bsp: p.bsp, oc: p.oc, paymentPlan: p.paymentPlan,
    slab: p.slab, slabType: p.slabType, structureDate: p.structureDate, possessionDate: p.possessionDate,
  }));
}

const keyOf = (kind: MasterKind, r: Record<string, MVal>) =>
  kind === "projects" ? str(r.name).toLowerCase()
    : kind === "inventory" ? `${str(r.project).toLowerCase()}|${str(r.unitNo)}`
    : `${str(r.project).toLowerCase()}|${str(r.dateFrom)}`;
const labelOf = (kind: MasterKind, r: Record<string, MVal>) =>
  kind === "projects" ? str(r.name) : kind === "inventory" ? `${str(r.project)} ${str(r.unitNo)}` : `${str(r.project)} from ${str(r.dateFrom)}`;

/** Typed value of one cell, or an error text. */
function parseCell(type: "text" | "num" | "date", v: unknown): { v: MVal; err?: string } {
  if (blank(v)) return { v: null };
  if (type === "text") return { v: String(v).trim() };
  if (type === "num") {
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s₹]/g, ""));
    return Number.isFinite(n) ? { v: n } : { v: null, err: "Must be a number" };
  }
  const d = parseDate(v);
  return d && isoToSerial(d) !== null ? { v: d } : { v: null, err: "Use a valid date (dd-mm-yyyy)" };
}

/** Whole-set problems: duplicate keys and (price list) overlapping date ranges. Keyed by row id. */
function setProblems(kind: MasterKind, rows: { id: string; v: Record<string, MVal> }[]): Map<string, string> {
  const out = new Map<string, string>();
  const byKey = new Map<string, string[]>();
  for (const r of rows) byKey.set(keyOf(kind, r.v), [...(byKey.get(keyOf(kind, r.v)) ?? []), r.id]);
  for (const ids of byKey.values()) if (ids.length > 1) for (const id of ids) out.set(id, "Same row exists twice");
  if (kind === "pricelist") {
    const byProj = new Map<string, { id: string; from: number; to: number; v: Record<string, MVal> }[]>();
    for (const r of rows) {
      const from = isoToSerial(r.v.dateFrom as string), to = r.v.dateTo ? isoToSerial(r.v.dateTo as string) : FAR;
      if (from === null || to === null) continue;
      if (to < from) { out.set(r.id, "DateTo is before DateFrom"); continue; }
      const k = str(r.v.project).toLowerCase();
      byProj.set(k, [...(byProj.get(k) ?? []), { id: r.id, from, to, v: r.v }]);
    }
    for (const list of byProj.values()) {
      list.sort((a, b) => a.from - b.from);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].from <= list[i].to; j++) {
        const o = (x: (typeof list)[number]) => `${str(x.v.dateFrom)} to ${x.v.dateTo ? str(x.v.dateTo) : "open"}`;
        if (!out.has(list[i].id)) out.set(list[i].id, `Overlaps the row ${o(list[j])} - set DateTo on the earlier row`);
        if (!out.has(list[j].id)) out.set(list[j].id, `Overlaps the row ${o(list[i])} - set DateTo on the earlier row`);
      }
    }
  }
  return out;
}

/** Check an uploaded file (rows keyed by header): new rows, corrected rows (matched by key), unchanged rows. */
export async function checkMasterUpload(kind: MasterKind, raw: Record<string, unknown>[]): Promise<MasterCheck> {
  const def = MASTER_DEFS[kind];
  const src = raw.filter((r) => Object.values(r).some((v) => !blank(v)));
  if (!src.length) throw new Error("The file has no rows.");
  const headers = Object.keys(src[0]);
  const colOf = new Map<string, string>();
  const unknown: string[] = [];
  for (const h of headers) { const k = masterKeyOfHeader(kind, h); if (k) colOf.set(h, k); else if (h.trim()) unknown.push(h); }
  const missing = def.cols.filter((c) => c.req && ![...colOf.values()].includes(c.key));
  if (missing.length) throw new Error(`Missing column(s): ${missing.map((c) => c.label).join(", ")} - see the template.`);
  const warnings: string[] = [];
  if (unknown.length) warnings.push(`These columns are not used and are ignored: ${unknown.join(", ")}`);
  const used = src.slice(0, MASTER_UPLOAD_MAX);
  if (src.length > MASTER_UPLOAD_MAX) warnings.push(`Only the first ${MASTER_UPLOAD_MAX} rows are read per upload.`);

  const stored = await loadMasterRows(kind);
  const byKey = new Map(stored.map((r) => [keyOf(kind, r), r]));
  const rows: MasterCheckRow[] = [];
  const creates: Record<string, MVal>[] = [];
  const updates: { id: string; values: Record<string, MVal> }[] = [];
  const result = new Map<string, Record<string, MVal>>(stored.map((r) => [r._id, r]));
  const rowId: string[] = [];
  const seen = new Set<string>();

  for (const [i, r] of used.entries()) {
    const out: MasterCheckRow = { row: i + 2, kind: "new", label: "", changes: [], values: {}, errors: {} };
    rows.push(out);
    const typed: Record<string, MVal> = {};
    const clears = new Set<string>();
    for (const [h, k] of colOf) {
      const c = def.cols.find((x) => x.key === k)!;
      const cell = r[h];
      if (typeof cell === "string" && cell.trim().toLowerCase() === "[clear]") { clears.add(k); typed[k] = null; continue; }
      const p = parseCell(c.type, cell);
      if (p.err) out.errors[c.label] = p.err;
      typed[k] = p.v;
    }
    const k0 = keyOf(kind, typed);
    out.label = labelOf(kind, typed);
    for (const c of def.cols) if (c.req && blank(typed[c.key])) out.errors[c.label] = `${c.label} is required`;
    if (Object.keys(out.errors).length) { rowId.push(""); continue; }
    if (seen.has(k0)) out.errors[def.cols[0].label] = "This row appears twice in the file";
    seen.add(k0);
    const ex = byKey.get(k0);
    if (ex) {
      const merged: Record<string, MVal> = { ...ex };
      for (const c of def.cols) if (!c.req && (clears.has(c.key) || !blank(typed[c.key]))) merged[c.key] = typed[c.key];
      out.changes = def.cols.filter((c) => !same(ex[c.key], merged[c.key])).map((c) => ({ field: c.label, from: ex[c.key], to: merged[c.key] }));
      out.kind = out.changes.length ? "changed" : "unchanged";
      out.values = merged;
      result.set(ex._id, merged);
      rowId.push(ex._id);
      if (out.changes.length) updates.push({ id: ex._id, values: Object.fromEntries(out.changes.map((c) => [def.cols.find((x) => x.label === c.field)!.key, c.to])) });
    } else {
      out.values = typed;
      const id = `new:${i}`;
      result.set(id, typed);
      rowId.push(id);
      creates.push(typed);
    }
  }
  const problems = setProblems(kind, [...result].map(([id, v]) => ({ id, v })));
  rows.forEach((r, i) => { const p = rowId[i] && problems.get(rowId[i]); if (p && r.kind !== "unchanged") r.errors[def.cols[0].label] = p; });
  return {
    rows, warnings, creates, updates,
    counts: { added: creates.length, changed: rows.filter((r) => r.kind === "changed").length, unchanged: rows.filter((r) => r.kind === "unchanged").length },
  };
}

const dbValues = (_kind: MasterKind, v: Record<string, MVal>) => v as never;

/** Save checked rows (all or nothing). */
export async function applyMasterUpload(kind: MasterKind, c: Pick<MasterCheck, "creates" | "updates">): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const u of c.updates) {
      if (kind === "projects") await tx.update(s.projects).set(u.values as never).where(eq(s.projects.id, Number(u.id)));
      else if (kind === "inventory") await tx.update(s.inventory).set(u.values as never).where(eq(s.inventory.id, Number(u.id)));
      else await tx.update(s.priceList).set(u.values as never).where(eq(s.priceList.id, Number(u.id)));
    }
    if (c.creates.length) {
      if (kind === "projects") await tx.insert(s.projects).values(c.creates.map((r) => dbValues(kind, r)) as never);
      else if (kind === "inventory") await tx.insert(s.inventory).values(c.creates.map((r) => dbValues(kind, r)) as never);
      else await tx.insert(s.priceList).values(c.creates.map((r) => dbValues(kind, r)) as never);
    }
  });
}

/** One row typed by hand: id null = new row. */
export async function saveMasterRow(kind: MasterKind, id: string | null, input: Record<string, unknown>): Promise<{ ok: boolean; errors?: Record<string, string>; message?: string }> {
  const def = MASTER_DEFS[kind];
  const errors: Record<string, string> = {};
  const v: Record<string, MVal> = {};
  for (const c of def.cols) {
    const p = parseCell(c.type, input[c.key]);
    if (p.err) errors[c.key] = p.err;
    if (c.req && p.v === null && !p.err) errors[c.key] = `${c.label} is required`;
    v[c.key] = p.v;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const stored = await loadMasterRows(kind);
  if (id !== null && !stored.some((r) => r._id === id)) return { ok: false, message: "That row no longer exists." };
  const rows = stored.filter((r) => r._id !== id).map((r) => ({ id: r._id, v: r as Record<string, MVal> }));
  rows.push({ id: id ?? "new", v });
  const p = setProblems(kind, rows).get(id ?? "new");
  if (p) return { ok: false, errors: { [def.cols[0].key]: p }, message: p };
  const db = await getDb();
  if (kind === "projects") {
    if (id === null) await db.insert(s.projects).values(v as never);
    else await db.update(s.projects).set(v as never).where(eq(s.projects.id, Number(id)));
  } else if (kind === "inventory") {
    if (id === null) await db.insert(s.inventory).values(v as never);
    else await db.update(s.inventory).set(v as never).where(eq(s.inventory.id, Number(id)));
  } else {
    if (id === null) await db.insert(s.priceList).values(v as never);
    else await db.update(s.priceList).set(v as never).where(eq(s.priceList.id, Number(id)));
  }
  return { ok: true };
}

export async function deleteMasterRow(kind: MasterKind, id: string): Promise<void> {
  const db = await getDb();
  if (kind === "projects") await db.delete(s.projects).where(eq(s.projects.id, Number(id)));
  else if (kind === "inventory") await db.delete(s.inventory).where(eq(s.inventory.id, Number(id)));
  else await db.delete(s.priceList).where(eq(s.priceList.id, Number(id)));
}

/**
 * Make every booking show its project's Builder and Location from the Project Master (case-insensitive project match).
 * Run after each change of the Project Master. Each changed booking is logged (Bkg history) as done by the person who changed the master.
 */
export async function syncBookingsToProjects(userId: number, why: string): Promise<{ bookings: number }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const res = await tx.execute(sql`
      select b.bkg_id as id, b.data->>'Project' as op, p.name as np, b.data->>'Builder' as ob, b.data->>'ProjectLocation' as ol, p.builder as nb, p.location as nl
      from bookings b join (select distinct on (lower(trim(name))) * from projects order by lower(trim(name)), id desc) p on lower(trim(b.data->>'Project')) = lower(trim(p.name))
      where coalesce(b.data->>'Project','') <> p.name or (p.builder is not null and coalesce(b.data->>'Builder','') <> p.builder)
         or (p.location is not null and coalesce(b.data->>'ProjectLocation','') <> p.location)`);
    const list = ("rows" in res ? (res as unknown as { rows: Record<string, unknown>[] }).rows : (res as unknown as Record<string, unknown>[]));
    if (!list.length) return { bookings: 0 };
    await tx.execute(sql`
      update bookings b set updated_at = now(),
        data = b.data || jsonb_strip_nulls(jsonb_build_object('Project', p.name, 'Builder', p.builder, 'ProjectLocation', p.location))
      from (select distinct on (lower(trim(name))) * from projects order by lower(trim(name)), id desc) p where lower(trim(b.data->>'Project')) = lower(trim(p.name))
        and (coalesce(b.data->>'Project','') <> p.name or (p.builder is not null and coalesce(b.data->>'Builder','') <> p.builder)
          or (p.location is not null and coalesce(b.data->>'ProjectLocation','') <> p.location))`);
    const updates = list.map((r) => {
      const changes: { field: string; from: unknown; to: unknown }[] = [];
      if ((r.op ?? "") !== r.np) changes.push({ field: "Project", from: r.op ?? null, to: r.np });
      if (r.nb !== null && (r.ob ?? "") !== r.nb) changes.push({ field: "Builder", from: r.ob ?? null, to: r.nb });
      if (r.nl !== null && (r.ol ?? "") !== r.nl) changes.push({ field: "ProjectLocation", from: r.ol ?? null, to: r.nl });
      return { bkgId: String(r.id), changes };
    });
    await tx.insert(s.changeRequests).values({
      entity: "bkg", action: "bulk_upload", targetId: null, data: { fileName: why, creates: [], updates } as never, before: null,
      status: "approved", requestedBy: userId, decidedBy: userId, decidedAt: new Date(), resultRef: `${updates.length} bookings`, comment: "Project Master changed - bookings updated automatically",
    });
    return { bookings: updates.length };
  });
}

export const PROJECTS_SEEDED_KEY = "project_master_seeded";
export const projectsSeeded = async () => (await getSetting(PROJECTS_SEEDED_KEY)) === "1";

export interface ProjectConflict { project: string; builders: { value: string; bookings: number }[]; locations: { value: string; bookings: number }[] }
interface ProjectRow { name: string; builder: string | null; location: string | null }

/** Spelling counts per case-insensitive value, most used first. */
type Tally = Map<string, Map<string, number>>;
const tally = (t: Tally, v: string | null, n: number) => {
  if (!v) return;
  const k = v.toLowerCase();
  const sp = t.get(k) ?? new Map<string, number>();
  sp.set(v, (sp.get(v) ?? 0) + n);
  t.set(k, sp);
};
const ranked = (t: Tally) =>
  [...t.values()].map((sp) => ({ value: [...sp].sort((a, b) => b[1] - a[1])[0][0], bookings: [...sp.values()].reduce((x, y) => x + y, 0) })).sort((a, b) => b.bookings - a.bookings);

/** One row per project from the bookings: its most used builder and location. Projects with more than one of either are returned as conflicts. */
export async function projectsFromBkg(): Promise<{ rows: ProjectRow[]; conflicts: ProjectConflict[] }> {
  const db = await getDb();
  const res = await db.execute(sql`
    select trim(data->>'Project') as p, nullif(trim(data->>'Builder'),'') as b, nullif(trim(data->>'ProjectLocation'),'') as l, count(*)::int as n
    from bookings where nullif(trim(data->>'Project'),'') is not null group by 1,2,3`);
  const list = ("rows" in res ? (res as unknown as { rows: Record<string, unknown>[] }).rows : (res as unknown as Record<string, unknown>[]));
  // legacy rows have numbers (0, 6750 ...) in Builder / Location from shifted columns: not taken as values
  const text = (v: unknown) => (v && !/^[\d.,\s-]+$/.test(String(v)) ? String(v) : null);
  const byProj = new Map<string, { names: Tally; b: Tally; l: Tally }>();
  for (const r of list) {
    const key = String(r.p).toLowerCase();
    const g = byProj.get(key) ?? { names: new Map(), b: new Map(), l: new Map() };
    const n = Number(r.n);
    tally(g.names, String(r.p), n); tally(g.b, text(r.b), n); tally(g.l, text(r.l), n);
    byProj.set(key, g);
  }
  const rows: ProjectRow[] = [];
  const conflicts: ProjectConflict[] = [];
  for (const g of byProj.values()) {
    const name = ranked(g.names)[0].value, b = ranked(g.b), l = ranked(g.l);
    rows.push({ name, builder: b[0]?.value ?? null, location: l[0]?.value ?? null });
    if (b.length > 1 || l.length > 1) conflicts.push({ project: name, builders: b, locations: l });
  }
  rows.sort((x, y) => x.name.localeCompare(y.name));
  conflicts.sort((x, y) => x.project.localeCompare(y.project));
  return { rows, conflicts };
}

/**
 * ONE-TIME start of the Project Master from the bookings in Bkg: one row per project with its most used Builder and Location.
 * Done once - afterwards the master is kept by hand or by upload and never refreshed from Bkg again.
 * The list that is there now (from the old import) is REPLACED by it. Projects whose bookings disagree on builder / location are returned for checking.
 */
export async function seedProjectsFromBkg(): Promise<{ added: number; replaced: number; conflicts: ProjectConflict[] }> {
  if (await projectsSeeded()) throw new Error("The Project Master was already created from Bkg once. Add new projects by hand or by upload.");
  const db = await getDb();
  const { rows, conflicts } = await projectsFromBkg();
  const stored = await db.select().from(s.projects);
  await db.transaction(async (tx) => { await tx.delete(s.projects); if (rows.length) await tx.insert(s.projects).values(rows); });
  await setSetting(PROJECTS_SEEDED_KEY, "1");
  return { added: rows.length, replaced: stored.length, conflicts };
}

/** Template (with the current rows when withData, so they can be corrected and uploaded again) and CSV header. */
export async function masterXlsx(kind: MasterKind, withData: boolean): Promise<Buffer> {
  const def = MASTER_DEFS[kind];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  ws.addRow(def.cols.map((c) => c.label));
  const rows = withData ? await loadMasterRows(kind) : [];
  if (rows.length) for (const r of rows) ws.addRow(def.cols.map((c) => r[c.key] ?? ""));
  else ws.addRow(def.cols.map((c) => def.example[c.key] ?? ""));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  def.cols.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(14, c.label.length + 2)));
  const help = wb.addWorksheet("Instructions");
  [
    [`${def.title}: one row per ${kind === "projects" ? "project" : kind === "inventory" ? "unit" : "project and date range"}. Save as .xlsx or CSV (UTF-8).`],
    [`A row is matched to an existing one by ${kind === "projects" ? "Project" : kind === "inventory" ? "Project + UnitNo" : "Project + DateFrom"}: a matching row is corrected, any other row is added. Nothing is deleted by an upload.`],
    ["Blank cells keep the stored value. To empty a cell on purpose type [clear]."],
    ["Dates: dd-mm-yyyy or yyyy-mm-dd. Delete the example row first."],
    ...(kind === "pricelist" ? [["Date ranges of one project must not overlap. Leave DateTo blank for the current open-ended price."]] : []),
    [`Up to ${MASTER_UPLOAD_MAX} rows per upload; the whole file is rejected if any row has an error.`],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 140;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export const masterCsv = (kind: MasterKind) => Papa.unparse({ fields: MASTER_DEFS[kind].cols.map((c) => c.label), data: [] });
