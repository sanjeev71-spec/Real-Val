import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { inArray, eq, sql } from "drizzle-orm";
import { getDb, schema as s, type DB } from "./db";
import { loadMasters } from "./data";
import { applyLookups, employeeNames, type FormData } from "./masters";
import { convertBackOffice, isBackOffice } from "./bkgBackOffice";
import { normalize, validateBooking, type Errors } from "./validate";
import { BKG_COLUMNS, BKG_INPUT_KEYS, FORM_STATUSES, NEW_BOOKING_DEFAULTS, NUMBER_KEYS, PROPERTY_TYPES, SOLD_STATUSES, SOURCES_OF_LEAD } from "./fields";
import { insertBookings } from "./workflow";
import { str } from "./calc/excel";
import { COMPANY } from "./company";

// Upload of Bkg: ONE file both adds new bookings and corrects existing ones.
//  - A row whose BkgID is an existing booking is a CORRECTION of that booking. Blank cells keep the stored value; type [clear] to empty a field.
//    Only the typed (input) columns are read: calculated columns of a download (Director, DirectorRevenue, PendDue ...) are ignored.
//  - A row with a blank BkgID is a NEW booking (BkgID generated). A typed BkgID that does not exist yet is a new booking with that ID.
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Row = Record<string, unknown>;

export const BKG_UPLOAD_MAX = 500;
export const BKG_TEMPLATE_COLUMNS = BKG_INPUT_KEYS;

export interface BkgChange { field: string; from: unknown; to: unknown }
export interface BkgUpdate { bkgId: string; changes: BkgChange[] }
export interface BkgUploadData { fileName: string; creates: FormData[]; updates: BkgUpdate[] }
export interface BkgUploadRow { row: number; kind: "new" | "changed" | "unchanged"; bkgId: string; data: FormData; changes: BkgChange[]; errors: Errors }
export interface BkgUploadCounts { added: number; changed: number; unchanged: number }
export interface BkgUploadOpts { allowAdd: boolean; allowUpdate: boolean }
export interface BkgUploadCheck { rows: BkgUploadRow[]; warnings: string[]; counts: BkgUploadCounts; creates: FormData[]; updates: BkgUpdate[] }

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
/** A booking value in a form that compares equal when it means the same (blank = blank, 100 = "100.00"). */
export const valKey = (k: string, v: unknown): string => {
  if (blank(v)) return "";
  if (NUMBER_KEYS.has(k)) {
    const n = Number(String(v).replace(/[,\s₹]/g, ""));
    return Number.isFinite(n) ? String(n) : String(v).trim();
  }
  return String(v).trim();
};
const isSold = (v: unknown) => SOLD_STATUSES.includes(str(v as never));

/** project|unit (lower case) of every Live / Not Live booking in Bkg. */
async function occupiedUnits(db: Awaited<ReturnType<typeof getDb>>): Promise<Set<string>> {
  const r = await db.select({ k: sql<string>`lower(trim(${s.bookings.data}->>'Project'))||'|'||lower(trim(${s.bookings.data}->>'UnitNo'))` }).from(s.bookings).where(inArray(sql`${s.bookings.data}->>'FormStatus'`, SOLD_STATUSES));
  return new Set(r.map((x) => x.k));
}

