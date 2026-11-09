// Calculated columns of the Excel Emp table (Director, DaysWorked, ManMonths, SeatCost, Key).
import { codeOf, eq, round } from "./excel";
import { Hierarchy, type EmpRow } from "./hierarchy";

export const SEAT_COST_PER_MONTH = 5000;
export const SEAT_DAY_BASIS = 365;
export const SEAT_EXEMPT_DAYS = 30;

export interface EmpExtra {
  applicable: string | null;
  type: string | null;
  doj: number | null; // serial
  /** End date for the day-count columns when the period is open (defaults to the row's ChangeDateTo). */
  to?: number;
}

export interface EmpComputed {
  director: string;
  daysWorked: number;
  manMonths: number;
  seatCost: number;
  key: string;
}

/** Director as of the start of this period, following the reporting head's period that overlaps it. */
export function empDirector(H: Hierarchy, row: EmpRow): string {
  const C = codeOf(row.emp);
  if (C === "") return "";
  const Hc = codeOf(row.reportingHead);
  const F = row.changeDateFrom;
  const T = row.changeDateTo;
  const i = Hc === "" ? -1 : H.rowFromOnOrBefore(Hc, T);
  const d = i >= 0 && H.rows[i].changeDateTo >= F ? Math.max(F, H.rows[i].changeDateFrom) : F;
  try {
    return H.directorNameAt(C, d);
  } catch {
    return "";
  }
}

export function computeEmp(H: Hierarchy, row: EmpRow, extra: EmpExtra): EmpComputed {
  const F = row.changeDateFrom;
  const T = extra.to ?? row.changeDateTo;
  const sales = eq(extra.type, "Sales");
  const seatStart = Math.max(F, (extra.doj ?? F) + SEAT_EXEMPT_DAYS);
  return {
    director: empDirector(H, row),
    daysWorked: T - F,
    manMonths: sales ? round(((T - F) / 365) * 12, 2) : 0,
    seatCost: eq(extra.applicable, "Y") && sales ? round((Math.max(0, T - seatStart) / SEAT_DAY_BASIS) * SEAT_COST_PER_MONTH * 12, 0) : 0,
    key: `${codeOf(row.emp)}|${String(F).padStart(6, "0")}`,
  };
}
