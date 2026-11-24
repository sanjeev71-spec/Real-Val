import { currentUser } from "@/lib/auth";
import { employeesWithCalc } from "@/lib/data";
import { empWorkbook } from "@/lib/excelExport";

export const dynamic = "force-dynamic";

/** Emp table in the same column layout as the Excel Emp sheet (Master and HR only — contains personal data). */
export async function GET() {
  const user = await currentUser();
  if (!user || (user.role !== "hr" && user.role !== "master")) return new Response("Not allowed", { status: 403 });
  const rows = await employeesWithCalc();
  return new Response(await empWorkbook(rows), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Emp-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