export async function checkBkgUpload(rawIn: Row[], opts: BkgUploadOpts): Promise<BkgUploadCheck> {
  const masters = await loadMasters();
  const db = await getDb();
  let raw = rawIn;
  const preWarnings: string[] = [];
  let rowNo = new WeakMap<object, number>();
  if (COMPANY.manualMasters && isBackOffice(rawIn)) {
    const erps = [...new Set(rawIn.map((r) => str(r["Booking Trpl Id"] as never).toUpperCase()).filter(Boolean))];
    const have = erps.length ? await db.select({ id: s.bookings.bkgId, erp: sql<string>`upper(${s.bookings.data}->>'ERPID')` }).from(s.bookings).where(inArray(sql`upper(${s.bookings.data}->>'ERPID')`, erps)) : [];
    const c = convertBackOffice(rawIn, employeeNames(masters), new Map(have.map((h) => [h.erp, h.id])), await occupiedUnits(db));
    raw = c.rows; rowNo = c.rowNo; preWarnings.push(...c.warnings);
  }
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))].filter(Boolean);
  const known = new Set<string>(BKG_COLUMNS as readonly string[]);
  const unknown = headers.filter((h) => !known.has(h));
  const src = raw.filter((r) => headers.some((h) => !blank(r[h])));
  if (!src.length) throw new Error("No rows found in the file.");
  if (!headers.includes("BkgID") && !headers.includes("Client")) throw new Error("The first row must hold the column names (see the template).");
  const used = src.slice(0, BKG_UPLOAD_MAX);
  const warnings: string[] = [...preWarnings];
  if (src.length > BKG_UPLOAD_MAX) warnings.push(`Only the first ${BKG_UPLOAD_MAX} rows are read per upload (${src.length} in the file). Upload the rest in another file.`);
  if (unknown.length) warnings.push(`These columns are not Bkg columns and are ignored: ${unknown.join(", ")}`);

  const typedIds = [...new Set(used.map((r) => str(r.BkgID as never).toUpperCase()).filter(Boolean))];
  const found = typedIds.length ? await db.select().from(s.bookings).where(inArray(sql`upper(${s.bookings.bkgId})`, typedIds)) : [];
  const existingBy = new Map(found.map((b) => [b.bkgId.toUpperCase(), b]));

  const rows: BkgUploadRow[] = [];
  const creates: FormData[] = [];
  const updates: BkgUpdate[] = [];
  const taken = new Set<string>();
  const seenIds = new Set<string>();

  for (const [i, r] of used.entries()) {
    const id = str(r.BkgID as never).toUpperCase();
    const clears = new Set<string>();
    const cleaned: Row = {};
    for (const h of headers) {
      const v = r[h];
      if (typeof v === "string" && v.trim().toLowerCase() === "[clear]") { clears.add(h); cleaned[h] = null; } else cleaned[h] = v;
    }
    const out: BkgUploadRow = { row: rowNo.get(r) ?? i + 2, kind: "new", bkgId: id, data: {}, changes: [], errors: {} };
    rows.push(out);
    if (id) {
      if (seenIds.has(id)) out.errors.BkgID = "Duplicate BkgID in this file";
      seenIds.add(id);
    }

    const ex = id ? existingBy.get(id) : undefined;
    if (ex) {
      out.kind = "unchanged";
      if (!opts.allowUpdate) { out.errors.BkgID = "Changing existing bookings is switched off"; continue; }
      const base = normalize(ex.data as Row);
      const fileVals = normalize(cleaned);
      let merged: FormData = { ...base };
      for (const k of BKG_INPUT_KEYS) if (k !== "BkgID" && (clears.has(k) || !blank(cleaned[k]))) merged[k] = fileVals[k];
      const diff = (m: FormData) => BKG_INPUT_KEYS.filter((k) => k !== "BkgID" && valKey(k, base[k]) !== valKey(k, m[k]));
      let changedKeys = diff(merged);
      // Project / Unit / Date / Associate changed: blanks are filled from the masters again, as for a new booking. Otherwise nothing is auto-filled.
      if (["Project", "UnitNo", "BkgLoginDate", "Emp"].some((k) => changedKeys.includes(k))) {
        merged = applyLookups(merged, masters, false);
        for (const k of clears) if (k in merged) merged[k] = null;
        changedKeys = diff(merged);
      }
      merged.BkgID = ex.bkgId;
      const all = validateBooking(merged, masters, { mode: "bulk", takenInBatch: taken });
      // legacy data may already break a rule: only problems with what this file changes block the upload
      const projChanged = changedKeys.includes("Project"), unitChanged = changedKeys.includes("UnitNo"), dateChanged = changedKeys.includes("BkgLoginDate");
      const unitCheck = projChanged || unitChanged || (!isSold(base.FormStatus) && isSold(merged.FormStatus));
      for (const [k, v] of Object.entries(all)) {
        const keep = k === "UnitNo" ? unitCheck : k === "Emp" ? changedKeys.includes("Emp") || dateChanged : k === "BkgLoginDate" ? dateChanged : changedKeys.includes(k);
        if (keep) out.errors[k] = v;
      }
      out.data = merged;
      out.changes = changedKeys.map((k) => ({ field: k, from: base[k], to: merged[k] }));
      if (out.changes.length) {
        out.kind = "changed";
        if ((projChanged || unitChanged) && isSold(merged.FormStatus) && merged.Project && merged.UnitNo) taken.add(`${str(merged.Project).toLowerCase()}|${str(merged.UnitNo)}`);
        if (!Object.keys(out.errors).length) updates.push({ bkgId: ex.bkgId, changes: out.changes });
      }
      continue;
    }

    // a new booking
    if (!opts.allowAdd) out.errors.BkgID = "Adding new bookings is switched off";
    let d = normalize(cleaned);
    if (Object.values(d).every((v) => v === null)) continue;
    for (const [k, v] of Object.entries(NEW_BOOKING_DEFAULTS)) if (!str(d[k])) d[k] = v;
    d = applyLookups(d, masters, false);
    Object.assign(out.errors, validateBooking(d, masters, { mode: "bulk", takenInBatch: taken }), out.errors);
    if (d.Project && d.UnitNo && isSold(d.FormStatus)) taken.add(`${str(d.Project).toLowerCase()}|${str(d.UnitNo)}`);
    out.data = d;
    creates.push(d);
  }
  const counts: BkgUploadCounts = { added: creates.length, changed: rows.filter((r) => r.kind === "changed").length, unchanged: rows.filter((r) => r.kind === "unchanged").length };
  return { rows, warnings, counts, creates, updates };
}

