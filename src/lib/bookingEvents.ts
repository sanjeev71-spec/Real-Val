import "server-only";
// Booking event log: what happened to each booking and when, so results can be shown month by month net of cancellations.
//
// After every save (and before the event pages are read) the site compares each booking with its last known state
// (booking_snapshots) and writes an event for every change it finds:
//   booked      a new Live / Not Live booking            + its figures, in the booking month (BkgMonth)
//   cancel      Live / Not Live -> Cancel (or any status that is not sold)   - the figures it had
//   reinstate   back to Live / Not Live                   + its figures
//   ra_close    RA% moved above 0 (RA closed)             the change in ShareAmt x RA% (and anything else that moved)
//   ra_reopen   RA% back to 0
//   transfer    the Director of the booking changed       - old Director, + new Director
//   revision    the figures changed (price, slab, discount, chain ...)   + / - the difference
//   status      Live <-> Not Live and other status changes with no money effect
//   deleted     the booking no longer exists
// Figures per Director follow the Director-wise P&L (bookingParts). captured_on is the day the site saw the change and is never
// edited; effective_date (the month it counts in) is the same day unless Master / Admin correct it.
import { inArray, sql } from "drizzle-orm";
import { getDb, schema as s } from "./db";
import { loadCore, pnlBookingOf, todayIso } from "./data";
import { bookingParts } from "./calc/pnl";
import { codeOf, num } from "./calc/excel";

type Parts = Record<string, [number, number, number]>;
interface State { status: string; sold: boolean; raClosed: boolean; director: string; parts: Parts; bookingDate: string | null; raPct: number; rev: number }
type NewEvent = typeof s.bookingEvents.$inferInsert;

const SOLD = new Set(["live", "not live"]);
const r2 = (v: number) => Math.round(v * 100) / 100;
const rounded = (p: Parts): Parts => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [r2(v[0]), r2(v[1]), r2(v[2])] as [number, number, number]]));
const moved = (v: number) => Math.abs(v) >= 1; // changes under a rupee are rounding
const LOCK = 7242113; // one sync at a time (advisory lock)
const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

/** Current state of every booking, from the computed Bkg. */
async function currentStates(): Promise<{ states: Map<string, State>; names: Map<string, string> }> {
  const { bk } = await loadCore();
  const states = new Map<string, State>();
  const names = new Map<string, string>(); // lower-case code -> Name~Code
  for (const r of bk) {
    const id = String(r.BkgID ?? "").trim();
    if (!id) continue;
    for (const k of ["Director", "Override_Emp", "L0_Emp", "L1_Emp", "L2_Emp", "L3_Emp", "L4_Emp"]) {
      const v = String(r[k] ?? "");
      if (v.includes("~")) names.set(codeOf(v).toLowerCase(), v);
    }
    const pb = pnlBookingOf(r);
    const status = String(r.FormStatus ?? "").trim();
    states.set(id.toUpperCase(), {
      status, sold: SOLD.has(status.toLowerCase()), raClosed: num(r["RA%"] as number) > 0, director: String(r.Director ?? ""),
      parts: rounded(bookingParts(pb)), bookingDate: r.BkgMonth ? String(r.BkgMonth).slice(0, 10) : null, raPct: num(r["RA%"] as number), rev: pb.rev,
    });
    // a booking that is not sold adds nothing to the P&L; keep what it would add, for the history of old cancellations
    if (!states.get(id.toUpperCase())!.sold) (states.get(id.toUpperCase()) as State & { wouldBe?: Parts }).wouldBe = rounded(bookingParts({ ...pb, status: "Live" }));
  }
  return { states, names };
}

/** Dates found in the change log for old cancellations and RC/RA changes (filling in the history the first time). */
async function historyDates(): Promise<{ cancel: Map<string, string>; rcra: Map<string, string> }> {
  const db = await getDb();
  const rows = await db.select({ data: s.changeRequests.data, at: s.changeRequests.decidedAt, created: s.changeRequests.createdAt })
    .from(s.changeRequests).where(sql`${s.changeRequests.entity} = 'bkg' and ${s.changeRequests.status} = 'approved'`);
  const cancel = new Map<string, string>(), rcra = new Map<string, string>();
  for (const r of rows) {
    const day = istDate(r.at ?? r.created);
    const ups = ((r.data as { updates?: { bkgId: string; changes: { field: string; to: unknown }[] }[] }).updates ?? []);
    for (const u of ups) {
      const id = String(u.bkgId).toUpperCase();
      for (const c of u.changes ?? []) {
        if (c.field === "FormStatus" && String(c.to ?? "").toLowerCase() === "cancel") cancel.set(id, day);
        if (c.field === "RC/RA") rcra.set(id, day);
      }
    }
  }
  return { cancel, rcra };
}

