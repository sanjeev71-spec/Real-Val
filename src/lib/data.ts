import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema as s, type DB } from "./db";
import { computeAll, type BookingInput, type BookingRow } from "./calc/booking";
import { Hierarchy, type EmpRow, type OverrideRule } from "./calc/hierarchy";
import { isoToSerial, str } from "./calc/excel";
import { SOLD_STATUSES } from "./fields";
import type { MasterData } from "./masters";
import { COMPANY } from "./company";
import { memo } from "./cache";

const serial = (d: string | null) => (d === null ? null : isoToSerial(d));

/** Today in India (IST), as yyyy-mm-dd and Excel serial. Open-ended Emp periods run to today. */
export function todayIso(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
export const todaySerial = () => isoToSerial(todayIso())!;

/** Open periods have no end for hierarchy lookups (an active employee is valid on any future date). */
export const OPEN_END = isoToSerial("2099-12-31")!;

export const toEmpRow = (r: typeof s.employees.$inferSelect, _today?: number): EmpRow => ({
  emp: r.emp,
  reportingHead: r.reportingHead,
  revShare: r.revShare,
  expShare: r.expShare,
  branch: r.branch,
  changeDateFrom: serial(r.changeDateFrom)!,
  changeDateTo: r.changeDateTo === null ? OPEN_END : serial(r.changeDateTo)!,
});

export async function loadEmployees(db: DB): Promise<EmpRow[]> {
  const rows = await db.select().from(s.employees).orderBy(asc(s.employees.seq));
  const today = todaySerial();
  return rows.map((r) => toEmpRow(r, today));
}

async function loadContext(db: DB) {
  const [employees, expRaw, rc, ov, bk] = await Promise.all([
    loadEmployees(db),
    db.select({ bkgId: s.expEntries.bkgId, project: s.expEntries.project, head: s.expEntries.head, mode: s.expEntries.mode, rp: s.expEntries.rp, gross: s.expEntries.gross, gst: s.expEntries.gst, tds: s.expEntries.tds }).from(s.expEntries),
    db.select().from(s.rcRa),
    db.select().from(s.overrideRules),
    db.select({ id: s.bookings.bkgId, project: sql<string>`${s.bookings.data}->>'Project'` }).from(s.bookings),
  ]);
  // Exp.Project comes from the booking when the entry has a BkgID (as in Excel)
  const projById = new Map(bk.map((b) => [b.id.toUpperCase(), b.project]));
  const exp = expRaw.map((e) => ({ ...e, project: (e.bkgId && projById.get(e.bkgId.toUpperCase())) ?? e.project }));
  const overrides: OverrideRule[] = ov.map((o) => ({
    overrideEmployee: o.overrideEmployee, sharePct: o.sharePct, branch: o.branch, excludeDirector: o.excludeDirector,
    effectiveFrom: serial(o.effectiveFrom), effectiveTo: serial(o.effectiveTo), active: o.active,
    targetDirector: o.targetDirector, targetDownline: o.targetDownline,
  }));
  return {
    hierarchy: new Hierarchy(employees),
    exp: exp.map((e) => ({ bkgId: e.bkgId, project: e.project, head: e.head, mode: e.mode, rp: e.rp, gross: e.gross, gst: e.gst, tds: e.tds })),
    rcra: rc.map((r) => ({ rcra: r.name, ra: r.ra })),
    overrides,
  };
}

/** The full Bkg table with every calculated column, in BkgID order. */
async function computedBookingsRaw(): Promise<BookingRow[]> {
  const db = await getDb();
  const [rows, ctx] = await Promise.all([db.select().from(s.bookings).orderBy(asc(s.bookings.bkgId)), loadContext(db)]);
  return computeAll(rows.map((r) => ({ ...r.data, BkgID: r.bkgId }) as BookingInput), ctx);
}

export const computedBookings = (): Promise<BookingRow[]> => memo("computedBookings", computedBookingsRaw);

/** Preview a single booking (e.g. a submission) as it would appear in Bkg. */
export async function previewBooking(data: Record<string, unknown>): Promise<BookingRow> {
  const db = await getDb();
  const [ctx, ids] = await Promise.all([loadContext(db), db.select({ id: s.bookings.bkgId }).from(s.bookings)]);
  const { computeBooking } = await import("./calc/booking");
  return computeBooking(data as BookingInput, { ...ctx, allBkgIds: ids.map((x) => x.id) });
}

const HOLD_STATUSES = ["pending_admin", "pending_master", "returned"] as const;

/** Masters for the form, with unit availability (sold = Live/Not Live booking; on hold = open submission). */
export async function loadMasters(excludeSubmissionId?: number): Promise<MasterData> {
  const db = await getDb();
  const [projects, inv, pl, employees, rc, sold, held] = await Promise.all([
    db.select().from(s.projects).orderBy(asc(s.projects.name)),
    db.select().from(s.inventory).orderBy(asc(s.inventory.project), asc(s.inventory.unitNo)),
    db.select().from(s.priceList).orderBy(asc(s.priceList.project), asc(s.priceList.dateFrom)),
    loadEmployees(db),
    db.select().from(s.rcRa),
    db
      .select({ project: sql<string>`${s.bookings.data}->>'Project'`, unit: sql<string>`${s.bookings.data}->>'UnitNo'` })
      .from(s.bookings)
      .where(inArray(sql`${s.bookings.data}->>'FormStatus'`, SOLD_STATUSES)),
    db
      .select({ id: s.submissions.id, project: sql<string>`${s.submissions.data}->>'Project'`, unit: sql<string>`${s.submissions.data}->>'UnitNo'` })
      .from(s.submissions)
      .where(inArray(s.submissions.status, [...HOLD_STATUSES])),
  ]);
  const key = (p: string | null, u: string | null) => `${str(p).toLowerCase()}|${str(u)}`;
  const soldCount = new Map<string, number>();
  for (const b of sold) soldCount.set(key(b.project, b.unit), (soldCount.get(key(b.project, b.unit)) ?? 0) + 1);
  const heldSet = new Set(held.filter((h) => h.id !== excludeSubmissionId).map((h) => key(h.project, h.unit)));
  return {
    projects: projects.map((p) => ({ name: p.name, location: p.location, builder: p.builder })),
    inventory: inv.map((u) => {
      const c = soldCount.get(key(u.project, u.unitNo)) ?? 0;
      const status = c > 1 ? "Unit Sold Twice" : c === 1 ? "Sold" : heldSet.has(key(u.project, u.unitNo)) ? "On Hold" : "Available";
      return { project: u.project, unitNo: u.unitNo, area: u.area, status };
    }),
    priceList: pl.map((p) => ({
      project: p.project, dateFrom: p.dateFrom, dateTo: p.dateTo, bsp: p.bsp, oc: p.oc, paymentPlan: p.paymentPlan,
      slab: p.slab, slabType: p.slabType, structureDate: p.structureDate, possessionDate: p.possessionDate,
    })),
    employees,
    rcra: rc.map((r) => ({ name: r.name, ra: r.ra })),
  };
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const [r] = await db.select().from(s.settings).where(eq(s.settings.key, key));
  return r?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const db = await getDb();
  await db.insert(s.settings).values({ key, value }).onConflictDoUpdate({ target: s.settings.key, set: { value } });
}

export async function usersByRole(role: "master" | "admin" | "sales") {
  const db = await getDb();
  return db.select().from(s.users).where(and(eq(s.users.role, role), eq(s.users.active, true)));
}

// ---------------------------------------------------------------- Emp & Exp views

import { empDirector } from "./calc/emp";
import { ensureEmpDerived } from "./empSync";
import { computeExp, type BookingRef, type ExpInput, type ExpRow as ExpComputedRow } from "./calc/exp";

export type EmployeeRecord = typeof s.employees.$inferSelect;

/** All Emp period rows with their calculated columns (Director, chain, DaysWorked, ManMonths, SeatCost), read from the stored columns. */
export async function employeesWithCalc() {
  await ensureEmpDerived(); // refreshes open periods once a day, and after any Emp change
  const db = await getDb();
  const rows = await db.select().from(s.employees).orderBy(asc(s.employees.seq));
  return rows.map((r) => ({
    ...r,
    calc: {
      director: r.director ?? "",
      chainPath: r.chainPath ?? "",
      daysWorked: r.daysWorked ?? 0,
      manMonths: r.manMonths ?? 0,
      seatCost: r.seatCost ?? 0,
      key: `${(r.emp.split("~")[1] ?? "")}|${String(serial(r.changeDateFrom) ?? 0).padStart(6, "0")}`,
    },
  }));
}

/** The current (latest) period of each employee code. */
export function currentPeriods<T extends { emp: string; changeDateFrom: string }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const code = r.emp.split("~")[1] ?? r.emp;
    const b = best.get(code);
    if (!b || r.changeDateFrom > b.changeDateFrom) best.set(code, r);
  }
  return [...best.values()].sort((a, b) => a.emp.localeCompare(b.emp));
}

