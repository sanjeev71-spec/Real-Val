// The Bkg Excel download colours its headings: light green = typed by hand (read by the upload), light grey = derived.
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

describe("Bkg download heading colours", () => {
  it("green for every input column, grey for every derived column, plus a Legend sheet", async () => {
    const { bkgWorkbook } = await import("../src/lib/excelExport");
    const { BKG_COLUMNS, BKG_INPUT_KEYS } = await import("../src/lib/fields");
    const { FILL_COLOUR, CALC_COLOUR } = await import("../src/lib/expLayout");
    const buf = await bkgWorkbook([{ BkgID: "X1", BkgLoginDate: "2026-11-01", Client: "Test" }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const hdr = wb.getWorksheet("Bkg")!.getRow(1);
    const wrong: string[] = [];
    BKG_COLUMNS.forEach((c, i) => {
      const cell = hdr.getCell(i + 1);
      const fill = (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;
      const want = BKG_INPUT_KEYS.includes(c) ? FILL_COLOUR : CALC_COLOUR;
      if (cell.value !== c || fill !== want) wrong.push(`${c}: ${fill}`);
    });
    expect(wrong).toEqual([]);
    expect(BKG_INPUT_KEYS.length).toBeGreaterThan(40);
    expect(BKG_COLUMNS.length - BKG_INPUT_KEYS.length).toBeGreaterThan(40);
    expect(wb.getWorksheet("Legend")).toBeTruthy();
  });
});
