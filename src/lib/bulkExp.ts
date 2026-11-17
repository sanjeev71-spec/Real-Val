import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { inArray, sql } from "drizzle-orm";
import { getDb, schema as s } from "./db";
import { fieldOfHeader, parsePaste, type PastedLine } from "./pasteLines";
import { EXP_FIELDS, fieldKey, normalizeExp, normalizeExpDoc, type Errors, type ExpData, type ExpDocData, type ExpUploadUpdate } from "./changes";
import { activeModes, expHeadList } from "./data";
import { str } from "./calc/excel";

// Upload of Exp lines: ONE file both adds new transactions and corrects existing lines.
//  - A row whose DocNo is an existing line is a CORRECTION of that line. Blank cells keep the stored value; type [clear] to empty a field.
//  - Every other row is NEW. Rows with the same Group label are one transaction: one document numbered automatically (Chq-nnnnn / RPnnnnn)
//    with lines -01, -02 ...; a row with no Group is a document of its own. Type a DocNo only to choose the number of a new document.
// Columns that are calculated (ExpType, SignedGross, Director, L0 / L1 ...) are ignored, so a downloaded Exp / Data exceptions file can be corrected and uploaded as it is.
export const EXP_TEMPLATE_COLUMNS = ["Group", "DocNo", "PayDate", "ValueDate", "Head", "Mode", "R/P", "Gross", "GST", "TDS", "BkgID", "Emp", "Project", "Branch", "Narration", "Remarks", "Purpose", "PaymentMode", "Chq/UTR No", "Chq/UTR Date", "Bank Name"];
export const EXP_BULK_MAX = 500;

export interface Change { field: string; from: unknown; to: unknown }
export interface ExpBulkRow { row: number; group: string; docNo: string; kind: "new" | "changed" | "unchanged"; doc: string; line: PastedLine; changes: Change[]; errors: Errors }
export interface ExpBulkCounts { newDocs: number; newLines: number; changed: number; unchanged: number }
export interface ExpBulkOpts { allowAdd: boolean; allowUpdate: boolean }
export interface ExpBulkCheck {
  rows: ExpBulkRow[]; warnings: string[]; counts: ExpBulkCounts;
  creates: ExpDocData[]; updates: ExpUploadUpdate[]; before: { rows: Record<string, Record<string, unknown>> };
}

const key = (v: unknown) => String(v ?? "").trim().toLowerCase();
const LABEL: Record<string, string> = {
  payDate: "Pay date", valueDate: "Value date", head: "Head", mode: "Mode", rp: "R/P", gross: "Gross", gst: "GST", tds: "TDS", branch: "Branch", bkgId: "BkgID", emp: "Emp",
  project: "Project", narration: "Narration", remarks: "Remarks", purpose: "Purpose", paymentMode: "PaymentMode", instrNo: "Chq/UTR No", instrDate: "Chq/UTR Date", chqBank: "Bank Name",
};

