// Parity: the Demand report must match the Excel DemandAll sheet (except the date columns that the
// sheet fixes by hand and the TODAY-based delay days).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeAll } from "../src/lib/calc/booking";
import { computeDemand } from "../src/lib/calc/demand";
import { Hierarchy } from "../src/lib/calc/hierarchy";
import { empFromExcel, expFromExcel, overridesFromExcel, rcraFromExcel } from "../src/lib/calc/excel-loader";
import { BKG_INPUT_KEYS } from "../src/lib/fields";

const dir = join(__dirname, "..", "data", "excel");
const hasData = existsSync(join(dir, "DemandAll.json"));
const load = (n: string) => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));

const MAP: [string, string][] = [
  ["Director", "Director"], ["BrokerName", "BrokerName"], ["Client", "Client"], ["Area", "Area"], ["BSPPSF", "BSPPSF"],
  ["AgreementRevisedPSF", "AgreementRevisedPSF"], ["OtherChargesPSF", "OtherChargesPSF"], ["TotalCostPSF", "TotalCostPSF"],
  ["TotalCostAmt", "TotalCostAmt"], ["GST", "GST"], ["Effective TotalCostAmt", "EffTotalCostAmt"], ["Effective TCWithGST", "EffTCWithGST"],
  ["ChqAmt Recd", "ChqAmt"], ["1st Demand Due Date", "FirstDueDate"], ["1st Demand Amt (40%)", "FirstDemandAmt"],
  ["Net Recd (excl GST)", "NetRecdExGST"], ["1st AgreementRevised Offset", "FirstAROffset"], ["1st Net Demand", "FirstNetDemand"],
  ["1st Net Demand Including GST", "FirstNetDemandGST"], ["BBA Status", "BBAStatus"], ["SPD", "SPD"],
  ["2nd Demand Amt (30%)", "SecondDemandAmt"], ["2nd AgreementRevised Offset", "SecondAROffset"], ["2nd Net Demand", "SecondNetDemand"],
  ["3rd Demand Amt (30%)", "ThirdDemandAmt"], ["3rd Net Demand", "ThirdNetDemand"], ["Total Net Demand Outstanding", "TotalOutstanding"],
];

describe.skipIf(!hasData)("Demand report matches Excel DemandAll", () => {
  it("every numeric and text column", () => {
    const bkg: Record<string, unknown>[] = load("Bkg");
    const inputs = bkg.map((row) => Object.fromEntries(BKG_INPUT_KEYS.map((k) => [k, row[k] as never])));
    const rows = computeAll(inputs, {
      hierarchy: new Hierarchy(empFromExcel(load("Emp"))),
      exp: expFromExcel(load("Exp")),
      rcra: rcraFromExcel(load("RCRAMaster")),
      overrides: overridesFromExcel(load("OverrideRules")),
    });
    const byId = new Map(rows.map((r) => [String(r.BkgID), r]));
    const diffs: string[] = [];
    for (const xl of load("DemandAll")) {
      const b = byId.get(xl.BkgID);
      if (!b) { diffs.push(`${xl.BkgID} missing`); continue; }
      const d = computeDemand(b, { today: 0, structureDate: null, possessionDate: null }) as unknown as Record<string, unknown>;
      for (const [x, k] of MAP) {
        const a = xl[x] ?? (typeof d[k] === "number" ? 0 : "");
        const v = d[k];
        const same = typeof a === "number" && typeof v === "number" ? Math.abs(a - v) < 1e-4 : String(a) === String(v ?? "");
        if (!same) diffs.push(`${xl.BkgID} ${x}: excel=${JSON.stringify(xl[x])} app=${JSON.stringify(v)}`);
      }
    }
    expect(diffs.slice(0, 30)).toEqual([]);
  });
});
