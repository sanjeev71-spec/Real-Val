import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { parsePaste, type PastedLine } from "./pasteLines";
import { normalizeExpDoc, type Errors, type ExpDocData } from "./changes";
import { activeModes, expHeadList } from "./data";
import { str } from "./calc/excel";

// Bulk upload of Exp lines (Master). One row = one Exp line.
//  - Rows that carry the same Group label are one transaction: ONE document numbered automatically (Chq-nnnnn / RPnnnnn), lines -01, -02 ...
//    The label is only a marker for the file; it is not stored and not used as the number.
//  - DocNo is optional: type it only to choose the document number yourself (rows with the same DocNo are one document).
//  - A row with neither is one document of its own.
export const EXP_TEMPLATE_COLUMNS = ["Group", "DocNo", "PayDate", "ValueDate", "Head", "Mode", "R/P", "Gross", "GST", "TDS", "BkgID", "Emp", "Project", "Branch", "Narration", "Remarks", "Purpose", "PaymentMode", "Chq/UTR No", "Chq/UTR Date", "Bank Name"];
export const EXP_BULK_MAX = 500;

export interface ExpBulkRow { row: number; group: string; docNo: string; line: PastedLine; errors: Errors; doc: string }
export interface ExpBulkCheck { rows: ExpBulkRow[]; warnings: string[]; documents: number; docs: ExpDocData[] }

const key = (v: unknown) => String(v ?? "").trim().toLowerCase();

export async function checkExpRows(raw: Record<string, unknown>[]): Promise<ExpBulkCheck> {
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))].filter(Boolean);
  const cell = (v: unknown) => String(v ?? "").replace(/[\t\r\n]+/g, " ");
  const tsv = [headers.join("\t"), ...raw.map((r) => headers.map((h) => cell(r[h])).join("\t"))].join("\n");
  const parsed = parsePaste(tsv, EXP_BULK_MAX);
  if (!parsed.usedHeader) throw new Error("The first row must hold the column names (see the template).");
  if (!parsed.lines.length) throw new Error("No rows found in the file.");
  const warnings = parsed.warnings.filter((w) => !w.startsWith("Only the first"));
  if (raw.length > EXP_BULK_MAX) warnings.push(`Only the first ${EXP_BULK_MAX} rows are read per upload (${raw.length} in the file). Upload the rest in another file.`);

  const rows: ExpBulkRow[] = parsed.lines.map((line, i) => ({ row: i + 2, group: str(line.group as never), docNo: str(line.docNo as never), line, errors: {}, doc: "" }));
  // one document per Group label; rows without a Group are grouped by a typed DocNo, else one document per row
  const groups = new Map<string, ExpBulkRow[]>();
  rows.forEach((r, i) => {
    const k = r.group ? `g:${key(r.group)}` : r.docNo ? `d:${key(r.docNo)}` : `r:${i}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  });

  const docs: ExpDocData[] = [];
  const typed = new Map<string, string>();
  for (const [gk, g] of groups) {
    const nums = [...new Set(g.map((r) => r.docNo).filter(Boolean).map((x) => key(x)))];
    if (nums.length > 1) g[0].errors.docNo = "Rows of one Group carry different DocNo values - give one number or leave DocNo blank";
    const docNo = g.find((r) => r.docNo)?.docNo || null;
    if (docNo) {
      const o = typed.get(key(docNo));
      if (o && o !== gk) g[0].errors.docNo = "This DocNo is used by two different documents in this file";
      typed.set(key(docNo), gk);
    }
    const label = g[0].group ? `Group ${g[0].group}` : docNo ?? "";
    g.forEach((r, j) => (r.doc = g.length > 1 ? `${label || "new doc"} · line ${String(j + 1).padStart(2, "0")}` : label));
    const n = await normalizeExpDoc({ docNo, lines: g.map((r) => r.line) }, null);
    for (const [k, v] of Object.entries(n.errors)) {
      const m = /^line\.(\d+)\.(.+)$/.exec(k);
      if (m) g[Number(m[1])].errors[m[2]] = v;
      else g[0].errors[k === "lines" ? "docNo" : k] = v;
    }
    docs.push(n.data);
  }

  // the same cheque / UTR number, date and amount in two different documents of this file
  const seen = new Map<string, ExpBulkRow>();
  rows.forEach((r, i) => {
    const l = r.line;
    if (!l.instrNo || !l.instrDate) return;
    const k = [key(l.instrNo), l.instrDate, l.gross, l.rp].join("|");
    const o = seen.get(k);
    const sameDoc = o && ((r.group && key(o.group) === key(r.group)) || (!r.group && r.docNo && key(o.docNo) === key(r.docNo)));
    if (o && !sameDoc && !r.errors.instrNo) r.errors.instrNo = `Same Chq/UTR No, date and amount as row ${o.row} of this file`;
    if (!o) seen.set(k, r);
    void i;
  });
  return { rows, warnings, documents: groups.size, docs };
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
    ["Delete the three example rows before uploading. Save as .xlsx or CSV (UTF-8). Keep the header row as it is."],
    ["One row = one Exp line. To make one transaction of several rows, type the same label in the Group column on each of those rows (A, B, 1, 2, Rent-Oct ... anything). They are saved as ONE document with an automatic number (Chq-nnnnn for Chq, RPnnnnn otherwise) and the lines are numbered -01, -02 ... in the order of the rows. The Group label is only a marker for the file; it is not stored."],
    ["Rows with a blank Group are one document each. Use DocNo only if you want to choose a document number yourself (leave it blank for automatic numbers)."],
    [`Required: PayDate, Head, Mode, R/P, Gross, and Emp (Emp is taken from the booking when BkgID is filled). Up to ${EXP_BULK_MAX} rows per upload.`],
    ["Dates: dd-mm-yyyy or yyyy-mm-dd. ValueDate defaults to PayDate. R/P: Receipt or Payment (a negative Gross is read as a Payment of that amount)."],
    ["Mode = Chq lines also need Purpose, PaymentMode (Cheque, RTGS, UPI...), Chq/UTR No and Chq/UTR Date. For other modes those columns are ignored."],
    ["BkgID must exist in Bkg. Emp must match the Emp sheet exactly, e.g. Name~Code."],
    ["The whole file is rejected if any row has an error; nothing is saved until every row passes."],
    [`Heads: ${heads.map((h) => h.head).join(", ")}`],
    [`Modes: ${modes.join(", ")}`],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 160;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const expTemplateCsv = () => Papa.unparse({ fields: EXP_TEMPLATE_COLUMNS, data: [] });