export async function expContext() {
  const db = await getDb();
  const [empRows, bookings, heads] = await Promise.all([
    db.select().from(s.employees).orderBy(asc(s.employees.seq)),
    db.select().from(s.bookings),
    db.select().from(s.expHeads),
  ]);
  const today = todaySerial();
  const H = new Hierarchy(empRows.map((r) => toEmpRow(r, today)));
  const bmap = new Map<string, BookingRef>();
  const builderByProject = new Map<string, string | number | null>();
  for (const b of bookings) {
    const d = b.data;
    bmap.set(b.bkgId.toUpperCase(), { Emp: d.Emp ?? null, Client: d.Client ?? null, Project: d.Project ?? null, Builder: d.Builder ?? null, FormStatus: d.FormStatus ?? null });
    const p = String(d.Project ?? "").toLowerCase();
    if (p && !builderByProject.has(p)) builderByProject.set(p, d.Builder ?? null);
  }
  return {
    hierarchy: H,
    empDirectors: H.rows.map((r) => empDirector(H, r)),
    bookings: bmap,
    builderByProject,
    expTypes: new Map(heads.map((h) => [h.head.toLowerCase(), h.type ?? ""])),
  };
}

export const expInputOf = (e: typeof s.expEntries.$inferSelect): ExpInput => ({
  docNo: e.docNo, payDate: e.payDate, valueDate: e.valueDate, head: e.head, mode: e.mode, narration: e.narration, rp: e.rp,
  gross: e.gross, gst: e.gst, tds: e.tds, branch: e.branch, emp: e.emp, bkgId: e.bkgId, project: e.project, remarks: e.remarks,
  purpose: e.purpose, paymentMode: e.paymentMode, instrNo: e.instrNo, instrDate: e.instrDate, chqBank: e.chqBank, relatedEmpName: e.relatedEmpName,
});

