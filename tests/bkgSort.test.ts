import { describe, expect, it } from "vitest";
import { filterBkg, sortBkgByDate } from "../src/lib/bkgFilter";

const rows = [
  { BkgID: "B1", BkgLoginDate: "2026-03-01", FormStatus: "Live" },
  { BkgID: "B2", BkgLoginDate: "2026-05-09", FormStatus: "Cancel" },
  { BkgID: "B3", BkgLoginDate: "", FormStatus: "Not Live" },
  { BkgID: "B4", BkgLoginDate: "2026-05-09", FormStatus: "Live" },
];
describe("Bkg order and FormStatus filter", () => {
  it("shows latest date on top, blanks at the end, ties by BkgID (newest id first)", () => {
    expect(sortBkgByDate(rows, "desc").map((r) => r.BkgID)).toEqual(["B4", "B2", "B1", "B3"]);
  });
  it("downloads in the exact reverse: latest date at the bottom", () => {
    expect(sortBkgByDate(rows, "asc").map((r) => r.BkgID)).toEqual(["B3", "B1", "B2", "B4"]);
  });
  it("filters FormStatus exactly", () => {
    expect(filterBkg(rows, (k) => (k === "status" ? "live" : null)).map((r) => r.BkgID)).toEqual(["B1", "B4"]);
  });
});
