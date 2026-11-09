import ExcelJS from "exceljs";
import { currentUser } from "@/lib/auth";
import { employeesWithCalc } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Emp table in the same column layout as the Excel Emp sheet (Master and HR only — contains personal data). */
export async function GET() {
  const user = await currentUser();
  if (!user || (user.role !== "hr" && user.role !== "master")) return new Response("Not allowed", { status: 403 });
  const rows = await employeesWithCalc();
  const cols: [string, (r: (typeof rows)[number]) => unknown][] = [
    ["Applicable", (r) => r.applicable], ["ManMonths", (r) => r.calc.manMonths], ["SeatCost", (r) => r.calc.seatCost],
    ["Emp", (r) => r.emp], ["ReportingHead", (r) => r.reportingHead], ["Director", (r) => r.calc.director],
    ["Status", (r) => r.status], ["Gender", (r) => r.gender], ["Branch", (r) => r.branch], ["Type", (r) => r.type],
    ["RevShare", (r) => r.revShare], ["ExpShare", (r) => r.expShare], ["DOJ", (r) => r.doj],
    ["ChangeDateFrom", (r) => r.changeDateFrom], ["ChangeDateTo", (r) => r.changeDateTo ?? new Date().toISOString().slice(0, 10)],
    ["DOExit/Change", (r) => r.exitDate], ["DaysWorked", (r) => r.calc.daysWorked], ["Company", (r) => r.company],
    ["Designation", (r) => r.designation], ["Department", (r) => r.department], ["Remarks", (r) => r.remarks],
    ["Mobile", (r) => r.mobile], ["Personal Mail ID", (r) => r.email], ["DOB", (r) => r.dob], ["Salary", (r) => r.salary],
    ["MinSalary", (r) => r.minSalary], ["Father's Name", (r) => r.fatherName], ["Mother's Name", (r) => r.motherName],
    ["Permanent Address", (r) => r.permanentAddress], ["Current Address", (r) => r.currentAddress], ["PAN", (r) => r.pan],
    ["Aadhaar", (r) => r.aadhaar], ["Bank Name", (r) => r.bankName], ["BankA/cNo", (r) => r.bankAccount], ["IFSC", (r) => r.ifsc],
    ["SeatChargeStart", (r) => r.seatChargeStart], ["Key", (r) => r.calc.key],
  ];
  const dateCols = new Set(["DOJ", "ChangeDateFrom", "ChangeDateTo", "DOExit/Change", "DOB", "SeatChargeStart"]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Emp");
  ws.columns = cols.map(([h]) => ({ header: h, key: h, width: Math.max(10, h.length + 2), style: dateCols.has(h) ? { numFmt: "dd-mm-yyyy" } : {} }));
  for (const r of rows)
    ws.addRow(Object.fromEntries(cols.map(([h, f]) => {
      const v = f(r);
      return [h, dateCols.has(h) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : v ?? null];
    })));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return new Response(await wb.xlsx.writeBuffer(), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Emp-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
