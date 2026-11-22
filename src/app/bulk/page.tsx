import { requireUser } from "@/lib/auth";
import { COMPANY } from "@/lib/company";
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
        {COMPANY.manualMasters && <p><b>Back-office sheet:</b> the sheet received from the back office (columns Booking Trpl Id, Booking Status, Booking By Emp Code ...) can be uploaded as it is - it is recognised by its headers. Status Cancel / Client Cancel / Builder Cancel gives FormStatus and RC/RA Cancel; Live = Live; Not Live and Underprocess = Not Live; RA Yes = RA Close; RC Yes = RC Close/RA Open. The same unit booked again (not cancelled) gets the suffix Dup2, Dup3. Bookings whose Booking Trpl Id (ERPID) is already in Bkg are left out. Booking Shared By and the payment columns are ignored.</p>}
        <p><b>To add new bookings:</b> leave BkgID blank (it is generated). {COMPANY.manualMasters ? " The Project must exist in the Project Master (a row with another project is rejected with the reason); Builder and Project location are filled from the master (leave them blank; a different value is rejected). Unit, Area and the price fields are typed in the file; a blank one is suggested from the Inventory / Price list masters when they have it." : " Blank cells are filled from the masters (project, inventory, price list on the booking date, Associate's branch)."} You can mix corrections and new bookings in one file (up to 500 rows).</p>
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
