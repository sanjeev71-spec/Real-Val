// Port of the Emp hierarchy LAMBDAs in the RealV workbook
// (EmpRowAt, ChainUp, EmpLastTo, Bridge1, RHAt, RevShareAt, ExpShareAt,
//  DirectorAt, DirectorNameAt, ShareCodeAt, OverrideAt).
import { codeOf, eq, str, type Cell } from "./excel";

export interface EmpRow {
  emp: string; // "Name~Code"
  reportingHead: string; // "Name~Code"
  revShare: number | null;
  expShare: number | null;
  branch: string | null;
  changeDateFrom: number; // Excel serial
  changeDateTo: number; // Excel serial
}

export interface OverrideRule {
  overrideEmployee: string;
  sharePct: number | null;
  branch: string | null;
  excludeDirector: string | null;
  effectiveFrom: number | null;
  effectiveTo: number | null;
  active: string | null;
  targetDirector: string | null;
  targetDownline: string | null;
}

export const DEFAULT_DIRECTOR_CODE = "200001";

export class Hierarchy {
  private byCode = new Map<string, number[]>(); // code -> row indexes (table order)

  constructor(public readonly rows: EmpRow[]) {
    rows.forEach((r, i) => {
      const c = codeOf(r.emp);
      if (!c) return;
      const k = c.toLowerCase();
      const list = this.byCode.get(k) ?? [];
      list.push(i);
      this.byCode.set(k, list);
    });
  }

  /** Row whose period starts last on/before d for this code (Excel: XMATCH(code|d, Key, -1)). 0-based, -1 = none. */
  private rowFromOnOrBefore(code: string, d: number): number {
    const list = this.byCode.get(code.toLowerCase());
    if (!list) return -1;
    let best = -1;
    for (const i of list) {
      const f = this.rows[i].changeDateFrom;
      if (f <= d && (best < 0 || f > this.rows[best].changeDateFrom)) best = i;
    }
    return best;
  }

  /** EmpRowAt: row valid on date d, or -1. */
  rowAt(code: Cell, d: Cell): number {
    const c = str(code);
    if (c === "" || typeof d !== "number") return -1;
    const i = this.rowFromOnOrBefore(c, d);
    if (i < 0) return -1;
    return this.rows[i].changeDateTo >= d ? i : -1;
  }

  /** ChainUp: reporting head code on date d ("" if none / self). */
  chainUp(code: string, d: number): string {
    if (code === "") return "";
    const i = this.rowFromOnOrBefore(code, d);
    if (i < 0 || !(this.rows[i].changeDateTo >= d)) return "";
    const p = codeOf(this.rows[i].reportingHead);
    return eq(p, code) ? "" : p;
  }

  /** EmpLastTo: ChangeDateTo of the employee's latest period, 0 if unknown. */
  lastTo(code: string): number {
    if (code === "") return 0;
    const i = this.rowFromOnOrBefore(code, Number.MAX_SAFE_INTEGER);
    return i < 0 ? 0 : this.rows[i].changeDateTo;
  }

  /** Bridge1: if x has no row on d (exited), jump to whoever x reported to at exit. */
  bridge1(x: string, d: number): string {
    if (x === "") return "";
    if (this.rowAt(x, d) < 0) {
      const lt = this.lastTo(x);
      return lt === 0 ? "" : this.chainUp(x, lt);
    }
    return x;
  }

  /** RHAt: reporting head on d, bridging up to four exited managers. */
  rhAt(code: string, d: number): string {
    let x = this.chainUp(code, d);
    for (let k = 0; k < 4; k++) x = this.bridge1(x, d);
    return x;
  }

  revShareAt(code: string, d: number): number {
    const i = this.rowAt(code, d);
    if (i < 0) return 0;
    const v = this.rows[i].revShare;
    return typeof v === "number" ? v : 0;
  }

  expShareAt(code: string, d: number): number {
    const i = this.rowAt(code, d);
    if (i < 0) return 0;
    const v = this.rows[i].expShare;
    return typeof v === "number" ? v : 0;
  }

  /** DirectorAt: picks the person just below the top of the chain if they carry RevShare, else 200001. */
  directorAt(code: string, d: number): string {
    const chain: string[] = [code];
    for (let k = 0; k < 7; k++) chain.push(this.rhAt(chain[chain.length - 1], d));
    const n = chain.filter((x) => x !== "").length;
    if (n === 0) throw new Error("#VALUE!");
    const pick = [chain[0], chain[0], chain[1], chain[2], chain[3], chain[4], chain[5], chain[6]];
    const q = pick[n - 1];
    return this.revShareAt(q, d) !== 0 ? q : DEFAULT_DIRECTOR_CODE;
  }

  /** First Emp value ("Name~Code") with this code, in table order. */
  nameOfCode(code: string): string | null {
    const list = this.byCode.get(code.toLowerCase());
    return list && list.length ? this.rows[Math.min(...list)].emp : null;
  }

  directorNameAt(code: string, d: number): string {
    const k = this.directorAt(code, d);
    if (k === "") return "";
    return this.nameOfCode(k) ?? k;
  }

  /** Name~Code of the employee row valid on d, falling back to the bare code. */
  nameAt(code: string, d: number): string {
    const i = this.rowAt(code, d);
    return i < 0 ? code : this.rows[i].emp;
  }

  /** Six-level chain of reporting-head codes joined with ">" (RS_ChainCodes). */
  chainCodes(code: string, d: number): string {
    const out: string[] = [];
    let x = code;
    for (let k = 0; k < 6; k++) {
      x = this.rhAt(x, d);
      if (x !== "") out.push(x);
    }
    return out.join(">");
  }

  /** ShareCodeAt list: employee + chain, de-duplicated, keeping only codes with RevShare <> 0. */
  shareList(code: string, d: number, chain: string): string[] {
    const raw = [code, ...(chain === "" ? [""] : chain.split(">"))];
    const seen = new Set<string>();
    const uniq: string[] = [];
    for (const r of raw) {
      const k = r.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(r);
    }
    return uniq.filter((x) => this.revShareAt(x, d) !== 0);
  }

  /** Branch on the employee's row valid on date d. */
  branchAt(code: string, d: number): string | null {
    const i = this.rowAt(code, d);
    return i < 0 ? null : this.rows[i].branch;
  }
}

/** OverrideAt: first active rule whose scope covers this booking. */
export function overrideAt(
  rules: OverrideRule[],
  branch: Cell,
  director: Cell,
  bkgMonth: number,
  employee: Cell,
  chain: string,
): string {
  const ec = codeOf(employee) || str(employee);
  for (const r of rules) {
    const dl = str(r.targetDownline);
    const td = str(r.targetDirector);
    const dc = codeOf(dl) || dl;
    const down =
      dl !== "" && (eq(dc, ec) || (">" + chain + ">").toLowerCase().includes((">" + dc + ">").toLowerCase()));
    const scope =
      down ||
      (dl === "" && td !== "" && eq(td, director)) ||
      (dl === "" && td === "" && eq(r.branch, branch) && !eq(r.excludeDirector, director));
    const inWindow =
      bkgMonth >= (r.effectiveFrom ?? 0) && (r.effectiveTo === null || bkgMonth <= r.effectiveTo);
    if (scope && eq(r.active, "Y") && inWindow) return r.overrideEmployee;
  }
  return "";
}