/** Every Exp entry with its calculated columns, newest first. */
async function expWithCalcRaw(): Promise<(ExpComputedRow & { id: number })[]> {
  const db = await getDb();
  const [rows, ctx] = await Promise.all([db.select().from(s.expEntries).orderBy(desc(s.expEntries.id)), expContext()]);
  return rows.map((e) => ({ id: e.id, ...computeExp(expInputOf(e), ctx) }));
}

export const expWithCalc = (): Promise<(ExpComputedRow & { id: number })[]> => memo("expWithCalc", expWithCalcRaw);

export async function activeModes(): Promise<string[]> {
  const db = await getDb();
  return (await db.select().from(s.modes).where(eq(s.modes.active, true)).orderBy(asc(s.modes.name))).map((m) => m.name);
}

export async function expHeadList() {
  const db = await getDb();
  return db.select().from(s.expHeads).orderBy(asc(s.expHeads.head));
}

/** Suggestions for the cheque / UTR fields: values already used, most frequent first. */
async function chqLists() {
  const db = await getDb();
  const top = async (col: string) => {
    const r = await db.execute(sql.raw(`select ${col} as v from exp_entries where ${col} is not null and ${col} <> '' group by ${col} order by count(*) desc limit 60`));
    return (("rows" in r ? r.rows : r) as { v: string }[]).map((x) => x.v);
  };
  const [purposes, paymentModes, banks] = await Promise.all([top("purpose"), top("payment_mode"), top("bank_name")]);
  return { purposes, paymentModes, banks };
}

/** Dropdown data for the Exp form. */
export async function expFormData() {
  const db = await getDb();
  const [heads, modes, emp, projects, bookings] = await Promise.all([
    expHeadList(),
    activeModes(),
    db.selectDistinct({ emp: s.employees.emp }).from(s.employees).orderBy(asc(s.employees.emp)),
    db.select().from(s.projects).orderBy(asc(s.projects.name)),
    db.select({ id: s.bookings.bkgId, data: s.bookings.data }).from(s.bookings).orderBy(asc(s.bookings.bkgId)),
  ]);
  return {
    heads: heads.map((h) => ({ head: h.head, type: h.type })),
    modes,
    employees: emp.map((e) => e.emp),
    projects: projects.map((p) => p.name),
    bookings: bookings.map((b) => ({ id: b.id, client: String(b.data.Client ?? ""), emp: String(b.data.Emp ?? ""), project: String(b.data.Project ?? "") })),
    chqLists: await chqLists(),
  };
}

