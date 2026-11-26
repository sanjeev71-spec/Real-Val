import { currentUser } from "@/lib/auth";
import { canUploadEmp } from "@/lib/company";
import { currentPeriods, employeesWithCalc } from "@/lib/data";
import { empTemplateCsv, empTemplateXlsx } from "@/lib/empUpload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Emp upload template (Master; HR where the company allows Emp upload): ?format=xlsx (examples, instructions, current employees) or ?format=csv (headings only). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || !canUploadEmp(user.role)) return new Response("Not allowed", { status: 403 });
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new Response("﻿" + empTemplateCsv() + "\n", {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="Emp-upload-template.csv"' },
    });
  }
  const cur = currentPeriods(await employeesWithCalc()).map((r) => ({
    emp: r.emp, reportingHead: r.reportingHead, branch: r.branch, designation: r.designation, director: r.calc.director, active: r.changeDateTo === null,
  }));
  return new Response(new Uint8Array(await empTemplateXlsx(cur)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Emp-upload-template.xlsx"',
    },
  });
}
