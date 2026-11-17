import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { BulkExpUpload } from "@/components/BulkExpUpload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function BulkExpPage() {
  await requireUser(["master"]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="h1 mb-0">Bulk upload Exp</h1>
        <Link className="link text-sm" href="/bulk">Bulk upload bookings</Link>
      </div>
      <div className="card space-y-2 text-sm">
        <p>Master only. Lines go straight into Exp — no approval step. One row is one Exp line: rows with the same <b>DocNo</b> become one document, rows with a blank DocNo are one document each and are numbered automatically.</p>
        <p>The same checks as the Exp form apply (head, mode, Chq / UTR details, BkgID, Emp, duplicate cheques). Nothing is saved unless every row passes. Up to 500 rows per file.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a className="btn" href="/api/template/exp?format=xlsx">Download Excel template (with instructions)</a>
          <a className="btn" href="/api/template/exp?format=csv">Download CSV template</a>
        </div>
      </div>
      <BulkExpUpload />
    </div>
  );
}
