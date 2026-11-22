import "server-only";
import ExcelJS from "exceljs";
import { BKG_COLUMNS, DATE_KEYS } from "@/lib/fields";
import { CALC_CELL_COLOUR, CALC_COLOUR, EXP_DOWNLOAD_COLUMNS, EXP_GROUP_COL, EXP_REMARK_COL, FILL_COLOUR, REMARK_COLOUR, colNote, kindOfCol } from "@/lib/expLayout";
import { sortBkgByDate } from "@/lib/bkgFilter";

// One place that builds the Bkg and Exp workbooks, so the Bkg, Exp and Data exceptions downloads always have the same format.
type Row = Record<string, unknown>;

/** Written in Bkg Date order with the latest booking at the bottom (the list on screen shows the latest on top). */
export async function bkgWorkbook(rowsAny: Row[]): Promise<ArrayBuffer> {
  const rows = sortBkgByDate(rowsAny, "asc");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bkg");
  ws.columns = BKG_COLUMNS.map((c) => ({ header: c, key: c, width: Math.max(10, c.length + 2), style: DATE_KEYS.has(c) ? { numFmt: "dd-mm-yyyy" } : {} }));
  for (const r of rows) {
    ws.addRow(Object.fromEntries(BKG_COLUMNS.map((c) => {
      const v = r[c];
      if (DATE_KEYS.has(c) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return [c, new Date(`${v}T00:00:00Z`)];
      return [c, v ?? null];
    })));
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/**
 * Exp rows are given newest first (as listed) and written oldest first, like the Excel sheet.
 * Data Exception Remarks and Group come first; headings are green (type by hand, read on upload) or grey (built in, ignored on upload).
 * Emp and Project are the values typed on the entry (when `stored` is given), so an unchanged file uploads as no change.
 * An entry without a DocNo shows its row id there (as the Exp list does); typing that number back identifies the entry on upload.
 */
export async function expWorkbook(rowsNewestFirst: Row[], remarks: Map<number, string> = new Map(), stored?: Map<number, { emp: string | null; project: string | null }>): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Exp");
  const dates = new Set(["PayDate", "ValueDate", "Chq/UTR Date"]);
  ws.columns = EXP_DOWNLOAD_COLUMNS.map((c) => {
    const kind = kindOfCol(c);
    const style: Partial<ExcelJS.Style> = {};
    if (dates.has(c)) style.numFmt = "dd-mm-yyyy";
    if (kind === "calc") style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CALC_CELL_COLOUR } };
    if (kind === "remark") style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: REMARK_COLOUR } };
    return { header: c, key: c, width: c === EXP_REMARK_COL ? 38 : Math.max(10, c.length + 2), style };
  });
  for (const r of [...rowsNewestFirst].reverse()) {
    const id = Number(r.id);
    ws.addRow(Object.fromEntries(EXP_DOWNLOAD_COLUMNS.map((c) => {
      if (c === EXP_REMARK_COL) return [c, remarks.get(id) ?? null];
      if (c === EXP_GROUP_COL) return [c, null];
      if (c === "DocNo") return [c, r.DocNo || (Number.isFinite(id) ? id : null)];
      if (stored && stored.has(id) && (c === "Emp" || c === "Project")) return [c, c === "Emp" ? stored.get(id)!.emp : stored.get(id)!.project];
      return [c, dates.has(c) && typeof r[c] === "string" ? new Date(`${r[c]}T00:00:00Z`) : r[c] ?? null];
    })));
  }
  const hdr = ws.getRow(1);
  hdr.font = { bold: true };
  EXP_DOWNLOAD_COLUMNS.forEach((c, i) => {
    const cell = hdr.getCell(i + 1);
    const kind = kindOfCol(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: kind === "fill" ? FILL_COLOUR : kind === "remark" ? REMARK_COLOUR : CALC_COLOUR } };
    cell.note = colNote(c);
  });
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXP_DOWNLOAD_COLUMNS.length } };

  const help = wb.addWorksheet("Legend");
  [
    ["HOW TO USE THIS FILE"],
    ["Green headings = columns you type or correct by hand; they are read when you upload this file. Grey headings and grey cells = built in (calculated); they are ignored on upload even if you change them. Yellow = Data Exception Remarks: what is missing or wrong in that entry (built in, ignored on upload)."],
    ["Filter the Data Exception Remarks column to see the entries to complete, fill in the green cells, then upload the file on the Exp bulk upload page. Up to 500 rows per upload - keep only the rows you want to upload (or filter and copy them to a new file), or upload in parts."],
    ["Group (empty): type a label on rows that must become ONE document. To add a new entry to an existing document, give the SAME label to the existing row (keep its DocNo) and to the new row (leave DocNo blank). The old entry's DocNo does not change."],
    ["An entry that has no DocNo shows its row id in the DocNo column. Keep that number as it is - it identifies the entry."],
    ["To empty a cell on purpose type [clear]. Dates dd-mm-yyyy. The upload checks every row; nothing is saved unless all rows pass."],
    ["Columns, in this order, are the same as in the upload template (which leaves out the grey ones). ExpMonth is green: blank = built in from PayDate; a month typed there (yyyy-mm) is kept as typed."],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 160;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const stampDate = () => new Date().toISOString().slice(0, 10);
