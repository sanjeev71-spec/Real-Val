import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { parsePaste, type PastedLine } from "./pasteLines";
import { normalizeExpDoc, type Errors, type ExpDocData } from "./changes";
import { activeModes, expHeadList } from "./data";
import { str } from "./calc/excel";

// Bulk upload of Exp lines (Master). One row = one Exp line. Rows with the same DocNo become one document (lines 01, 02 ...);
// rows with a blank DocNo are one document each, numbered automatically (Chq-nnnnn / RPnnnnn).
export const EXP_TEMPLATE_COLUMNS = ["DocNo", "PayDate", "ValueDate", "Head", "Mode", "R/P", "Gross", "GST", "TDS", "BkgID", "Emp", "Project", "Branch", "Narration", "Remarks", "Purpose", "PaymentMode", "Chq/UTR No", "Chq/UTR Date", "Bank Name"];
export const EXP_BULK_MAX = 500;

export interface ExpBulkRow { row: number; docNo: string; line: PastedLine; errors: Errors }
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

  const rows: ExpBulkRow[] = parsed.lines.map((line, i) => ({ row: i + 2, docNo: str(line.docNo as never), line, errors: {} }));
  // group by typed DocNo; blank = one document per row
  const groups = new Map<string, ExpBulkRow[]>();
  rows.forEach((r, i) => {
    const k = r.docNo ? `d:${key(r.docNo)}` : `r:${i}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  });

  const docs: ExpDocData[] = [];
  for (const g of groups.values()) {
    const n = await normalizeExpDoc({ docNo: g[0].docNo || null, lines: g.map((r) => r.line) }, null);
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
    const sameDoc = o && (r.docNo ? key(o.docNo) === key(r.docNo) : false);
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
  ex({ PayDate: "20-10-2026", Head: head, Mode: mode, "R/P": "Payment", Gross: 1500, Emp: "Employee~Code", Narration: "Example: its own document, number given automatically" });
  ex({ DocNo: "VCH-1001", PayDate: "20-10-2026", Head: head, Mode: mode, "R/P": "Payment", Gross: 800, Emp: "Employee~Code", Narration: "Example: line 1 of document VCH-1001" });
  ex({ DocNo: "VCH-1001", PayDate: "20-10-2026", Head: head, Mode: mode, "R/P": "Payment", Gross: 700, Emp: "Employee~Code", Narration: "Example: line 2 of document VCH-1001" });
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  EXP_TEMPLATE_COLUMNS.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(12, c.length + 2)));

  const help = wb.addWorksheet("Instructions");
  [
    ["Delete the three example rows before uploading. Save as .xlsx or CSV (UTF-8). Keep the header row as it is."],
    ["One row = one Exp line. Rows with the same DocNo form one document; rows with a blank DocNo are one document each (numbered automatically: Chq-nnnnn for Chq, RPnnnnn otherwise)."],
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
