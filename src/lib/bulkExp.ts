import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { and, inArray, sql } from "drizzle-orm";
import { getDb, schema as s } from "./db";
import { fieldOfHeader, parsePaste, type PastedLine } from "./pasteLines";
import { EXP_FIELDS, buildExpCtx, fieldKey, normalizeExp, normalizeExpDoc, type Errors, type ExpData, type ExpDocData, type ExpUploadAdd, type ExpUploadMerge, type ExpUploadUpdate, previewMerge } from "./changes";
import { activeModes, expHeadList } from "./data";
import { str } from "./calc/excel";
import { CALC_COLOUR, EXP_TEMPLATE_COLUMNS, FILL_COLOUR, colNote, kindOfCol } from "./expLayout";

// Upload of Exp lines: ONE file both adds new transactions and corrects existing lines.
//  - A row whose DocNo is an existing line is a CORRECTION of that line. Blank cells keep the stored value; type [clear] to empty a field.
//  - Every other row is NEW. Rows with the same Group label are one transaction: one document numbered automatically (Chq-nnnnn / RPnnnnn)
//    with lines -01, -02 ...; a row with no Group is a document of its own. Type a DocNo only to choose the number of a new document.
// Columns that are calculated (ExpType, SignedGross, Director, L0 / L1 ...) are ignored, so a downloaded Exp / Data exceptions file can be corrected and uploaded as it is.
export { EXP_TEMPLATE_COLUMNS };
export const EXP_BULK_MAX = 500;

export interface Change { field: string; from: unknown; to: unknown }
export interface ExpBulkRow { row: number; group: string; docNo: string; kind: "new" | "changed" | "unchanged"; doc: string; line: PastedLine; changes: Change[]; errors: Errors }
export interface ExpBulkCounts { newDocs: number; newLines: number; changed: number; unchanged: number }
export interface ExpBulkOpts { allowAdd: boolean; allowUpdate: boolean }
export interface ExpBulkCheck {
  rows: ExpBulkRow[]; warnings: string[]; counts: ExpBulkCounts;
  creates: ExpDocData[]; updates: ExpUploadUpdate[]; adds: ExpUploadAdd[]; merges: ExpUploadMerge[]; before: { rows: Record<string, Record<string, unknown>> };
}

