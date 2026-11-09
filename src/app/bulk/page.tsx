import { requireUser } from "@/lib/auth";
import { BulkUpload } from "@/components/BulkUpload";

export default async function BulkPage() {
  await requireUser(["master"]);
  return (
    <div className="space-y-4">
      <h1 className="h1">Bulk upload bookings</h1>
      <div className="card space-y-2 text-sm">
        <p>Master only. Rows go straight into Bkg — no Admin approval step. BkgIDs are generated automatically when the BkgID column is blank.</p>
        <p>Blank cells are filled from the masters (project, inventory, price list on the booking date, Associate&apos;s branch). Nothing is saved unless every row passes.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a className="btn" href="/api/template?format=xlsx">Download Excel template (with instructions)</a>
          <a className="btn" href="/api/template?format=csv">Download CSV template</a>
        </div>
      </div>
      <BulkUpload />
    </div>
  );
}
