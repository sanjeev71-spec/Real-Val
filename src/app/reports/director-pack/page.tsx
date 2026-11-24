import { requireUser } from "@/lib/auth";
import { pnlDirectorInfo, todayIso } from "@/lib/data";
import DirectorPick from "@/components/DirectorPick";

export const dynamic = "force-dynamic";

const monthEnd = (iso: string) => {
  const d = new Date(`${iso.slice(0, 8)}01T00:00:00Z`);
  d.setUTCDate(0); // last day of the previous month
  return d.toISOString().slice(0, 10);
};

export default async function DirectorPackPage() {
  await requireUser(["master"]);
  const directors = await pnlDirectorInfo();
  const today = todayIso();
  return (
    <div className="space-y-4">
      <h1 className="h1">Director P&amp;L packs</h1>
      <p className="text-sm text-[var(--muted)]">
        One Excel file per Director with four sheets: <b>P&amp;L Summary</b> (TL-wise), <b>Bkg Data</b>, <b>Exp Data</b> (Expense heads only) and <b>Employee Data</b> (with seat cost).
        Select one or more Directors. One Director downloads as .xlsx; several download as one .zip with a file each, ready to send. Inactive Directors are shown in red. Each P&amp;L Summary shows the Total, TL-wise and year-wise columns; TLs with nothing in any row are left out. <b>All-Directors summary</b> gives one sheet with a row per Director (the ticked ones, or all if none is ticked).
      </p>
      <form className="card space-y-4" method="get" action="/api/export/director-pack">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="bf">Booking from</label><input id="bf" name="bf" type="date" className="input" defaultValue="2023-01-01" required /></div>
          <div><label className="label" htmlFor="bt">Booking to</label><input id="bt" name="bt" type="date" className="input" defaultValue={monthEnd(today)} required /></div>
          <div><label className="label" htmlFor="ef">Exp from</label><input id="ef" name="ef" type="date" className="input" defaultValue="2023-01-01" required /></div>
          <div><label className="label" htmlFor="et">Exp to</label><input id="et" name="et" type="date" className="input" defaultValue={today} required /></div>
        </div>
        <div>
          <DirectorPick directors={directors} />
          <p className="mt-2 text-xs text-[var(--muted)]">Bkg Data lists all bookings; the P&amp;L Summary and the Bkg Data total count Live and Not Live only. Several Directors download as one .zip with a separate file for each.</p>
        </div>
        <button className="btn btn-primary">Download</button>
      </form>
    </div>
  );
}
