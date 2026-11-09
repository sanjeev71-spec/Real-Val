// Parity test: every calculated Bkg column must match the values Excel computed.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeAll } from "../src/lib/calc/booking";
import { Hierarchy } from "../src/lib/calc/hierarchy";
import { empFromExcel, expFromExcel, overridesFromExcel, rcraFromExcel } from "../src/lib/calc/excel-loader";
import { BKG_COLUMNS, BKG_INPUT_KEYS } from "../src/lib/fields";

const load = (n: string) => JSON.parse(readFileSync(join(__dirname, "..", "data", "excel", `${n}.json`), "utf8"));

// data/ holds real client data and is not in git, so this test only runs where it has been exported.
const hasData = existsSync(join(__dirname, "..", "data", "excel", "Bkg.json"));

describe.skipIf(!hasData)("Bkg calculations match Excel", () => {
  const bkg: Record<string, unknown>[] = load("Bkg");
  const inputs = bkg.map((row) => Object.fromEntries(BKG_INPUT_KEYS.map((k) => [k, row[k] as never])));
  const out = computeAll(inputs, {
    hierarchy: new Hierarchy(empFromExcel(load("Emp"))),
    exp: expFromExcel(load("Exp")),
    rcra: rcraFromExcel(load("RCRAMaster")),
    overrides: overridesFromExcel(load("OverrideRules")),
  });

  it("has the same 120 columns in the same order", () => {
    expect(BKG_COLUMNS).toEqual(Object.keys(bkg[0]));
  });

  it("every computed cell matches", () => {
    const diffs: string[] = [];
    bkg.forEach((xl, i) => {
      for (const col of BKG_COLUMNS) {
        if (BKG_INPUT_KEYS.includes(col)) continue;
        const a = xl[col] ?? "";
        const b = out[i][col] ?? "";
        const same =
          typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a)) : String(a) === String(b);
        if (!same) diffs.push(`${xl.BkgID} ${col}: excel=${JSON.stringify(a)} app=${JSON.stringify(b)}`);
      }
    });
    expect(diffs.slice(0, 40)).toEqual([]);
  });
});