// ---------------------------------------------------------------- Reports

import { computeDemand, type DemandRow } from "./calc/demand";

/** Demand report rows: Live and Not Live bookings, sorted by Director, Builder, Project, Client. */
export async function demandRows(onlyEmp?: string | null): Promise<DemandRow[]> {
  const db = await getDb();
  const [rows, pl] = await Promise.all([computedBookings(), db.select().from(s.priceList)]);
  const today = todaySerial();
  const lc = (x: unknown) => String(x ?? "").toLowerCase();
  return rows
    .filter((r) => SOLD_STATUSES.includes(String(r.FormStatus ?? "")))
    .filter((r) => !onlyEmp || r.Emp === onlyEmp)
    .map((r) => {
      // 2nd / 3rd demand dates come from the project's price list on the booking date
      const d = isoToSerial(r.BkgLoginDate as string);
      const p = pl.find(
        (x) => lc(x.project) === lc(r.Project) && d !== null && d >= isoToSerial(x.dateFrom)! && (x.dateTo === null || d <= isoToSerial(x.dateTo)!),
      ) ?? pl.find((x) => lc(x.project) === lc(r.Project));
      return computeDemand(r, { today, structureDate: serial(p?.structureDate ?? null), possessionDate: serial(p?.possessionDate ?? null) });
    })
    .sort(
      (a, b) =>
        a.Director.localeCompare(b.Director) || a.Builder.localeCompare(b.Builder) || a.Project.localeCompare(b.Project) || a.Client.localeCompare(b.Client),
    );
}

export interface OrgNode {
  code: string;
  name: string; // without the code
  emp: string; // Name~Code
  headCode: string; // recorded reporting head
  active: boolean;
  revShare: boolean; // carries RevShare (shown as a director box)
  designation: string | null;
  branch: string | null;
  leftOn: string | null;
}

export const DEFAULT_PARTNERS = COMPANY.defaultPartners;

export async function partners(): Promise<string[]> {
  const v = await getSetting("partners");
  try {
    return v ? (JSON.parse(v) as string[]) : DEFAULT_PARTNERS;
  } catch {
    return DEFAULT_PARTNERS;
  }
}

/** One node per employee (their latest period) for the org chart. No personal data. */
export async function orgNodes(): Promise<OrgNode[]> {
  const db = await getDb();
  const rows = currentPeriods(await db.select().from(s.employees));
  return rows.map((r) => {
    const [name, code = ""] = r.emp.split("~");
    return {
      code,
      name,
      emp: r.emp,
      headCode: r.reportingHead.split("~")[1] ?? "",
      active: r.changeDateTo === null && r.status !== "Inactive",
      revShare: (r.revShare ?? 0) !== 0,
      designation: r.designation,
      branch: r.branch,
      leftOn: r.changeDateTo,
    };
  });
}

// ---------------------------------------------------------------- P&L
import { SEAT_EXEMPT_DAYS } from "./calc/emp";
import type { PnlData } from "./calc/pnl";
import { num as numOf } from "./calc/excel";


/** The two heavy reads every report builds on (computed bookings and computed Exp), cached for 30 s. */
export const loadCore = () => memo("core", async () => ({ bk: await computedBookings(), exps: await expWithCalc() }));

