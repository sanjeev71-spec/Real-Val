// Field definitions for the Emp forms (shared by browser and server pages).

export type EmpFieldType = "text" | "date" | "number" | "select" | "emp";
export interface EmpField {
  key: string;
  label: string;
  type: EmpFieldType;
  options?: string[];
  hint?: string;
}

/** Fields that belong to a period — changing them starts a new period from an effective date. */
export const PERIOD_FIELDS: EmpField[] = [
  { key: "reportingHead", label: "Reporting head", type: "emp" },
  { key: "branch", label: "Branch", type: "text" },
  { key: "type", label: "Type", type: "select", options: ["Sales", "Back Office", "CP"] },
  { key: "designation", label: "Designation", type: "text" },
  { key: "department", label: "Department", type: "text" },
  { key: "revShare", label: "RevShare (0–1)", type: "number", hint: "1 = 100%. Non-zero puts them in the revenue-share chain." },
  { key: "expShare", label: "ExpShare (0–1)", type: "number", hint: "Share of their team's expenses they carry; the rest goes one level up." },
  { key: "applicable", label: "Seat cost applicable", type: "select", options: ["Y", "N"] },
  { key: "seatChargeStart", label: "Seat charge start", type: "date" },
  { key: "company", label: "Company", type: "text" },
  { key: "status", label: "Status", type: "select", options: ["Active", "Inactive"] },
  { key: "remarks", label: "Remarks", type: "text" },
];

/** Personal fields — visible to Master and HR only. Corrected in place, no new period. */
export const PERSON_FIELDS: EmpField[] = [
  { key: "gender", label: "Gender", type: "select", options: ["Male", "Female", "Other"] },
  { key: "doj", label: "Date of joining", type: "date" },
  { key: "email", label: "Personal email", type: "text" },
  { key: "mobile", label: "Mobile", type: "text" },
  { key: "dob", label: "Date of birth", type: "date" },
  { key: "salary", label: "Salary", type: "text" },
  { key: "minSalary", label: "Min salary", type: "text" },
  { key: "fatherName", label: "Father's name", type: "text" },
  { key: "motherName", label: "Mother's name", type: "text" },
  { key: "permanentAddress", label: "Permanent address", type: "text" },
  { key: "currentAddress", label: "Current address", type: "text" },
  { key: "pan", label: "PAN", type: "text" },
  { key: "aadhaar", label: "Aadhaar", type: "text" },
  { key: "bankName", label: "Bank name", type: "text" },
  { key: "bankAccount", label: "Bank A/c no.", type: "text" },
  { key: "ifsc", label: "IFSC", type: "text" },
];

/** What "Correct details" may change in place. */
export const CORRECT_FIELDS: EmpField[] = [
  ...PERSON_FIELDS,
  ...PERIOD_FIELDS.filter((f) => ["designation", "department", "applicable", "seatChargeStart", "remarks"].includes(f.key)),
];
