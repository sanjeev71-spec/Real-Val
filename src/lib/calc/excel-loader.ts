// Turns the JSON exported from the Excel tables into engine inputs.
import type { ExpRow, RcRa } from "./booking";
import type { EmpRow, OverrideRule } from "./hierarchy";
import { num, str, type Cell } from "./excel";

type J = Record<string, Cell>;
const numOrNull = (x: Cell) => (typeof x === "number" ? x : x === null || x === undefined || str(x) === "" ? null : num(x));
const strOrNull = (x: Cell) => (str(x) === "" ? null : str(x));

export const empFromExcel = (rows: J[]): EmpRow[] =>
  rows
    .filter((r) => str(r.Emp) !== "")
    .map((r) => ({
      emp: str(r.Emp),
      reportingHead: str(r.ReportingHead),
      revShare: numOrNull(r.RevShare),
      expShare: numOrNull(r.ExpShare),
      branch: strOrNull(r.Branch),
      changeDateFrom: num(r.ChangeDateFrom),
      changeDateTo: num(r.ChangeDateTo),
    }));

export const expFromExcel = (rows: J[]): ExpRow[] =>
  rows.map((r) => ({
    bkgId: strOrNull(r.BkgID),
    project: strOrNull(r.Project),
    head: strOrNull(r.Head),
    mode: strOrNull(r.Mode),
    rp: strOrNull(r["R/P"]),
    gross: numOrNull(r.Gross),
    gst: numOrNull(r.GST),
    tds: numOrNull(r.TDS),
  }));

export const rcraFromExcel = (rows: J[]): RcRa[] =>
  rows.filter((r) => str(r["RC/RA"]) !== "").map((r) => ({ rcra: str(r["RC/RA"]), ra: numOrNull(r["RA%"]) }));

export const overridesFromExcel = (rows: J[]): OverrideRule[] =>
  rows
    .filter((r) => str(r.OverrideEmployee) !== "")
    .map((r) => ({
      overrideEmployee: str(r.OverrideEmployee),
      sharePct: numOrNull(r["Share%"]),
      branch: strOrNull(r.Branch),
      excludeDirector: strOrNull(r.ExcludeDirector),
      effectiveFrom: numOrNull(r.EffectiveFrom),
      effectiveTo: numOrNull(r.EffectiveTo),
      active: strOrNull(r.Active),
      targetDirector: strOrNull(r.TargetDirector),
      targetDownline: strOrNull(r.TargetDownline),
    }));
