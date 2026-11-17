import "server-only";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { str } from "./calc/excel";

/** Reads an uploaded .xlsx (sheet "Bookings" / "Exp" / the first sheet) or .csv into rows keyed by the header row. Dates come back as yyyy-mm-dd. */
export async function parseUpload(name: string, buf: ArrayBuffer): Promise<Record<string, unknown>[]> {
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets.find((w) => ["bookings", "bkg", "exp"].includes(w.name.toLowerCase())) ?? wb.worksheets[0];
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
  const text = new TextDecoder().decode(buf).replace(/^\uFEFF/, "");
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  return res.data;
}