/**
 * Compares every booking with its last known state and records what changed. Safe to call any time (one at a time; a second call
 * that finds nothing new writes nothing). The very first run fills in the history: every booking is "booked" in its booking month,
 * and old cancellations / RA closes get the date found in the change log, or the booking date marked "please confirm".
 */
export async function syncBookingEvents(): Promise<{ events: number; history: boolean; skipped?: boolean }> {
  const { states, names } = await currentStates();
  const db = await getDb();
  const today = todayIso();
  const nameOf = (code: string) => names.get(code) ?? code;
  // read outside the transaction (a second connection inside it would wait on the local single-connection database)
  const [{ n: snaps }] = (await db.select({ n: sql<number>`count(*)::int` }).from(s.bookingSnapshots)) as { n: number }[];
  const histPre = Number(snaps) === 0 ? await historyDates() : null;
  return db.transaction(async (tx) => {
    // another sync is running: leave it to that one (whatever it misses, the next save or page visit picks up) - never wait
    const lr = (await tx.execute(sql`select pg_try_advisory_xact_lock(${LOCK}) as ok`)) as unknown as { rows?: { ok: boolean }[] } | { ok: boolean }[];
    if (!((("rows" in lr ? lr.rows : lr) as { ok: boolean }[])[0]?.ok)) return { events: 0, history: false, skipped: true };
    const prevRows = await tx.select().from(s.bookingSnapshots);
    const prev = new Map(prevRows.map((p) => [p.bkgId.toUpperCase(), p]));
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(s.bookingEvents)) as { n: number }[];
    const history = prevRows.length === 0 && Number(n) === 0;
    const hist = history && histPre ? histPre : { cancel: new Map<string, string>(), rcra: new Map<string, string>() };
    const out: NewEvent[] = [];
    let seq = 0;

    /** One change: a row per Director whose figures moved, or one marker row when nothing moved. */
    const emit = (bkgId: string, kind: string, delta: Parts, eff: string, detail: string, director: string, confirmed = true) => {
      const grp = `${bkgId}:${Date.now()}:${seq++}`;
      const base = { grp, bkgId, kind, detail, effectiveDate: eff, capturedOn: today, dateConfirmed: confirmed, source: history ? "history" : "site" };
      const rows = Object.entries(delta).filter(([, v]) => v.some(moved));
      if (!rows.length) out.push({ ...base, director: director || null });
      for (const [code, v] of rows) out.push({ ...base, director: nameOf(code), rev: r2(v[0]), share: r2(v[1]), shareRA: r2(v[2]) });
    };
    const neg = (p: Parts): Parts => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [-v[0], -v[1], -v[2]] as [number, number, number]]));
    const diff = (a: Parts, b: Parts): Parts => {
      const o: Parts = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const x = a[k] ?? [0, 0, 0], y = b[k] ?? [0, 0, 0];
        o[k] = [r2(x[0] - y[0]), r2(x[1] - y[1]), r2(x[2] - y[2])];
      }
      return o;
    };
    const sum = (p: Parts, i: 0 | 1 | 2) => Object.values(p).reduce((a, v) => a + v[i], 0);

    for (const id of new Set([...states.keys(), ...prev.keys()])) {
      const cur = states.get(id) as (State & { wouldBe?: Parts }) | undefined;
      const p = prev.get(id);
      if (!cur && p) { // the booking was removed
        if (p.sold) emit(id, "deleted", neg(p.parts), today, `${p.status} booking removed`, p.director ?? "");
        continue;
      }
      if (!cur) continue;
      const bdate = cur.bookingDate ?? today;
      if (!p) {
        if (history) {
          if (cur.sold) {
            // booked in its booking month; ShareAmt x RA% counts when RA closed (date from the change log, else to confirm)
            const booked: Parts = Object.fromEntries(Object.entries(cur.parts).map(([k, v]) => [k, [v[0], v[1], cur.raClosed ? 0 : v[2]] as [number, number, number]]));
            emit(id, "booked", booked, bdate, `Booked as ${cur.status}`, cur.director);
            if (cur.raClosed) {
              const ra: Parts = Object.fromEntries(Object.entries(cur.parts).map(([k, v]) => [k, [0, 0, v[2]] as [number, number, number]]));
              const d = hist.rcra.get(id);
              emit(id, "ra_close", ra, d && d >= bdate ? d : bdate, `RA closed (RA% ${Math.round(cur.raPct * 100)}%)`, cur.director, !!d);
            }
          } else if (cur.status.toLowerCase() === "cancel") {
            // an old cancellation: booked in its month, reversed on the cancel date (from the change log, else to confirm)
            const was = cur.wouldBe ?? {};
            emit(id, "booked", was, bdate, "Booked", cur.director);
            const d = hist.cancel.get(id);
            emit(id, "cancel", neg(was), d && d >= bdate ? d : bdate, "Cancelled", cur.director, !!d);
          } else emit(id, "status", {}, bdate, `Added as ${cur.status || "(no status)"}`, cur.director);
        } else if (cur.sold) emit(id, "booked", cur.parts, bdate, `Booked as ${cur.status}`, cur.director);
        else emit(id, "status", {}, today, `Added as ${cur.status || "(no status)"}`, cur.director);
        continue;
      }
      // an existing booking: what changed since it was last seen
      if (p.sold && !cur.sold) emit(id, "cancel", neg(p.parts), today, `${p.status} → ${cur.status || "(no status)"}`, p.director ?? "");
      else if (!p.sold && cur.sold) emit(id, "reinstate", cur.parts, today, `${p.status || "(no status)"} → ${cur.status}`, cur.director);
      else if (p.sold && cur.sold) {
        const d = diff(cur.parts, p.parts as Parts);
        const any = Object.values(d).some((v) => v.some(moved));
        const raNow = cur.raClosed && !p.raClosed ? "ra_close" : !cur.raClosed && p.raClosed ? "ra_reopen" : null;
        const dirChanged = codeOf(p.director ?? "").toLowerCase() !== codeOf(cur.director).toLowerCase();
        if (raNow) emit(id, raNow, any ? d : {}, today, raNow === "ra_close" ? `RA closed (RA% ${Math.round(cur.raPct * 100)}%)` : "RA re-opened (RA% back to 0)", cur.director);
        else if (any && dirChanged) emit(id, "transfer", d, today, `Director ${(p.director ?? "").split("~")[0] || "(none)"} → ${cur.director.split("~")[0] || "(none)"}`, cur.director);
        else if (any) {
          const rv = sum(d, 0);
          emit(id, "revision", d, today, moved(rv) ? `Revenue ${inr(sum(p.parts as Parts, 0))} → ${inr(sum(cur.parts, 0))}` : "Revenue share changed", cur.director);
        }
        if (p.status !== cur.status) emit(id, "status", {}, today, `${p.status} → ${cur.status}`, cur.director);
      } else if (p.status !== cur.status) emit(id, "status", {}, today, `${p.status || "(no status)"} → ${cur.status || "(no status)"}`, cur.director);
    }

    for (let i = 0; i < out.length; i += 300) await tx.insert(s.bookingEvents).values(out.slice(i, i + 300));
    // the new last-known state
    const changedIds = [...states.keys()].filter((id) => {
      const c = states.get(id)!, p = prev.get(id);
      return !p || p.status !== c.status || p.sold !== c.sold || p.raClosed !== c.raClosed || p.director !== c.director || JSON.stringify(p.parts) !== JSON.stringify(c.parts);
    });
    const gone = [...prev.keys()].filter((id) => !states.has(id));
    if (gone.length) await tx.delete(s.bookingSnapshots).where(inArray(s.bookingSnapshots.bkgId, gone.map((g) => prev.get(g)!.bkgId)));
    for (let i = 0; i < changedIds.length; i += 300) {
      const vals = changedIds.slice(i, i + 300).map((id) => { const c = states.get(id)!; return { bkgId: id, status: c.status, sold: c.sold, raClosed: c.raClosed, director: c.director, parts: c.parts, updatedAt: new Date() }; });
      await tx.insert(s.bookingSnapshots).values(vals).onConflictDoUpdate({
        target: s.bookingSnapshots.bkgId,
        set: { status: sql`excluded.status`, sold: sql`excluded.sold`, raClosed: sql`excluded.ra_closed`, director: sql`excluded.director`, parts: sql`excluded.parts`, updatedAt: sql`excluded.updated_at` },
      });
    }
    return { events: out.length, history };
  });
}

