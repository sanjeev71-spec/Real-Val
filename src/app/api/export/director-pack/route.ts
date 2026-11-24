import JSZip from "jszip";
import { currentUser } from "@/lib/auth";
import { computedBookings, employeesWithCalc, expWithCalc, loadPnlData, pnlDirectors } from "@/lib/data";
import { storedExpFields } from "@/lib/expRemarks";
import { buildDirectorPack } from "@/lib/directorPack";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const isoOk = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const safe = (s: string) => s.replace(/[^A-Za-z0-9 _.-]+/g, "_").trim();

/** Individual P&L pack(s): one .xlsx per selected Director (a .zip when several are chosen). Master only. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "master") return new Response("Not allowed", { status: 403 });
  const u = new URL(req.url);
  const bkgFrom = u.searchParams.get("bf"), bkgTo = u.searchParams.get("bt"), expFrom = u.searchParams.get("ef"), expTo = u.searchParams.get("et");
  if (!isoOk(bkgFrom) || !isoOk(bkgTo) || !isoOk(expFrom) || !isoOk(expTo)) return new Response("Choose all four dates", { status: 400 });
  const all = await pnlDirectors();
  const chosen = u.searchParams.getAll("d").filter((d) => all.includes(d));
  if (!chosen.length) return new Response("Choose at least one Director", { status: 400 });

  const [pnl, bookings, exps, emps, storedExp] = await Promise.all([loadPnlData(), computedBookings(), expWithCalc(), employeesWithCalc(), storedExpFields()]);
  const today = new Date().toISOString().slice(0, 10);
  const files: { name: string; data: Buffer }[] = [];
  for (const director of chosen) {
    const data = await buildDirectorPack({ director, bkgFrom, bkgTo, expFrom, expTo, pnl, bookings, exps, emps, storedExp });
    files.push({ name: `PnL - ${safe(director.split("~")[0])} - ${today}.xlsx`, data });
  }
  if (files.length === 1) {
    return new Response(new Uint8Array(files[0].data), {
      headers: { "Content-Type": XLSX, "Content-Disposition": `attachment; filename="${files[0].name}"` },
    });
  }
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.data);
  const buf = await zip.generateAsync({ type: "arraybuffer" });
  return new Response(buf, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="Director P&L packs - ${today}.zip"` },
  });
}
