// Filters of the Bkg list (used by the page and by the Excel download, so both show the same rows).
// Text boxes: Director, Builder, Project, Client, BkgID, UnitNo. Extra filters come from the dashboard click-throughs.
export const BKG_TEXT_FIELDS: [string, string][] = [["Director", "Director"], ["Builder", "Builder"], ["Project", "Project"], ["Client", "Client name"], ["BkgID", "BkgID"], ["UnitNo", "UnitNo"]];
/** sold=1 (Live + Not Live) · status=Cancel · month=yyyy-mm · from / to (yyyy-mm-dd, on the booking month) · branch · due=1 (pending due) · bill=1 (billed, not received) */
export const BKG_EXTRA_KEYS = ["sold", "status", "month", "from", "to", "branch", "due", "bill"];
export const BKG_FILTER_KEYS = [...BKG_TEXT_FIELDS.map(([k]) => k), ...BKG_EXTRA_KEYS];

type Row = Record<string, unknown>;
const text = (v: unknown) => String(v ?? "");
const nameOnly = (v: unknown) => text(v).split("~")[0];
const SOLD = new Set(["live", "not live"]);

export function filterBkg<T extends Row>(rows: T[], get: (k: string) => string | null | undefined): T[] {
  const g = (k: string) => (get(k) ?? "").trim();
  const terms = BKG_TEXT_FIELDS.map(([k]) => [k, g(k).toLowerCase()] as const).filter(([, v]) => v);
  const sold = g("sold") === "1", status = g("status").toLowerCase(), month = g("month"), from = g("from"), to = g("to");
  const branch = g("branch").toLowerCase(), due = g("due") === "1", bill = g("bill") === "1";
  return rows.filter((r) => {
    const st = text(r.FormStatus).trim().toLowerCase();
    if (sold && !SOLD.has(st)) return false;
    if (status && st !== status) return false;
    const m = text(r.BkgMonth);
    if (month && !m.startsWith(month)) return false;
    if (from && !(m >= from)) return false;
    if (to && !(m !== "" && m <= to)) return false;
    if (branch && text(r.Branch).toLowerCase() !== branch) return false;
    if (due && !(Number(r.PendDue) > 0)) return false;
    if (bill && !(Number(r.BillOS) > 0)) return false;
    return terms.every(([k, v]) => (k === "Director" ? nameOnly(r[k]) : text(r[k])).toLowerCase().includes(v));
  });
}

export function activeBkgFilters(get: (k: string) => string | null | undefined): [string, string][] {
  return BKG_FILTER_KEYS.map((k) => [k, (get(k) ?? "").trim()] as [string, string]).filter(([, v]) => v);
}