export async function checkExpUpload(raw: Record<string, unknown>[], opts: ExpBulkOpts): Promise<ExpBulkCheck> {
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))].filter(Boolean);
  const cell = (v: unknown) => String(v ?? "").replace(/[\t\r\n]+/g, " ");
  const src = raw.filter((r) => headers.some((h) => cell(r[h]).trim() !== ""));
  const used = src.slice(0, EXP_BULK_MAX);
  const fieldOf = headers.map((h) => fieldOfHeader(h));
  const clears: Set<string>[] = [];
  const body = used.map((r, i) => {
    const set = new Set<string>();
    clears[i] = set;
    return headers.map((h, j) => {
      const v = cell(r[h]);
      if (v.trim().toLowerCase() === "[clear]") { if (fieldOf[j]) set.add(fieldOf[j]!); return ""; }
      return v;
    }).join("\t");
  });
  const parsed = parsePaste([headers.join("\t"), ...body].join("\n"), EXP_BULK_MAX);
  if (!parsed.usedHeader) throw new Error("The first row must hold the column names (see the template).");
  if (!parsed.lines.length || parsed.lines.length !== used.length) throw new Error("No rows found in the file, or a row has no readable cell.");
  const warnings = parsed.warnings.filter((w) => !w.startsWith("Only the first"));
  if (src.length > EXP_BULK_MAX) warnings.push(`Only the first ${EXP_BULK_MAX} rows are read per upload (${src.length} in the file). Upload the rest in another file.`);

  const rows: ExpBulkRow[] = parsed.lines.map((line, i) => ({ row: i + 2, group: str(line.group as never), docNo: str(line.docNo as never), kind: "new", doc: "", line, changes: [], errors: {} }));

  // which typed DocNos are existing lines
  const db = await getDb();
  const typed = [...new Set(rows.map((r) => key(r.docNo)).filter(Boolean))];
  const existing = typed.length ? await db.select().from(s.expEntries).where(inArray(sql`lower(${s.expEntries.docNo})`, typed)) : [];
  const existingBy = new Map(existing.map((e) => [key(e.docNo), e]));

  const updates: ExpUploadUpdate[] = [];
  const beforeRows: Record<string, Record<string, unknown>> = {};
  const createRows: ExpBulkRow[] = [];
  for (const [i, r] of rows.entries()) {
    const ex = r.docNo ? existingBy.get(key(r.docNo)) : undefined;
    if (!ex) { createRows.push(r); continue; }
    r.kind = "unchanged";
    r.doc = String(ex.docNo);
    if (r.group) r.errors.group = "Group is for new rows only - this DocNo already exists";
    if (!opts.allowUpdate) { r.errors.docNo = "Changing existing records is switched off"; continue; }
    const base: Record<string, unknown> = Object.fromEntries(EXP_FIELDS.map((k) => [k, (ex as Record<string, unknown>)[k] ?? null]));
    const merged: Record<string, unknown> = { ...base, ...r.line };
    for (const k of clears[i]) merged[k] = null;
    const n = await normalizeExp(merged, ex.id);
    Object.assign(r.errors, n.errors);
    r.line = { ...r.line, ...(n.data as PastedLine) };
    r.changes = EXP_FIELDS.filter((k) => fieldKey(k, base[k]) !== fieldKey(k, n.data[k])).map((k) => ({ field: LABEL[k] ?? k, from: base[k], to: n.data[k] }));
    if (r.changes.length) {
      r.kind = "changed";
      if (!Object.keys(r.errors).length) {
        updates.push({ id: ex.id, docNo: String(ex.docNo), values: n.data as ExpData, changes: r.changes });
        beforeRows[String(ex.id)] = { ...base, docNo: ex.docNo };
      }
    }
  }

  // new rows: one document per Group label; else a typed DocNo; else one document per row
  const groups = new Map<string, ExpBulkRow[]>();
  createRows.forEach((r, i) => {
    if (!opts.allowAdd) r.errors.docNo = "Adding new records is switched off";
    const k = r.group ? `g:${key(r.group)}` : r.docNo ? `d:${key(r.docNo)}` : `r:${i}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  });
  const creates: ExpDocData[] = [];
  const typedNos = new Map<string, string>();
  for (const [gk, g] of groups) {
    const nums = [...new Set(g.map((r) => r.docNo).filter(Boolean).map((x) => key(x)))];
    if (nums.length > 1) g[0].errors.docNo = "Rows of one Group carry different DocNo values - give one number or leave DocNo blank";
    const docNo = g.find((r) => r.docNo)?.docNo || null;
    if (docNo) {
      const o = typedNos.get(key(docNo));
      if (o && o !== gk) g[0].errors.docNo = "This DocNo is used by two different documents in this file";
      typedNos.set(key(docNo), gk);
    }
    const label = g[0].group ? `Group ${g[0].group}` : docNo ?? "";
    g.forEach((r, j) => (r.doc = g.length > 1 ? `${label || "new doc"} · line ${String(j + 1).padStart(2, "0")}` : label));
    const n = await normalizeExpDoc({ docNo, lines: g.map((r) => r.line) }, null);
    for (const [k, v] of Object.entries(n.errors)) {
      const m = /^line\.(\d+)\.(.+)$/.exec(k);
      if (m) g[Number(m[1])].errors[m[2]] = v;
      else g[0].errors[k === "lines" ? "docNo" : k] = v;
    }
    creates.push(n.data);
  }

  // the same cheque / UTR number, date and amount on two different documents of this file
  const seen = new Map<string, ExpBulkRow>();
  for (const r of rows) {
    const l = r.line;
    if (!l.instrNo || !l.instrDate) continue;
    const k = [key(l.instrNo), l.instrDate, l.gross, l.rp].join("|");
    const o = seen.get(k);
    const sameDoc = o && r.kind === "new" && o.kind === "new" && ((r.group && key(o.group) === key(r.group)) || (!r.group && r.docNo && key(o.docNo) === key(r.docNo)));
    if (o && !sameDoc && !r.errors.instrNo) r.errors.instrNo = `Same Chq/UTR No, date and amount as row ${o.row} of this file`;
    if (!o) seen.set(k, r);
  }
  const counts: ExpBulkCounts = { newDocs: creates.length, newLines: createRows.length, changed: rows.filter((r) => r.kind === "changed").length, unchanged: rows.filter((r) => r.kind === "unchanged").length };
  return { rows, warnings, counts, creates, updates, before: { rows: beforeRows } };
}

export async function expTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const [heads, modes] = await Promise.all([expHeadList(), activeModes()]);
  const head = heads.find((h) => h.type === "Expense")?.head ?? heads[0]?.head ?? "";
  const mode = modes.find((m) => m.toLowerCase() === "cash") ?? modes[0] ?? "";
  const ws = wb.addWorksheet("Exp");
  ws.addRow(EXP_TEMPLATE_COLUMNS);
  const ex = (o: Record<string, string | number>) => ws.addRow(EXP_TEMPLATE_COLUMNS.map((c) => o[c] ?? ""));
  ex({ PayDate: "20-10-2026", Head: head, Mode: mode, "R/P": "Payment", Gross: 1500, Emp: "Employee~Code", Narration: "Example: no Group, so a document of its own" });
  ex({ Group: "A", PayDate: "20-10-2026", Head: head, Mode: mode, "R/P": "Payment", Gross: 800, Emp: "Employee~Code", Narration: "Example: Group A, becomes line -01 of one document" });
  ex({ Group: "A", PayDate: "20-10-2026", Head: head, Mode: mode, "R/P": "Payment", Gross: 700, Emp: "Employee~Code", Narration: "Example: Group A, becomes line -02 of the same document" });
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  EXP_TEMPLATE_COLUMNS.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(12, c.length + 2)));

  const help = wb.addWorksheet("Instructions");
  [
    ["TO ADD NEW TRANSACTIONS: fill rows with a blank DocNo (delete the three example rows first). One row = one Exp line."],
    ["To make one transaction of several rows, type the same label in the Group column on each of those rows (A, B, 1, 2, Rent-Oct ... anything). They are saved as ONE document with an automatic number (Chq-nnnnn for Chq, RPnnnnn otherwise); the lines are numbered -01, -02 ... in the order of the rows. The Group label is only a marker for the file; it is not stored."],
    ["Rows with a blank Group are one document each. Type a DocNo on a new row only if you want to choose the document number yourself."],
    ["TO CORRECT EXISTING LINES: download the Exp list or a Data exceptions check from the site, change the cells, and upload that file as it is. A row whose DocNo is an existing line is a correction of that line (DocNo is what identifies the line - do not change it)."],
    ["Blank cells keep the stored value. To empty a field on purpose, type [clear] in the cell. Calculated columns of a download (ExpType, SignedGross, Director, L0/L1 ...) are ignored."],
    ["You can mix corrections and new transactions in one file. Uploading does not delete anything."],
    [`Required for new rows: PayDate, Head, Mode, R/P, Gross, and Emp (Emp is taken from the booking when BkgID is filled). Up to ${EXP_BULK_MAX} rows per upload.`],
    ["Dates: dd-mm-yyyy or yyyy-mm-dd. ValueDate defaults to PayDate. R/P: Receipt or Payment (a negative Gross is read as a Payment of that amount)."],
    ["Mode = Chq lines also need Purpose, PaymentMode (Cheque, RTGS, UPI...), Chq/UTR No and Chq/UTR Date. For other modes those columns are ignored."],
    ["BkgID must exist in Bkg. Emp must match the Emp sheet exactly, e.g. Name~Code."],
    ["The whole file is rejected if any row has an error; nothing is saved until every row passes. Master uploads apply at once; an Admin upload is sent to Master for approval."],
    [`Heads: ${heads.map((h) => h.head).join(", ")}`],
    [`Modes: ${modes.join(", ")}`],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 160;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const expTemplateCsv = () => Papa.unparse({ fields: EXP_TEMPLATE_COLUMNS, data: [] });
