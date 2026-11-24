import "server-only";
import { loadCore, demandRows } from "./data";
import { codeOf, isoToSerial, num } from "./calc/excel";
import type { DBk, DExp } from "./calc/dashScope";
import { memo } from "./cache";

const str = (v: unknown) => String(v ?? "");

/** ShareAmt of a booking up to and including the Director's own level (the same rule as the Director-wise P&L). */
function shareToDirector(r: Record<string, unknown>, key: "Share" | "SharexRA"): number {
  const dc = codeOf(str(r.Director)).toLowerCase();
  if (!dc) return 0;
  let s = 0;
  for (let k = 0; k < 5; k++) {
    s += num(r[`L${k}_${key}`] as number);
    if (codeOf(str(r[`L${k}_Emp`])).toLowerCase() === dc) return s;
  }
  return 0;
}

/** Bookings and Exp rows in the shape the dashboards need (cached with the core data). */
export const dashRows = () =>
  memo("dashRows", async () => {
    const { bk, exps } = await loadCore();
    const bks: DBk[] = bk.map((r) => ({
      id: str(r.BkgID), status: str(r.FormStatus), month: isoToSerial(r.BkgMonth as string) ?? 0, area: num(r.Area as number), rev: num(r.DirectorRevenue as number),
      director: str(r.Director), builder: str(r.Builder), project: str(r.Project), branch: str(r.Branch),
      rcra: str(r["RC/RA"]), raPct: num(r["RA%"] as number), coRev: num(r.CoRev as number), coRevRA: num(r.CoRevRA as number),
      pendDue: num(r.PendDue as number), futDue: num(r.FutDue as number), billOS: num(r.BillOS as number),
      share: shareToDirector(r, "Share"), shareRA: shareToDirector(r, "SharexRA"),
    }));
    const ex: DExp[] = exps.map((r) => ({ date: isoToSerial(r.PayDate as string) ?? 0, head: str(r.Head), mode: str(r.Mode), signed: num(r.SignedGross as number), bkgId: str(r.BkgID) }));
    return { bks, exps: ex };
  });

/** Demand rows (Live / Not Live) as plain numbers per booking. */
export const dashDemand = () =>
  memo("dashDemand", async () =>
    (await demandRows()).map((d) => ({
      id: d.BkgID, director: d.Director, builder: d.Builder, project: d.Project, status: d.status,
      dueNow: d.status === "due" ? d.FirstNetDemandGST : 0, outstanding: d.status === "nocost" ? 0 : d.TotalOutstanding,
    })),
  );
