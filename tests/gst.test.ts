// GST rule: TRPL = zero unless an amount is typed on the booking; RealV = flat 12% of the total cost.
import { describe, expect, it } from "vitest";
import { computeBooking } from "../src/lib/calc/booking";
import { Hierarchy } from "../src/lib/calc/hierarchy";
import { COMPANY } from "../src/lib/company";
import { BKG_INPUT_KEYS } from "../src/lib/fields";

const ctx = { hierarchy: new Hierarchy([]), exp: [], rcra: [], overrides: [], allBkgIds: [] };
const base = { BkgID: "X1", Project: "P", Area: 1000, BSPPSF: 5000, BkgMonth: "2026-11-01", FormStatus: "Live", Emp: "A~1" };

describe(`GST rule (${COMPANY.key})`, () => {
  const cost = 5000 * 1000;
  if (COMPANY.gstManual) {
    it("is an input column and defaults to zero", () => {
      expect(BKG_INPUT_KEYS).toContain("GST");
      const r = computeBooking({ ...base }, ctx);
      expect(r.GST).toBe(0);
      expect(r.TCWithGST).toBe(cost);
    });
    it("uses the amount typed on the booking", () => {
      const r = computeBooking({ ...base, GST: 25000 }, ctx);
      expect(r.GST).toBe(25000);
      expect(r.TCWithGST).toBe(cost + 25000);
    });
  } else {
    it("is a calculated column at the company rate", () => {
      expect(BKG_INPUT_KEYS).not.toContain("GST");
      const r = computeBooking({ ...base }, ctx);
      expect(r.GST).toBeCloseTo(cost * COMPANY.gstRate, 6);
    });
  }
});
