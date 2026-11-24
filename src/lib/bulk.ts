import "server-only";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { str } from "./calc/excel";

/** The rows of one worksheet keyed by its header row (dates as yyyy-mm-dd, formula cells as their result). */
function rowsOfSheet(ws: ExcelJS.Worksheet): Record<string, unknown>[] {
  const header: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (header[i - 1] = str(c.text)));
  const out: Record<string, unknown>[] = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    if (/^total \(/i.test(str(r.getCell(1).text))) return; // the Total row of the Director pack Bkg Data sheet
    const o: Record<string, unknown> = {};
    header.forEach((h, j) => {
      const v = r.getCell(j + 1).value;
      o[h] = v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v instanceof Date ? v.toISOString().slice(0, 10) : v;
    });
    out.push(o);
  });
  return out.filter((o) => Object.values(o).some((v) => v !== null && v !== undefined && String(v).trim() !== ""));
}

/** The combined Bkg / Exp / Emp file: the rows of each sheet (null when the file has no such sheet). */
export async function parseCombined(buf: ArrayBuffer): Promise<{ bkg: Record<string, unknown>[] | null; exp: Record<string, unknown>[] | null; emp: Record<string, unknown>[] | null }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const pick = (names: string[]) => { const ws = wb.worksheets.find((w) => names.includes(w.name.trim().toLowerCase())); return ws ? rowsOfSheet(ws) : null; };
  return { bkg: pick(["bkg", "bookings", "bkg data"]), exp: pick(["exp", "exp data"]), emp: pick(["emp", "employee data"]) };
}

/** Reads an uploaded .xlsx (sheet "Bookings" / "Exp" / the first sheet) or .csv into rows keyed by the header row. Dates come back as yyyy-mm-dd. */
export async function parseUpload(name: string, buf: ArrayBuffer, kind?: "bkg" | "exp"): Promise<Record<string, unknown>[]> {
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets.find((w) => (kind === "bkg" ? ["bookings", "bkg", "bkg data"] : kind === "exp" ? ["exp", "exp data"] : ["bookings", "bkg", "exp"]).includes(w.name.trim().toLowerCase())) ?? wb.worksheets[0];
    return rowsOfSheet(ws);
  }
  const text = new TextDecoder().decode(buf).replace(/^\uFEFF/, "");
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  return res.data;
}