/** Runs the sync, never failing the page or the save it follows (a failed sync is retried by the next one). */
export async function syncBookingEventsQuietly(): Promise<void> {
  try { await syncBookingEvents(); } catch (e) { console.error("booking event sync failed:", (e as Error).message); }
}

export const KIND_LABEL: Record<string, string> = {
  booked: "Booked", cancel: "Cancelled", reinstate: "Reinstated", ra_close: "RA closed", ra_reopen: "RA re-opened",
  transfer: "Director changed", revision: "Revised", status: "Status", deleted: "Removed",
};

/** Every event (all bookings), for the monthly movement report. */
export async function allEvents() {
  const db = await getDb();
  return db.select().from(s.bookingEvents);
}

/** One change per row (the rows of a change are summed), newest first - for a booking's page or the "please confirm" list. */
export async function eventGroups(where?: { bkgId?: string; unconfirmed?: boolean }) {
  const db = await getDb();
  const rows = await db.select().from(s.bookingEvents).where(
    where?.bkgId ? sql`upper(${s.bookingEvents.bkgId}) = ${where.bkgId.toUpperCase()}` : where?.unconfirmed ? sql`${s.bookingEvents.dateConfirmed} = false` : undefined,
  );
  const g = new Map<string, { grp: string; bkgId: string; kind: string; detail: string | null; effectiveDate: string; capturedOn: string; dateConfirmed: boolean; source: string; originalEffective: string | null; parts: { director: string | null; rev: number; share: number; shareRA: number }[] }>();
  for (const r of rows) {
    const x = g.get(r.grp) ?? { grp: r.grp, bkgId: r.bkgId, kind: r.kind, detail: r.detail, effectiveDate: r.effectiveDate, capturedOn: r.capturedOn, dateConfirmed: r.dateConfirmed, source: r.source, originalEffective: r.originalEffective, parts: [] };
    if (r.rev || r.share || r.shareRA) x.parts.push({ director: r.director, rev: r.rev, share: r.share, shareRA: r.shareRA });
    g.set(r.grp, x);
  }
  return [...g.values()].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.grp.localeCompare(a.grp));
}

