// Master data shapes shared by server and browser, plus the SCD auto-fill rules.
import { isoToSerial, str, num } from "./calc/excel";
import { Hierarchy, type EmpRow } from "./calc/hierarchy";

export interface MasterData {
  projects: { name: string; location: string | null; builder: string | null }[];
  inventory: { project: string; unitNo: string; area: number | null; status: "Available" | "Sold" | "On Hold" | "Unit Sold Twice" }[];
  priceList: {
    project: string; dateFrom: string; dateTo: string | null; bsp: number | null; oc: number | null;
    paymentPlan: string | null; slab: number | null; slabType: string | null;
    structureDate: string | null; possessionDate: string | null;
  }[];
  employees: EmpRow[]; // Excel row order
  rcra: { name: string; ra: number | null }[];
}

export type FormData = Record<string, string | number | null>;

export function priceListFor(m: MasterData, project: unknown, date: unknown) {
  const d = isoToSerial(date as string);
  if (!str(project as string) || d === null) return null;
  return (
    m.priceList.find(
      (p) =>
        p.project.toLowerCase() === str(project as string).toLowerCase() &&
        d >= (isoToSerial(p.dateFrom) ?? Infinity) &&
        (p.dateTo === null || d <= (isoToSerial(p.dateTo) ?? -Infinity)),
    ) ?? null
  );
}

/** Distinct employee names (Name~Code), for the Associate dropdown. */
export function employeeNames(m: MasterData): string[] {
  return [...new Set(m.employees.map((e) => e.emp))].sort((a, b) => a.localeCompare(b));
}

/**
 * Applies the SCD auto-fill rules.
 * fixed=true  (SCD form): price-list and master values always overwrite what was typed.
 * fixed=false (bulk upload): only blanks are filled.
 * Branch is filled from the Associate's Emp row on the booking date when blank (it stays editable).
 */
export function applyLookups(input: FormData, m: MasterData, fixed: boolean): FormData {
  const out: FormData = { ...input };
  const set = (k: string, v: string | number | null | undefined) => {
    if (v === undefined) return;
    if (fixed || out[k] === null || out[k] === undefined || str(out[k]) === "") out[k] = v;
  };
  if (out.BkgLoginDate && !out.BkgMonth) out.BkgMonth = out.BkgLoginDate;
  if (fixed) out.BkgMonth = out.BkgLoginDate ?? null;

  const proj = m.projects.find((p) => p.name.toLowerCase() === str(out.Project).toLowerCase());
  if (proj) {
    set("ProjectLocation", proj.location);
    set("Builder", proj.builder);
  }
  const unit = m.inventory.find(
    (u) => u.project.toLowerCase() === str(out.Project).toLowerCase() && u.unitNo === str(out.UnitNo),
  );
  if (unit) set("Area", unit.area);

  const pl = priceListFor(m, out.Project, out.BkgLoginDate);
  if (pl) {
    set("BSPPSF", pl.bsp);
    set("OtherChargesPSF", pl.oc);
    set("PaymentPlan", pl.paymentPlan);
    set("DSlab", pl.slab);
    set("DSlabType", pl.slabType);
  }

  if (str(out.Branch) === "" && out.Emp) {
    const d = isoToSerial(out.BkgLoginDate as string);
    const code = str(out.Emp).split("~")[1] ?? "";
    if (d !== null && code) out.Branch = new Hierarchy(m.employees).branchAt(code, d);
  }
  return out;
}

/** Demand schedule from a payment plan like "40-30-30": booking (+60 days), structure, possession. */
export function demandSchedule(data: FormData, m: MasterData) {
  const plan = str(data.PaymentPlan);
  const parts = plan.split("-").map((x) => num(x) / 100).filter((x) => x > 0);
  if (!parts.length) return [];
  const pl = priceListFor(m, data.Project, data.BkgLoginDate);
  const bookingDate = isoToSerial(data.BkgLoginDate as string);
  const labels = ["Within 60 days of booking", "On structure completion", "On possession offer"];
  const dates = [
    bookingDate === null ? null : bookingDate + 60,
    isoToSerial(pl?.structureDate ?? null),
    isoToSerial(pl?.possessionDate ?? null),
  ];
  return parts.map((pct, i) => ({ label: labels[i] ?? `Instalment ${i + 1}`, pct, date: dates[i] ?? null }));
}