/** Applies a prepared upload inside a transaction. A booking changed by someone else since the upload was prepared is refused. */
export async function applyBkgUpload(tx: Tx, d: BkgUploadData, userId: number): Promise<string> {
  for (const u of d.updates ?? []) {
    const [cur] = await tx.select().from(s.bookings).where(eq(s.bookings.bkgId, u.bkgId));
    if (!cur) throw new Error(`${u.bkgId} no longer exists`);
    for (const c of u.changes) if (valKey(c.field, cur.data[c.field]) !== valKey(c.field, c.from)) throw new Error(`${u.bkgId} was changed after this upload was prepared - upload again`);
    const data = { ...cur.data };
    for (const c of u.changes) data[c.field] = (c.to ?? null) as string | number | null;
    await tx.update(s.bookings).set({ data, updatedAt: new Date() }).where(eq(s.bookings.bkgId, u.bkgId));
  }
  const ids = d.creates?.length ? await insertBookings(tx, d.creates, "bulk", userId) : [];
  return `${ids.length} new · ${(d.updates ?? []).length} changed`;
}

/** The one-row upload that a form edit stands for: the form's values, with [clear] where a stored value was emptied. */
export function editRow(bkgId: string, stored: FormData, form: FormData): Row {
  const row: Row = { BkgID: bkgId };
  for (const k of BKG_INPUT_KEYS) {
    if (k === "BkgID") continue;
    if (blank(form[k])) { if (!blank(stored[k])) row[k] = "[clear]"; } else row[k] = form[k];
  }
  return row;
}