/** Master / Admin set the month a change counts in (the captured date never changes; the first date is kept). */
export async function setEventDate(grp: string, effective: string, userId: number): Promise<void> {
  const db = await getDb();
  await db.update(s.bookingEvents)
    .set({ effectiveDate: effective, dateConfirmed: true, correctedBy: userId, correctedAt: new Date(), originalEffective: sql`coalesce(${s.bookingEvents.originalEffective}, ${s.bookingEvents.effectiveDate})` })
    .where(sql`${s.bookingEvents.grp} = ${grp}`);
}

export interface EventDate { date: string; grp: string }
/** The cancellation still in force (no reinstate after it) and the RA close still in force (no re-open after it) of each booking. */
export async function eventDatesByBooking(): Promise<Map<string, { cancel?: EventDate; raClose?: EventDate }>> {
  const db = await getDb();
  const rows = await db.select({ id: s.bookingEvents.id, grp: s.bookingEvents.grp, bkgId: s.bookingEvents.bkgId, kind: s.bookingEvents.kind, date: s.bookingEvents.effectiveDate })
    .from(s.bookingEvents).where(inArray(s.bookingEvents.kind, ["cancel", "reinstate", "deleted", "ra_close", "ra_reopen"]));
  rows.sort((a, b) => a.id - b.id);
  const out = new Map<string, { cancel?: EventDate; raClose?: EventDate }>();
  for (const r of rows) {
    const k = r.bkgId.toUpperCase();
    const o = out.get(k) ?? {};
    if (r.kind === "cancel" || r.kind === "deleted") o.cancel = { date: r.date, grp: r.grp };
    if (r.kind === "reinstate") delete o.cancel;
    if (r.kind === "ra_close") o.raClose = { date: r.date, grp: r.grp };
    if (r.kind === "ra_reopen") delete o.raClose;
    out.set(k, o);
  }
  return out;
}
