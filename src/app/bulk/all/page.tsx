import { requireUser } from "@/lib/auth";
import { AllUpload } from "@/components/AllUpload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AllFilePage() {
  await requireUser(["master"]);
  return (
    <div className="space-y-4">
      <h1 className="h1">Bkg + Exp + Emp in one file</h1>
      <div className="card space-y-2 text-sm">
        <p>
          <b>Download:</b> one Excel file with three sheets, <b>Bkg</b>, <b>Exp</b> and <b>Emp</b>, with the same heading colours as the single downloads
          (green = typed by hand and read on upload, grey = built in and ignored on upload).
        </p>
        <form method="get" action="/api/export/all" className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="bf">Bkg from BkgMonth (blank = all)</label><input id="bf" name="bf" type="date" className="input" /></div>
          <div><label className="label" htmlFor="ef">Exp from PayDate (blank = all)</label><input id="ef" name="ef" type="date" className="input" /></div>
          <button className="btn btn-primary">Download Bkg + Exp + Emp (.xlsx)</button>
        </form>
        <p className="text-xs text-[var(--muted)]">The full file is large (about 6 MB) and takes up to a minute to build. If the download does not complete, fill the two dates to get a smaller file. Emp holds personal data: the file is for Master only.</p>
        <p>
          <b>Upload:</b> upload the same file back. Each sheet follows the rules of its own upload page (Upload Bkg, Upload Exp, Upload Emp): a row with an existing BkgID / DocNo / Emp is a
          correction, blank cells keep the stored value, <code>[clear]</code> empties a field, and a new Bkg or Exp row has a blank BkgID or DocNo.
          Nothing is saved unless every row of every sheet you tick passes, and nothing is ever deleted. Changes are applied in the order <b>Emp, Bkg, Exp</b>, each logged as its own change.
        </p>
        <p>
          <b>Size:</b> each sheet reads up to 500 rows per upload and the file must stay under 5.5 MB, so <b>delete the rows you did not change</b> before uploading (keep the header row).
          A sheet with no rows is skipped.</p>
        <p>
          <b>Emp sheet:</b> it has the Emp download columns plus typed <b>Action</b>, <b>Emp Code</b>, <b>Name</b>, <b>Effective From</b>, <b>Exit Date</b> and <b>Reportees Move To</b> (green).
          A row is applied only when its <b>Action</b> is filled (New, Change, Correct or Exit, as on Upload Emp; one row per employee, up to 300); rows with a blank Action are reference only.
          Put the Action on the employee&apos;s latest row and edit only the cells that change (cells still holding the stored value are ignored). To add an employee, add a row at the bottom with Action New, Emp Code, Name, ReportingHead and DOJ. If a file adds new employees and also uses them in Bkg or Exp rows, upload the Emp sheet first (tick only Emp), then the rest.
        </p>
      </div>
      <AllUpload />
    </div>
  );
}
