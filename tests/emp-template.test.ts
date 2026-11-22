// Emp upload template: green headings (typed by hand), grey reference sheet, instructions.
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

describe("Emp upload template", () => {
  it("has green headings for every upload column, examples, instructions and a grey reference sheet", async () => {
    const { empTemplateXlsx, EMP_UPLOAD_COLUMNS } = await import("../src/lib/empUpload");
    const { FILL_COLOUR, CALC_COLOUR } = await import("../src/lib/expLayout");
    const buf = await empTemplateXlsx([{ emp: "A B~1", reportingHead: "A B~1", branch: "Noida", designation: "Director", director: "A B~1", active: true }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(buf).buffer);
    const ws = wb.getWorksheet("Emp upload")!;
    const hdr = ws.getRow(1);
    EMP_UPLOAD_COLUMNS.forEach(([h], i) => {
      expect(hdr.getCell(i + 1).value).toBe(h);
      expect((hdr.getCell(i + 1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe(FILL_COLOUR);
    });
    expect(ws.getRow(2).getCell(1).value).toBe("New");
    expect(ws.getRow(5).getCell(1).value).toBe("Exit");
    expect(wb.getWorksheet("Instructions")).toBeTruthy();
    const ref = wb.getWorksheet("Current employees")!;
    expect((ref.getRow(1).getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe(CALC_COLOUR);
    expect(ref.getRow(2).getCell(1).value).toBe("A B~1");
  });
});
