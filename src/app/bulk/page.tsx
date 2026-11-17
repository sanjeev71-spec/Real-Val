import { requireUser } from "@/lib/auth";
import { BkgUploadForm } from "@/components/BkgUploadForm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function UploadBkgPage() {
  const user = await requireUser(["admin", "master"]);
  const isMaster = user.role === "master";
  return (
    <div className="space-y-4">
      <h1 className="h1">Upload Bkg — add new bookings and correct existing ones</h1>
      <div className="card space-y-2 text-sm">
        <p>
          {isMaster
            ? "Your upload is applied at once and logged as one change."
            : "Your upload is sent to Master as one change. Nothing changes in Bkg until Master approves it."}
          {" "}Nothing is saved unless every row passes, and nothing is ever deleted by an upload.
        </p>
        <p><b>To correct existing bookings:</b> download Bkg (or a Data exceptions check), change the cells and upload that file as it is. A row whose <b>BkgID</b> is an existing booking is a correction of that booking; blank cells keep the stored value, and <code>[clear]</code> empties a field. Calculated columns are ignored.</p>
        <p><b>To add new bookings:</b> leave BkgID blank (it is generated). Blank cells are filled from the masters (project, inventory, price list on the booking date, Associate&apos;s branch). You can mix corrections and new bookings in one file (up to 500 rows).</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a className="btn" href="/api/template?format=xlsx">Download Excel template (with instructions)</a>
          <a className="btn" href="/api/template?format=csv">Download CSV template</a>
          <a className="btn" href="/bookings">Bkg list (has the Download Excel)</a>
        </div>
      </div>
      <BkgUploadForm isMaster={isMaster} />
    </div>
  );
}
