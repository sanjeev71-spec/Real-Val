import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canUploadEmp } from "@/lib/company";
import { EmpUploadForm } from "@/components/EmpUploadForm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function UploadEmpPage() {
  const user = await requireUser(["hr", "master"]);
  if (!canUploadEmp(user.role)) notFound();
  const isMaster = user.role === "master";
  return (
    <div className="space-y-4">
      <h1 className="h1">Upload Emp — new employees, history changes, corrections and exits</h1>
      <div className="card space-y-2 text-sm">
        <p>
          {isMaster ? "Your upload is applied at once and logged as one change." : "Your upload is sent to Master as one change. Nothing changes in Emp until Master approves it."}
          {" "}Nothing is saved unless every row passes, and nothing is ever deleted by an upload.
        </p>
        <p>One row = one action on one employee, chosen in the <b>Action</b> column:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li><b>New</b> — add an employee: Emp Code, Name, ReportingHead (Name~Code) and DOJ are needed. Their first history row starts on the DOJ.</li>
          <li><b>Change</b> — a new <b>history row</b> from <b>Effective From</b> (reporting head, branch, type, shares, designation …). The current row closes the day before, so earlier bookings keep the old hierarchy.</li>
          <li><b>Correct</b> — fix details on the current row without a new history row (mobile, PAN, bank, DOJ, designation …).</li>
          <li><b>Exit</b> — the employee leaves on <b>Exit Date</b>; their reportees move one level up from the next day, or to <b>Reportees Move To</b> when filled.</li>
        </ul>
        <p>Blank cells keep the stored value; <code>[clear]</code> empties a field. <b>Colours:</b> green headings are typed by hand and read on upload; the grey reference sheet in the template is only for looking up codes. Up to 300 rows.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a className="btn" href="/api/template/emp?format=xlsx">Download Excel template (examples, instructions, current employees)</a>
          <a className="btn" href="/api/template/emp?format=csv">Download CSV template</a>
          <a className="btn" href="/emp">Emp list (has the Download Excel)</a>
        </div>
      </div>
      <EmpUploadForm isMaster={isMaster} />
    </div>
  );
}
