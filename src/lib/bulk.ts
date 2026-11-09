import "server-only";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { getDb, schema as s } from "./db";
import { loadMasters } from "./data";
import { applyLookups, type FormData } from "./masters";
import { normalize, validateBooking, type Errors } from "./validate";
import { BKG_INPUT_KEYS, FORM_STATUSES, NEW_BOOKING_DEFAULTS, PROPERTY_TYPES, SOURCES_OF_LEAD, SOLD_STATUSES } from "./fields";
import { insertBookings } from "./workflow";
import { str } from "./calc/excel";
import type { User } from "./auth";

export const TEMPLATE_COLUMNS = BKG_INPUT_KEYS;
export const MAX_ROWS = 2000;

export interface BulkRow {
  row: number; // spreadsheet row number (header = 1)
  data: FormData;
  errors: Errors;
}

export async function parseUpload(name: string, buf: ArrayBuffer): Promise<Record<string, unknown>[]> {
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets.find((w) => w.name.toLowerCase() === "bookings") ?? wb.worksheets[0];
    const header: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (header[i - 1] = str(c.text)));
    const out: Record<string, unknown>[] = [];
    ws.eachRow((r, i) => {
      if (i === 1) return;
      const o: Record<string, unknown> = {};
      header.forEach((h, j) => {
        const v = r.getCell(j + 1).value;
        o[h] = v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v instanceof Date ? v.toISOString().slice(0, 10) : v;
      });
      out.push(o);
    });
    return out;
  }
  const text = new TextDecoder().decode(buf).replace(/^﻿/, "");
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  return res.data;
}

export async function checkRows(raw: Record<string, unknown>[]): Promise<{ rows: BulkRow[]; unknownColumns: string[] }> {
  const masters = await loadMasters();
  const db = await getDb();
  const existing = new Set((await db.select({ id: s.bookings.bkgId }).from(s.bookings)).map((x) => x.id.toUpperCase()));
  const cols = new Set(raw.flatMap((r) => Object.keys(r)));
  const unknownColumns = [...cols].filter((c) => c && !TEMPLATE_COLUMNS.includes(c));
  const taken = new Set<string>();
  const seenIds = new Set<string>();
  const rows: BulkRow[] = [];
  raw.slice(0, MAX_ROWS).forEach((r, i) => {
    let d = normalize(r);
    if (Object.values(d).every((v) => v === null)) return;
    for (const [k, v] of Object.entries(NEW_BOOKING_DEFAULTS)) if (!str(d[k])) d[k] = v;
    d = applyLookups(d, masters, false);
    const errors = validateBooking(d, masters, { mode: "bulk", takenInBatch: taken, existingBkgIds: existing });
    if (d.BkgID) {
      const id = str(d.BkgID).toUpperCase();
      if (seenIds.has(id)) errors.BkgID = "Duplicate BkgID in this file";
      seenIds.add(id);
    }
    if (d.Project && d.UnitNo && SOLD_STATUSES.includes(str(d.FormStatus))) taken.add(`${str(d.Project).toLowerCase()}|${str(d.UnitNo)}`);
    rows.push({ row: i + 2, data: d, errors });
  });
  return { rows, unknownColumns };
}

export async function commitRows(raw: Record<string, unknown>[], user: User, fileName: string) {
  const { rows } = await checkRows(raw);
  const bad = rows.filter((r) => Object.keys(r.errors).length);
  if (bad.length) return { ok: false as const, rows };
  const db = await getDb();
  const ids = await db.transaction(async (tx) => {
    const ids = await insertBookings(tx, rows.map((r) => r.data), "bulk", user.id);
    await tx.insert(s.auditLog).values({ userId: user.id, action: "bulk_upload", detail: { fileName, count: ids.length, bkgIds: ids } });
    return ids;
  });
  return { ok: true as const, ids };
}

export async function templateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bookings");
  ws.addRow(TEMPLATE_COLUMNS);
  const example: Record<string, string | number> = {
    BkgLoginDate: "20-10-2026", FormStatus: "Not Live", SourceOfLead: "Company Lead", PropertyType: "Studio",
    Emp: "Jagmeet~100052", Client: "Example Client", ContactNo: "9800000000", Project: "Pride Plaza", UnitNo: "1403",
    OnFormDiscountPSF: 0, BrokerName: "", BrokerAmt: 0,
  };
  ws.addRow(TEMPLATE_COLUMNS.map((c) => example[c] ?? ""));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  TEMPLATE_COLUMNS.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(12, c.length + 2)));

  const help = wb.addWorksheet("Instructions");
  [
    ["Delete the example row (row 2) before uploading. Save as .xlsx or CSV (UTF-8)."],
    ["Required: BkgLoginDate, Emp, Client, Project, UnitNo, FormStatus."],
    ["BkgID: leave blank to auto-generate (RV0001...). Fill it only to keep an existing ID from another system."],
    ["Dates: dd-mm-yyyy or yyyy-mm-dd. BkgMonth defaults to BkgLoginDate."],
    ["Blank cells are filled automatically: Builder/ProjectLocation (Project), Area (Inventory), BSPPSF/OtherChargesPSF/PaymentPlan/DSlab/DSlabType (Price List on the booking date), Branch (Associate's Emp row on the booking date)."],
    [`Defaults: ${Object.entries(NEW_BOOKING_DEFAULTS).map(([k, v]) => `${k} = ${v}`).join(", ")}.`],
    [`FormStatus: ${FORM_STATUSES.join(", ")}  (Live and Not Live mark the unit as sold).`],
    [`SourceOfLead: ${SOURCES_OF_LEAD.join(", ")}`],
    [`PropertyType: ${PROPERTY_TYPES.join(", ")}`],
    ["Emp must match the Emp sheet exactly, e.g. Jagmeet~100052."],
    ["The whole file is rejected if any row has an error; nothing is saved until every row passes."],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 140;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function templateCsv(): string {
  return Papa.unparse({ fields: TEMPLATE_COLUMNS, data: [] });
}
