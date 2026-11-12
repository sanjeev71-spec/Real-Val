import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema as s, type DB } from "./db";
import { computeAll, type BookingInput, type BookingRow } from "./calc/booking";
import { Hierarchy, type EmpRow, type OverrideRule } from "./calc/hierarchy";
import { isoToSerial, str } from "./calc/excel";
import { SOLD_STATUSES } from "./fields";
import type { MasterData } from "./masters";

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
    db.select().from(s.expEntries),
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
export async function computedBookings(): Promise<BookingRow[]> {
  const db = await getDb();
  const [rows, ctx] = await Promise.all([db.select().from(s.bookings).orderBy(asc(s.bookings.bkgId)), loadContext(db)]);
  return computeAll(rows.map((r) => ({ ...r.data, BkgID: r.bkgId }) as BookingInput), ctx);
}

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

import { computeEmp, empDirector } from "./calc/emp";
import { computeExp, type BookingRef, type ExpInput, type ExpRow as ExpComputedRow } from "./calc/exp";

export type EmployeeRecord = typeof s.employees.$inferSelect;

/** All Emp period rows with their calculated columns (Director, DaysWorked, ManMonths, SeatCost). */
export async function employeesWithCalc() {
  const db = await getDb();
  const rows = await db.select().from(s.employees).orderBy(asc(s.employees.seq));
  const today = todaySerial();
  const H = new Hierarchy(rows.map((r) => toEmpRow(r, today)));
  // Days worked / man-months / seat cost of an open period run to today (or 0 if it starts in the future)
  return rows.map((r, i) => ({
    ...r,
    calc: computeEmp(H, H.rows[i], {
      applicable: r.applicable, type: r.type, doj: serial(r.doj),
      to: r.changeDateTo === null ? Math.max(today, serial(r.changeDateFrom)!) : undefined,
    }),
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
});

/** Every Exp entry with its calculated columns, newest first. */
export async function expWithCalc(): Promise<(ExpComputedRow & { id: number })[]> {
  const db = await getDb();
  const [rows, ctx] = await Promise.all([db.select().from(s.expEntries).orderBy(desc(s.expEntries.id)), expContext()]);
  return rows.map((e) => ({ id: e.id, ...computeExp(expInputOf(e), ctx) }));
}

export async function activeModes(): Promise<string[]> {
  const db = await getDb();
  return (await db.select().from(s.modes).where(eq(s.modes.active, true)).orderBy(asc(s.modes.name))).map((m) => m.name);
}

export async function expHeadList() {
  const db = await getDb();
  return db.select().from(s.expHeads).orderBy(asc(s.expHeads.head));
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
  };
}

// ---------------------------------------------------------------- Reports

import { computeDemand, type DemandRow } from "./calc/demand";

/** Demand report rows: Live and Not Live bookings, sorted by Builder, Project, Client. */
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
    .sort((a, b) => a.Builder.localeCompare(b.Builder) || a.Project.localeCompare(b.Project) || a.Client.localeCompare(b.Client));
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

export const DEFAULT_PARTNERS = ["Pratham Goyal~100031", "Pawan Bedi~200001", "Tarun Kumar~100030", "Aditya Goel~200002"];

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
