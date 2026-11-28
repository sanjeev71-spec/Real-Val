import "server-only";
// CancelDate and RACloseDate in the Bkg sheet of the RealV / TRPL Data file: the month a cancellation / RA close counts in.
// They are the effective dates of the booking's events (see bookingEvents.ts). On upload a changed date moves that event; a blank cell
// changes nothing. A date for a booking that this same upload cancels (FormStatus = Cancel) or whose RA it closes is applied right after
// the booking is saved.
import { bumpData } from "./cache";
import { todayIso } from "./data";
import { eventDatesByBooking, setEventDate, syncBookingEvents } from "./bookingEvents";

export const EVENT_DATE_COLS = { CancelDate: "cancel", RACloseDate: "raClose" } as const;
type Col = keyof typeof EVENT_DATE_COLS;
export interface EventDateItem { row: number; bkgId: string; col: Col; date: string; cancelling: boolean }

const iso = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

/** Takes the two date columns out of the Bkg rows (the Bkg upload does not know them) and reads them. */
export function splitEventDates(rows: Record<string, unknown>[]): { rows: Record<string, unknown>[]; items: EventDateItem[]; errors: string[] } {
  const items: EventDateItem[] = [], errors: string[] = [];
  const today = todayIso();
  const out = rows.map((r, i) => {
    const o = { ...r };
    for (const col of Object.keys(EVENT_DATE_COLS) as Col[]) {
      const v = o[col];
      delete o[col];
      if (v === null || v === undefined || String(v).trim() === "") continue;
      const bkgId = String(r.BkgID ?? "").trim().toUpperCase();
      const d = iso(v);
      if (!bkgId) errors.push(`Row ${i + 2}: ${col} needs the BkgID of an existing booking`);
      else if (!d || Number.isNaN(Date.parse(d))) errors.push(`Row ${i + 2}: ${col} "${String(v)}" is not a date (dd-mm-yyyy)`);
      else if (d > today) errors.push(`Row ${i + 2}: ${col} ${d.split("-").reverse().join("-")} is in the future`);
      else items.push({ row: i + 2, bkgId, col, date: d, cancelling: String(r.FormStatus ?? "").trim().toLowerCase() === "cancel" });
    }
    return o;
  });
  return { rows: out, items, errors };
}

/** What the dates will do: changes to existing events, dates waiting for this upload's cancellation / RA close, and problems. */
export async function checkEventDates(items: EventDateItem[]): Promise<{ changes: number; pending: number; errors: string[]; warnings: string[] }> {
  const now = await eventDatesByBooking();
  let changes = 0, pending = 0;
  const errors: string[] = [], warnings: string[] = [];
  for (const it of items) {
    const ev = now.get(it.bkgId)?.[EVENT_DATE_COLS[it.col]];
    if (ev) { if (ev.date !== it.date) changes++; continue; }
    if (it.col === "CancelDate" && !it.cancelling) errors.push(`Row ${it.row}: ${it.bkgId} is not cancelled - leave CancelDate blank (or set FormStatus to Cancel)`);
    else if (it.col === "CancelDate") pending++;
    else { pending++; warnings.push(`Row ${it.row}: ${it.bkgId} has no RA close recorded - RACloseDate is used only if this upload closes its RA`); }
  }
  return { changes, pending, errors, warnings };
}

/** After the Bkg sheet is saved: records the new events first, then moves each event to the date in the file. */
export async function applyEventDates(items: EventDateItem[], userId: number): Promise<{ set: number; ignored: string[] }> {
  if (!items.length) return { set: 0, ignored: [] };
  bumpData();
  // a sync started by another save may be running: wait for it (up to ~20 s) so this upload's events exist
  for (let i = 0; i < 20 && (await syncBookingEvents()).skipped; i++) await new Promise((r) => setTimeout(r, 1000));
  const now = await eventDatesByBooking();
  let set = 0;
  const ignored: string[] = [];
  for (const it of items) {
    const ev = now.get(it.bkgId)?.[EVENT_DATE_COLS[it.col]];
    if (!ev) { ignored.push(`${it.bkgId} ${it.col}`); continue; }
    if (ev.date !== it.date) { await setEventDate(ev.grp, it.date, userId); set++; }
  }
  return { set, ignored };
}
