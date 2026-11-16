import { describe, expect, it } from "vitest";
import { findExceptions } from "../src/lib/calc/exceptions";

const exp = (o: Record<string, unknown>) => ({ id: 1, DocNo: "RP00001", Head: "Fees", ExpType: "Expense", PayDate: "2026-03-05", Gross: 100, "R/P": "Payment", Mode: "Cash", Emp: "A~1", Director: "D~9", ...o });

describe("findExceptions", () => {
  it("returns nothing for clean data", () => {
    const g = findExceptions([{ BkgID: "B1", FormStatus: "Live", DirectorRevenue: 5, Director: "D~9", Emp: "A~1", Builder: "X", BkgMonth: "2026-03-01" }], [exp({})], new Set(["A~1"]), new Set(["fees"]));
    expect(g).toEqual([]);
  });
  it("flags the main problems", () => {
    const bk = [
      { BkgID: "B1", FormStatus: "Live", DirectorRevenue: 0, Director: "", Emp: "Z~2", Builder: "", BkgMonth: "" },
      { BkgID: "B2", FormStatus: "Cancel", DirectorRevenue: 0, Director: "", Emp: "", Builder: "", BkgMonth: "" },
    ];
    const ex = [
      exp({ id: 1, DocNo: "RP00001", Head: "" }),
      exp({ id: 2, DocNo: "RP00002", Head: "Nope" }),
      exp({ id: 3, DocNo: "RP00003", BkgID: "B9" }),
      exp({ id: 4, DocNo: "RP00004", Head: "Recd From Client", ExpType: "Income", "R/P": "Receipt", Director: "D~9" }),
      exp({ id: 5, DocNo: "Chq-00001-01", Mode: "Chq", "Chq/UTR No": "123", "Chq/UTR Date": "2026-03-01", "Bank Name": "HDFC", Gross: 500, BkgID: "B1" }),
      exp({ id: 6, DocNo: "Chq-00002", Mode: "Chq", "Chq/UTR No": "123", "Chq/UTR Date": "2026-03-01", "Bank Name": "HDFC", Gross: 500, BkgID: "B1" }),
    ];
    const g = Object.fromEntries(findExceptions(bk, ex, new Set(["A~1"]), new Set(["fees", "recd from client"])).map((x) => [x.key, x]));
    expect(g["exp-no-head"].count).toBe(1);
    expect(g["exp-unknown-head"].count).toBe(1);
    expect(g["exp-bkg-missing"].rows[0].DocNo).toBe("RP00003");
    expect(g["exp-collection-no-bkg"].count).toBe(1);
    expect(g["chq-duplicate"].count).toBe(1);
    expect(g["bkg-no-revenue"].rows.map((i) => i.BkgID)).toEqual(["B1"]); expect(g["bkg-no-revenue"].kind).toBe("bkg"); // the cancelled booking is not reported
    expect(g["bkg-no-director"].count).toBe(1);
    expect(g["bkg-emp-unknown"].count).toBe(1);
  });
});
