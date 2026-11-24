import { currentUser } from "@/lib/auth";
import { computedBookings, loadPnlData, pnlDirectorInfo } from "@/lib/data";
import { buildDirectorSummary } from "@/lib/directorSummary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const isoOk = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** One summary file for all Directors (or the ticked ones): Directors in rows, inactive in red. Master only. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "master") return new Response("Not allowed", { status: 403 });
  const u = new URL(req.url);
  const bkgFrom = u.searchParams.get("bf"), bkgTo = u.searchParams.get("bt"), expFrom = u.searchParams.get("ef"), expTo = u.searchParams.get("et");
  if (!isoOk(bkgFrom) || !isoOk(bkgTo) || !isoOk(expFrom) || !isoOk(expTo)) return new Response("Choose all four dates", { status: 400 });
  const info = await pnlDirectorInfo();
  const picked = new Set(u.searchParams.getAll("d"));
  const directors = picked.size ? info.filter((d) => picked.has(d.name)) : info;
  // "CODE|yyyy-mm-dd": a Director whose bookings count from their own date
  const bkgFromFor: Record<string, string> = {};
  for (const v of u.searchParams.getAll("ov")) {
    const [code, date] = v.split("|");
    if (code && isoOk(date ?? null)) bkgFromFor[code.trim().toLowerCase()] = date;
  }
  const [pnl, bookings] = await Promise.all([loadPnlData(), computedBookings()]);
  const data = await buildDirectorSummary({ directors, bkgFrom, bkgTo, expFrom, expTo, bkgFromFor, pnl, bookings });
  const today = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": XLSX, "Content-Disposition": `attachment; filename="PnL Summary - all Directors - ${today}.xlsx"` },
  });
}
