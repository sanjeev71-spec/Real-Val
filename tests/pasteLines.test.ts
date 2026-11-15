import { describe, expect, it } from "vitest";
import { parsePaste, parsePasteDate } from "../src/lib/pasteLines";

describe("parsePaste", () => {
  it("reads the default column order", () => {
    const r = parsePaste("Brokerage\tPayment\t1,500.50\t0\t0\tTRPL5001\tAman Jain~TV0022\tnote\n");
    expect(r.usedHeader).toBe(false);
    expect(r.lines).toEqual([{ head: "Brokerage", rp: "Payment", gross: 1500.5, gst: 0, tds: 0, bkgId: "TRPL5001", emp: "Aman Jain~TV0022", narration: "note" }]);
  });
  it("matches columns by header name in any order", () => {
    const r = parsePaste("Gross\tHead\tPay date\tR/P\n1000\tFees\t05/03/2026\tR\n2000\tFees\t2026-03-06\tp");
    expect(r.usedHeader).toBe(true);
    expect(r.lines).toEqual([
      { gross: 1000, head: "Fees", payDate: "2026-03-05", rp: "Receipt" },
      { gross: 2000, head: "Fees", payDate: "2026-03-06", rp: "Payment" },
    ]);
  });
  it("turns a negative amount into a positive payment and warns about bad cells", () => {
    const r = parsePaste("Head\tGross\tPay date\nX\t-500\t31/02/2026");
    expect(r.lines[0]).toMatchObject({ gross: 500, rp: "Payment" });
    expect(r.warnings.join(" ")).toContain("not a date");
  });
  it("caps the number of lines", () => {
    const r = parsePaste(Array.from({ length: 10 }, (_, i) => `H\tReceipt\t${i + 1}`).join("\n"), 4);
    expect(r.lines).toHaveLength(4);
    expect(r.warnings[0]).toContain("first 4");
  });
  it("parses dates", () => {
    expect(parsePasteDate("5.3.26")).toBe("2026-03-05");
    expect(parsePasteDate("46086")).toBe("2026-03-05");
    expect(parsePasteDate("nope")).toBeNull();
  });
});
