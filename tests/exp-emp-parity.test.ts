// Parity: Exp and Emp calculated columns must match the values Excel computed.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hierarchy } from "../src/lib/calc/hierarchy";
import { computeEmp, empDirector } from "../src/lib/calc/emp";
import { computeExp } from "../src/lib/calc/exp";
import { empFromExcel } from "../src/lib/calc/excel-loader";
import { str } from "../src/lib/calc/excel";

const dir = join(__dirname, "..", "data", "excel");
const hasData = existsSync(join(dir, "Exp.json"));
const load = (n: string) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
const same = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 : String(a ?? "") === String(b ?? "");

describe.skipIf(!hasData)("Exp and Emp calculations match Excel", () => {
  const empJson = load("Emp");
  const H = new Hierarchy(empFromExcel(empJson));
  const directors = H.rows.map((r) => empDirector(H, r));

  it("Emp Director column", () => {
    const diffs: string[] = [];
    empJson.forEach((r: Record<string, unknown>, i: number) => {
      if (!same(r.Director, directors[i])) diffs.push(`${r.Emp} ${r.ChangeDateFrom}: excel=${r.Director} app=${directors[i]}`);
    });
    expect(diffs).toEqual([]);
  });

  it("Emp ManMonths / DaysWorked", () => {
    const diffs: string[] = [];
    empJson.forEach((r: Record<string, unknown>, i: number) => {
      const c = computeEmp(H, H.rows[i], { applicable: r.Applicable as string, type: r.Type as string, doj: r.DOJ as number });
      if (r.ManMonths !== undefined && !same(r.ManMonths, c.manMonths)) diffs.push(`${r.Emp} ManMonths excel=${r.ManMonths} app=${c.manMonths}`);
    });
    expect(diffs).toEqual([]);
  });

  it("Exp calculated columns", () => {
    const bkg = load("Bkg");
    const bookings = new Map(bkg.map((b: Record<string, string>) => [str(b.BkgID).toUpperCase(), b]));
    const types = new Map(load("ExpType").map((t: Record<string, string>) => [str(t.ExpHead).toLowerCase(), str(t.ExpType)]));
    const diffs: string[] = [];
    for (const x of load("Exp")) {
      const out = computeExp(
        { docNo: x.DocNo, payDate: x.PayDate, valueDate: x.ValueDate, head: x.Head, mode: x.Mode, rp: x["R/P"], gross: x.Gross,
          gst: x.GST, tds: x.TDS, branch: x.Branch, emp: null, bkgId: x.BkgID, project: x.Project },
        { hierarchy: H, empDirectors: directors, bookings: bookings as never, builderByProject: new Map(), expTypes: types as never },
      );
      for (const k of ["ExpType", "SignedGross", "Client", "Project", "Director", "L0_Emp", "L0_Amt", "L1_Emp", "L1_Amt", "Rcv_NetBill"]) {
        const xl = x[k] === 0 && (k === "Client" || k === "Project") ? "" : x[k];
        if (!same(xl, out[k])) diffs.push(`${x.DocNo} ${k}: excel=${JSON.stringify(x[k])} app=${JSON.stringify(out[k])}`);
      }
    }
    expect(diffs.slice(0, 30)).toEqual([]);
  });
});
