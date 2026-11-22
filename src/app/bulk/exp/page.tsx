import { requireUser } from "@/lib/auth";
import { BulkExpUpload } from "@/components/BulkExpUpload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function UploadExpPage() {
  const user = await requireUser(["admin", "master"]);
  const isMaster = user.role === "master";
  return (
    <div className="space-y-4">
      <h1 className="h1">Upload Exp — add new transactions and correct existing ones</h1>
      <div className="card space-y-2 text-sm">
        <p>
          {isMaster
            ? "Your upload is applied at once and logged as one change."
            : "Your upload is sent to Master as one change. Nothing changes in Exp until Master approves it."}
          {" "}Nothing is saved unless every row passes, and nothing is ever deleted by an upload.
        </p>
        <p><b>To correct existing lines:</b> download Exp (or a Data exceptions check), change the cells and upload that file as it is. A row whose <b>DocNo</b> is an existing line is a correction of that line; blank cells keep the stored value, and <code>[clear]</code> empties a field.</p>
        <p><b>To add new transactions:</b> leave DocNo blank. To make one transaction of several rows, type the same label in the <b>Group</b> column on those rows: they are saved as one document with an automatic number and lines -01, -02 … Rows without a Group are one document each. You can mix corrections and new rows in the same file (up to 500 rows).</p>
        <p><b>Colours:</b> in the Exp download and in the template, <b>green</b> headings are typed by hand and read on upload; <b>grey</b> ones (ExpType, SignedGross, Client, Director, Rcv_ ... and the yellow Data Exception Remarks) are built in and ignored on upload even if changed. An entry without a DocNo shows its row id there - keep it. To <b>add a line to an existing document</b>, give the same Group label to the existing row (keep its DocNo) and to the new row (blank DocNo); the old DocNo is not changed. <b>ExpMonth</b> is optional: blank = built in from PayDate; a month typed there (2026-10 or Oct-2026) is kept as typed, [clear] goes back to the PayDate month. Up to 500 rows per upload.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a className="btn" href="/api/template/exp?format=xlsx">Download Excel template (with instructions)</a>
          <a className="btn" href="/api/template/exp?format=csv">Download CSV template</a>
          <a className="btn" href="/exp">Exp list (has the Download Excel)</a>
        </div>
      </div>
      <BulkExpUpload isMaster={isMaster} />
    </div>
  );
}
