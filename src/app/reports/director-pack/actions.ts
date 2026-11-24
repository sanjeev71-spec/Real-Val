"use server";
import { requireUser } from "@/lib/auth";
import { computedBookings, currentPeriods, employeesWithCalc, expWithCalc, loadPnlData, pnlDirectors } from "@/lib/data";
import { storedExpFields } from "@/lib/expRemarks";
import { buildDirectorPack } from "@/lib/directorPack";
import { sendMail } from "@/lib/mail";
import { COMPANY } from "@/lib/company";

const codeOf = (d: string) => (d.split("~")[1] ?? "").toLowerCase();
const isoOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const mailOk = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

export interface PackRecipient { director: string; email: string }

/** The mail address stored for each Director (latest Emp period that has one). */
export async function packRecipientsAction(directors: string[]): Promise<PackRecipient[]> {
  await requireUser(["master"]);
  const all = await employeesWithCalc();
  const emps = currentPeriods(all);
  return directors.map((director) => {
    const c = codeOf(director);
    const cur = emps.find((e) => codeOf(e.emp) === c)?.email?.trim();
    const any = all.filter((e) => codeOf(e.emp) === c && e.email?.trim()).sort((a, b) => b.changeDateFrom.localeCompare(a.changeDateFrom))[0]?.email?.trim();
    return { director, email: cur || any || "" };
  });
}

export interface PackSendResult { director: string; email: string; ok: boolean; message?: string }

/** Builds each Director's pack and emails it (to the Director and a copy to the sender; testOnly sends everything to the sender alone). */
export async function sendPacksAction(input: { items: PackRecipient[]; bf: string; bt: string; ef: string; et: string; testOnly: boolean }): Promise<PackSendResult[]> {
  const user = await requireUser(["master"]);
  const { bf, bt, ef, et } = input;
  if (![bf, bt, ef, et].every(isoOk)) return input.items.map((i) => ({ ...i, ok: false, message: "Choose all four dates" }));
  const items = input.items.slice(0, 10);
  const valid = new Set(await pnlDirectors());
  const [pnl, bookings, exps, emps, storedExp] = await Promise.all([loadPnlData(), computedBookings(), expWithCalc(), employeesWithCalc(), storedExpFields()]);
  const today = new Date().toISOString().slice(0, 10);
  const out: PackSendResult[] = [];
  for (const it of items) {
    try {
      if (!valid.has(it.director)) throw new Error("Unknown Director");
      const to = input.testOnly ? user.email : it.email.trim();
      if (!mailOk(to)) throw new Error("No valid email address");
      const data = await buildDirectorPack({ director: it.director, bkgFrom: bf, bkgTo: bt, expFrom: ef, expTo: et, pnl, bookings, exps, emps, storedExp });
      const name = it.director.split("~")[0];
      const file = `PnL - ${name.replace(/[^A-Za-z0-9 _.-]+/g, "_").trim()} - ${today}.xlsx`;
      await sendMail({
        to,
        cc: input.testOnly || to.toLowerCase() === user.email.toLowerCase() ? undefined : user.email,
        replyTo: user.email,
        subject: `${input.testOnly ? "[TEST] " : ""}${COMPANY.name} - P&L pack for ${name}`,
        html: `<p>Dear ${name},</p><p>Please find attached your P&amp;L pack.</p>
          <ul><li>Booking period: ${dmy(bf)} to ${dmy(bt)}</li><li>Exp period: ${dmy(ef)} to ${dmy(et)}</li></ul>
          <p>Sheets: P&amp;L Summary, Bkg Data, Exp Data, Employee Data.</p>
          ${input.testOnly ? `<p><i>Test copy of the pack for ${it.director}; not sent to the Director.</i></p>` : ""}`,
        attachments: [{ filename: file, content: data }],
      });
      out.push({ director: it.director, email: to, ok: true });
    } catch (e) {
      out.push({ director: it.director, email: it.email, ok: false, message: e instanceof Error ? e.message : "Failed" });
    }
  }
  return out;
}
