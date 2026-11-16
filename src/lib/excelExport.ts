import "server-only";
import ExcelJS from "exceljs";
import { BKG_COLUMNS, DATE_KEYS } from "@/lib/fields";
import { EXP_COLUMNS } from "@/lib/calc/exp";

// One place that builds the Bkg and Exp workbooks, so the Bkg, Exp and Data exceptions downloads always have the same format.
type Row = Record<string, unknown>;

export async function bkgWorkbook(rows: Row[]): Promise<ArrayBuffer> {
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

/** Exp rows are given newest first (as listed) and written oldest first, like the Excel sheet. */
export async function expWorkbook(rowsNewestFirst: Row[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Exp");
  const dates = new Set(["PayDate", "ValueDate", "Chq/UTR Date"]);
  ws.columns = EXP_COLUMNS.map((c) => ({ header: c, key: c, width: Math.max(10, c.length + 2), style: dates.has(c) ? { numFmt: "dd-mm-yyyy" } : {} }));
  for (const r of [...rowsNewestFirst].reverse())
    ws.addRow(Object.fromEntries(EXP_COLUMNS.map((c) => [c, dates.has(c) && typeof r[c] === "string" ? new Date(`${r[c]}T00:00:00Z`) : r[c] ?? null])));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const stampDate = () => new Date().toISOString().slice(0, 10);