/** Branch of a NEW row whose Branch cell is blank (anything typed is kept as typed). Corrections of existing rows keep the stored Branch. */
export const DEFAULT_BRANCH = "Noida";
const key = (v: unknown) => String(v ?? "").trim().toLowerCase();
const LABEL: Record<string, string> = {
  payDate: "Pay date", valueDate: "Value date", head: "Head", mode: "Mode", rp: "R/P", gross: "Gross", gst: "GST", tds: "TDS", branch: "Branch", bkgId: "BkgID", emp: "Emp", relatedEmpName: "RelatedEmpName", expMonth: "ExpMonth",
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
  // an entry without a DocNo is shown by its row id (list and download): a number typed for it identifies that entry
  const idsTyped = typed.filter((x) => /^\d+$/.test(x) && !existingBy.has(x)).map(Number);
  if (idsTyped.length) {
    const noDoc = await db.select().from(s.expEntries).where(and(inArray(s.expEntries.id, idsTyped), sql`coalesce(${s.expEntries.docNo}, '') = ''`));
    for (const e of noDoc) existingBy.set(String(e.id), e);
  }
  const entryLabel = (e: { docNo: string | null; id: number }) => e.docNo || String(e.id);
  const anchorList = new Map<string, { e: (typeof existing)[number]; r: ExpBulkRow }[]>(); // Group label -> the existing rows that carry it
  // every lookup of the whole file in a handful of queries (per-row queries time out on a few hundred rows)
  const ctx = await buildExpCtx([...rows.map((r) => r.line as Record<string, unknown>), ...existingBy.values() as Iterable<Record<string, unknown>>]);

  const updates: ExpUploadUpdate[] = [];
  const beforeRows: Record<string, Record<string, unknown>> = {};
  const createRows: ExpBulkRow[] = [];
  for (const [i, r] of rows.entries()) {
    const ex = r.docNo ? existingBy.get(key(r.docNo)) : undefined;
    if (!ex) { if (!r.line.branch) r.line.branch = DEFAULT_BRANCH; createRows.push(r); continue; } // new row: a blank Branch becomes the default
    r.kind = "unchanged";
    r.doc = entryLabel(ex);
    if (r.group) anchorList.set(key(r.group), [...(anchorList.get(key(r.group)) ?? []), { e: ex, r }]);
    if (!opts.allowUpdate) { r.errors.docNo = "Changing existing records is switched off"; continue; }
    const base: Record<string, unknown> = Object.fromEntries(EXP_FIELDS.map((k) => [k, (ex as Record<string, unknown>)[k] ?? null]));
    // ExpMonth equal to the month the row already shows (a downloaded file) is not a change
    const shown = (ex.expMonth as string | null) || str(ex.payDate as never).slice(0, 7);
    if (r.line.expMonth !== undefined && r.line.expMonth === shown) delete r.line.expMonth;
    const merged: Record<string, unknown> = { ...base, ...r.line };
    for (const k of clears[i]) merged[k] = null;
    const n = await normalizeExp(merged, ex.id, ctx);
    Object.assign(r.errors, n.errors);
    r.line = { ...r.line, ...(n.data as PastedLine) };
    r.changes = EXP_FIELDS.filter((k) => fieldKey(k, base[k]) !== fieldKey(k, n.data[k])).map((k) => ({ field: LABEL[k] ?? k, from: base[k], to: n.data[k] }));
    if (r.changes.length) {
      r.kind = "changed";
      if (!Object.keys(r.errors).length) {
        updates.push({ id: ex.id, docNo: entryLabel(ex), values: n.data as ExpData, changes: r.changes });
        beforeRows[String(ex.id)] = { ...base, docNo: ex.docNo };
      }
    }
  }

  // a Group label on existing rows of ONE document: new rows join that document. On rows of SEVERAL documents: those documents are merged into one
  // (the lowest-numbered entry gives its number, as with "merge entries" on the Exp page) and the new rows join it.
  const merges: ExpUploadMerge[] = [];
  const anchorBase = new Map<string, string | null>(); // Group label -> document number the new rows are added to
  for (const [label, list] of anchorList) {
    const bases = new Set(list.map((x) => x.e.docBase ?? x.e.docNo ?? String(x.e.id)));
    if (bases.size < 2) { anchorBase.set(label, list[0].e.docBase ?? list[0].e.docNo ?? null); continue; }
    if (!opts.allowUpdate) continue; // those rows already carry the error
    const pv = await previewMerge(db, [...new Set(list.map((x) => x.e.id))]);
    if (!pv.ok) { for (const x of list) x.r.errors.group = pv.message; anchorBase.set(label, null); continue; }
    merges.push({ ids: [...new Set(list.map((x) => x.e.id))] });
    anchorBase.set(label, pv.base);
    for (const p of pv.plan) {
      const x = list.find((y) => y.e.id === p.id);
      if (!x) continue;
      x.r.doc = `merged into ${pv.base}`;
      if (p.will !== p.was) { x.r.kind = "changed"; x.r.changes.push({ field: "DocNo", from: p.was, to: p.will }); }
    }
  }

  // new rows whose Group label is on an existing row (or is an existing document number) are added to that document; its old lines keep their DocNo
  const joinLabels = [...new Set(createRows.map((r) => key(r.group)).filter((g) => g && !anchorBase.has(g)))];
  const byDoc = joinLabels.length
    ? await db.select().from(s.expEntries).where(sql`lower(${s.expEntries.docBase}) in (${sql.join(joinLabels.map((g) => sql`${g}`), sql`, `)}) or (${s.expEntries.docBase} is null and lower(${s.expEntries.docNo}) in (${sql.join(joinLabels.map((g) => sql`${g}`), sql`, `)}))`)
    : [];
  const docByLabel = new Map<string, string>();
  for (const e of byDoc) { const b = e.docBase ?? e.docNo; if (b) { for (const g of joinLabels) if (g === key(b)) docByLabel.set(g, b); } }
  const adds = new Map<string, { lines: ExpData[]; rows: ExpBulkRow[] }>();
  const stillNew: ExpBulkRow[] = [];
  for (const r of createRows) {
    const g = key(r.group);
    const hasAnchor = g ? anchorBase.has(g) : false;
    const base = g ? (hasAnchor ? anchorBase.get(g) ?? undefined : docByLabel.get(g)) : undefined;
    if (!g || (!base && !hasAnchor)) { stillNew.push(r); continue; }
    r.doc = base ? `adds to ${base}` : "";
    if (!opts.allowAdd) { r.errors.docNo = "Adding new records is switched off"; continue; }
    if (!base) { r.errors.group = "That row has no DocNo, so a line cannot be added to its document - give it a DocNo first"; continue; }
    if (r.docNo) r.errors.docNo = "Leave DocNo blank on a row that is added to an existing document";
    const n = await normalizeExp(r.line, null, ctx);
    Object.assign(r.errors, n.errors);
    r.line = { ...r.line, ...(n.data as PastedLine) }; // show the Emp / Project filled from the booking
    const a = adds.get(base) ?? { lines: [], rows: [] };
    a.lines.push(n.data); a.rows.push(r); adds.set(base, a);
  }

  // new rows: one document per Group label; else a typed DocNo; else one document per row
  const groups = new Map<string, ExpBulkRow[]>();
  stillNew.forEach((r, i) => {
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
    const n = await normalizeExpDoc({ docNo, lines: g.map((r) => r.line) }, null, ctx);
    for (const [k, v] of Object.entries(n.errors)) {
      const m = /^line\.(\d+)\.(.+)$/.exec(k);
      if (m) g[Number(m[1])].errors[m[2]] = v;
      else g[0].errors[k === "lines" ? "docNo" : k] = v;
    }
    g.forEach((r, j) => { if (n.data.lines[j]) r.line = { ...r.line, ...(n.data.lines[j] as PastedLine) }; }); // show the Emp / Project filled from the booking
    creates.push(n.data);
  }

  const counts: ExpBulkCounts = { newDocs: creates.length, newLines: createRows.length, changed: rows.filter((r) => r.kind === "changed").length, unchanged: rows.filter((r) => r.kind === "unchanged").length };
  return { rows, warnings, counts, creates, updates, adds: [...adds].map(([docBase, a]) => ({ docBase, lines: a.lines })), merges, before: { rows: beforeRows } };
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
  const hdr = ws.getRow(1);
  hdr.font = { bold: true };
  EXP_TEMPLATE_COLUMNS.forEach((c, i) => {
    const cell = hdr.getCell(i + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: kindOfCol(c) === "fill" ? FILL_COLOUR : CALC_COLOUR } };
    cell.note = colNote(c);
    ws.getColumn(i + 1).width = Math.max(12, c.length + 2);
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const help = wb.addWorksheet("Instructions");
  [
    ["COLOURS OF THE COLUMN HEADINGS: GREEN = type / correct by hand, it is read on upload. GREY columns are built in and ignored on upload even if you type in them. EXPMONTH is optional: blank = built in from PayDate (yyyy-mm); a month you type (2026-10, Oct-2026) is kept as typed; type [clear] to go back to the PayDate month. The same colours are used in the Exp download, whose columns are in the same order as here."],
    ["TO ADD NEW TRANSACTIONS: fill rows with a blank DocNo (delete the three example rows first). One row = one Exp line."],
    ["To make one transaction of several rows, type the same label in the Group column on each of those rows (A, B, 1, 2, Rent-Oct ... anything). They are saved as ONE document with an automatic number (Chq-nnnnn for Chq, RPnnnnn otherwise) and lines -01, -02 ..."],
    ["To ADD A LINE TO AN EXISTING DOCUMENT: put the same Group label on the existing row (keep its DocNo) and on the new row (blank DocNo). The new row becomes the next line of that document; the old DocNo is not changed. You may also type the existing document number itself in Group of the new row."],
    ["Rows with a blank Group are one document each. Type a DocNo on a new row only if you want to choose the document number yourself."],
    ["TO CORRECT EXISTING LINES: download the Exp list (or a Data exceptions check) from the site, change the green cells, and upload that file as it is. A row whose DocNo is an existing line is a correction of that line (DocNo identifies the line - do not change it). An entry that shows no DocNo in the list is identified by the number shown in its place (its row id) - keep that number in DocNo."],
    ["Blank cells keep the stored value. To empty a field on purpose, type [clear] in the cell. Calculated columns of the download (ExpType, SignedGross, Client, Director, Data Exception Remarks, Rcv_..., L0/L1 ...) are ignored."],
    ["You can mix corrections and new transactions in one file. Uploading does not delete anything."],
    [`Branch: a new row with a blank Branch gets \"Noida\"; anything you type is kept. On a correction a blank cell keeps the stored Branch. Required for new rows: PayDate, Head, Mode, R/P, Gross, and Emp. When BkgID is filled, a blank Emp and a blank Project are taken from the booking (type an Emp to use a different one). Up to ${EXP_BULK_MAX} rows per upload.`],
    ["Dates: dd-mm-yyyy or yyyy-mm-dd. ValueDate defaults to PayDate. R/P: Receipt or Payment (a negative Gross is read as a Payment of that amount)."],
    ["Mode = Chq lines also need Purpose, PaymentMode (Cheque, RTGS, UPI...), Chq/UTR No and Chq/UTR Date. For other modes those columns are ignored."],
    ["BkgID must exist in Bkg. Emp must match the Emp sheet exactly, e.g. Name~Code. RelatedEmpName is free text (a note such as a builder or 'Need Detail')."],
    ["The whole file is rejected if any row has an error; nothing is saved until every row passes. Master uploads apply at once; an Admin upload is sent to Master for approval."],
    [`Heads: ${heads.map((h) => h.head).join(", ")}`],
    [`Modes: ${modes.join(", ")}`],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 160;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const expTemplateCsv = () => Papa.unparse({ fields: EXP_TEMPLATE_COLUMNS, data: [] });
