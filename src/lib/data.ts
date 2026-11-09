import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema as s, type DB } from "./db";
import { computeAll, type BookingInput, type BookingRow } from "./calc/booking";
import { Hierarchy, type EmpRow, type OverrideRule } from "./calc/hierarchy";
import { isoToSerial, str } from "./calc/excel";
import { SOLD_STATUSES } from "./fields";
import type { MasterData } from "./masters";

const serial = (d: string | null) => (d === null ? null : isoToSerial(d));

export async function loadEmployees(db: DB): Promise<EmpRow[]> {
  const rows = await db.select().from(s.employees).orderBy(asc(s.employees.seq));
  return rows.map((r) => ({
    emp: r.emp,
    reportingHead: r.reportingHead,
    revShare: r.revShare,
    expShare: r.expShare,
    branch: r.branch,
    changeDateFrom: serial(r.changeDateFrom)!,
    changeDateTo: serial(r.changeDateTo)!,
  }));
}

async function loadContext(db: DB) {
  const [employees, exp, rc, ov] = await Promise.all([
    loadEmployees(db),
    db.select().from(s.expEntries),
    db.select().from(s.rcRa),
    db.select().from(s.overrideRules),
  ]);
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