/** Everything the P&L reports read: computed bookings, computed Exp, and the Emp periods (cached for 30 s - it is a heavy read). */
async function loadPnlDataRaw(): Promise<PnlData> {
  await ensureEmpDerived();
  const db = await getDb();
  const [{ bk, exps }, emp] = await Promise.all([loadCore(), db.select().from(s.employees).orderBy(asc(s.employees.seq))]);
  const today = todaySerial();
  const data: PnlData = {
    bookings: bk.map((r) => ({
      status: String(r.FormStatus ?? ""),
      month: isoToSerial(r.BkgMonth as string) ?? 0,
      director: String(r.Director ?? ""),
      rev: numOf(r.DirectorRevenue) + numOf(r.SpinToWin) + numOf(r.IncentivePOC) + numOf(r.IncentiveBuilder),
      depth: numOf(r.RS_Depth),
      levels: [0, 1, 2, 3, 4].map((k) => ({ emp: String(r[`L${k}_Emp`] ?? ""), share: numOf(r[`L${k}_Share`]), shareRA: numOf(r[`L${k}_SharexRA`]) })),
      overrideEmp: String(r.Override_Emp ?? ""),
      overrideShare: numOf(r.Override_Share),
      overrideShareRA: numOf(r.Override_SharexRA),
    })),
    exps: exps.map((r) => ({
      head: String(r.Head ?? ""), expType: String(r.ExpType ?? ""), director: String(r.Director ?? ""),
      date: isoToSerial(r.ValueDate as string) ?? 0,
      l0Emp: String(r.L0_Emp ?? ""), l0Amt: numOf(r.L0_Amt), l1Emp: String(r.L1_Emp ?? ""), l1Amt: numOf(r.L1_Amt),
    })),
    seats: emp.map((r) => {
      const from = serial(r.changeDateFrom)!;
      const seatApplies = r.applicable === "Y" && r.type === "Sales";
      return {
        director: r.director ?? "",
        start: seatApplies ? Math.max(from, (serial(r.doj) ?? from) + SEAT_EXEMPT_DAYS) : null,
        to: r.changeDateTo === null ? Math.max(today, from) : serial(r.changeDateTo)!,
        positive: (r.seatCost ?? 0) > 0,
      };
    }),
    edges: emp.map((r) => ({ code: r.emp.split("~")[1] ?? "", name: r.emp, headCode: r.reportingHead.split("~")[1] ?? "", revShare: r.revShare ?? 0 })),
  };
  return data;
}
export const loadPnlData = (): Promise<PnlData> => memo("pnl", loadPnlDataRaw);

/** Directors that appear in Emp (by code, with the latest spelling of the name), sorted by name. */
export async function pnlDirectors(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ emp: s.employees.emp, director: s.employees.director }).from(s.employees);
  const names = new Map<string, string>();
  for (const r of rows) {
    const c = (r.emp.split("~")[1] ?? "").toLowerCase();
    if (c && !names.has(c)) names.set(c, r.emp);
  }
  const out = new Set<string>();
  for (const r of rows) {
    const c = (r.director?.split("~")[1] ?? "").toLowerCase();
    if (c) out.add(names.get(c) ?? r.director!);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------- Projection
import type { ProjActuals, ProjRow } from "./calc/projection";

export async function projectionRows(year: number) {
  const db = await getDb();
  return db.select().from(s.projections).where(eq(s.projections.year, year)).orderBy(asc(s.projections.seq), asc(s.projections.id));
}
export async function projectionYears(): Promise<number[]> {
  const db = await getDb();
  const r = await db.selectDistinct({ y: s.projections.year }).from(s.projections).orderBy(asc(s.projections.year));
  return r.map((x) => x.y);
}
export const toProjRow = (r: typeof s.projections.$inferSelect): ProjRow => ({
  empCode: r.empCode, manMonths: r.manMonths ?? 0, bkgCount: r.bkgCount ?? 0, revenue: r.directorRevenue ?? 0, remarks: r.remarks,
});

/** Actuals the Projection report compares against: sold bookings by their Emp, and the Emp periods. */
async function projectionActualsRaw(): Promise<ProjActuals> {
  await ensureEmpDerived();
  const db = await getDb();
  const [{ bk }, emp] = await Promise.all([loadCore(), db.select().from(s.employees).orderBy(asc(s.employees.seq))]);
  const today = todaySerial();
  const people = new Map<string, { name: string; director: string; from: string }>();
  for (const r of emp) {
    const k = (r.emp.split("~")[1] ?? "").toLowerCase();
    const cur = people.get(k);
    if (!cur || r.changeDateFrom > cur.from) people.set(k, { name: r.emp, director: r.director ?? "", from: r.changeDateFrom });
  }
  return {
    bookings: bk
      .filter((r) => SOLD_STATUSES.includes(String(r.FormStatus ?? "").trim()))
      .map((r) => ({ empCode: String(r.Emp ?? "").split("~")[1] ?? "", month: isoToSerial(r.BkgMonth as string) ?? 0, rev: numOf(r.DirectorRevenue) })),
    periods: emp.map((r) => {
      const from = serial(r.changeDateFrom)!;
      return { code: r.emp.split("~")[1] ?? "", from, to: r.changeDateTo === null ? Math.max(today, from) : serial(r.changeDateTo)!, sales: r.type === "Sales" };
    }),
    people: new Map([...people].map(([k, v]) => [k, { name: v.name, director: v.director }])),
  };
}

export const projectionActuals = (): Promise<ProjActuals> => memo("projActuals", projectionActualsRaw);