export async function bkgTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bookings");
  ws.addRow(BKG_TEMPLATE_COLUMNS);
  const example: Record<string, string | number> = {
    BkgLoginDate: "20-10-2026", FormStatus: "Not Live", SourceOfLead: "Company Lead", PropertyType: "Studio",
    Emp: "Employee~Code", Client: "Example Client", ContactNo: "9800000000", Project: "Project name", UnitNo: "1403",
    ...(COMPANY.manualMasters ? { Builder: "Builder name", ProjectLocation: "Sector, City", Area: 1000, BSPPSF: 5000, OtherChargesPSF: 0, PaymentPlan: "40-30-30", DSlab: 0, DSlabType: "" } : {}),
    OnFormDiscountPSF: 0, BrokerName: "", BrokerAmt: 0,
  };
  ws.addRow(BKG_TEMPLATE_COLUMNS.map((c) => example[c] ?? ""));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  BKG_TEMPLATE_COLUMNS.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(12, c.length + 2)));

  const help = wb.addWorksheet("Instructions");
  [
    ["TO ADD NEW BOOKINGS: fill rows with a blank BkgID (delete the example row 2 first). Save as .xlsx or CSV (UTF-8)."],
    [COMPANY.freeUnits ? "Required for a new booking: BkgLoginDate, Emp, Client, Project, FormStatus. UnitNo may be blank, and the same unit may appear on more than one booking." : "Required for a new booking: BkgLoginDate, Emp, Client, Project, UnitNo, FormStatus."],
    [`BkgID: leave blank to auto-generate (${COMPANY.idExample}...). Type one only to keep an ID from another system.`],
    ["Dates: dd-mm-yyyy or yyyy-mm-dd. BkgMonth defaults to BkgLoginDate."],
    ...(COMPANY.manualMasters ? [["Project MUST exist in the Project Master (Admin > Projects) - a row with any other project is rejected with the reason; add the project there first. Builder and ProjectLocation: leave them blank - they are filled from the Project Master (if you type them they must be the same as in the master, otherwise the row is rejected)."],, ["UnitNo, Area, PaymentPlan, BSPPSF, OtherChargesPSF, DSlab and DSlabType are TYPED in the file - they need not exist in any master. A blank one on a NEW booking is suggested from the Inventory / Price List masters when they have it; otherwise it stays blank. Branch is taken from the Associate's Emp row on the booking date when blank."]] : [["Blank cells of a NEW booking are filled automatically: Builder/ProjectLocation (Project), Area (Inventory), BSPPSF/OtherChargesPSF/PaymentPlan/DSlab/DSlabType (Price List on the booking date), Branch (Associate's Emp row on the booking date)."]]),
    [`Defaults for new bookings: ${Object.entries(NEW_BOOKING_DEFAULTS).map(([k, v]) => `${k} = ${v}`).join(", ")}.`],
    ["TO CORRECT EXISTING BOOKINGS: download the Bkg list (or a Data exceptions check), change the cells and upload that file as it is. A row whose BkgID is an existing booking is a correction of that booking (BkgID identifies it - do not change it)."],
    ["Blank cells keep the stored value. To empty a field on purpose, type [clear] in the cell. Calculated columns of a download (Director, DirectorRevenue, PendDue, L0_Emp ...) are ignored."],
    ["Auto-fill from the masters is applied to a corrected booking only when its Project, UnitNo, BkgLoginDate or Emp is changed; otherwise only the cells you changed are touched."],
    ["You can mix corrections and new bookings in one file. Uploading does not delete anything."],
    [`FormStatus: ${FORM_STATUSES.join(", ")}  (Live and Not Live mark the unit as sold).`],
    [`SourceOfLead: ${SOURCES_OF_LEAD.join(", ")}`],
    [`PropertyType: ${PROPERTY_TYPES.join(", ")}`],
    ["Emp must match the Emp sheet exactly, e.g. Name~Code."],
    [`The whole file is rejected if any row has an error; nothing is saved until every row passes. Up to ${BKG_UPLOAD_MAX} rows per upload. Master uploads apply at once; an Admin upload is sent to Master for approval.`],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 150;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const bkgTemplateCsv = () => Papa.unparse({ fields: BKG_TEMPLATE_COLUMNS, data: [] });
