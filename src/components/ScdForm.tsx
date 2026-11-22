"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { computeBooking } from "@/lib/calc/booking";
import { Hierarchy } from "@/lib/calc/hierarchy";
import { applyLookups, demandSchedule, employeeNames, priceListFor, projectNames, type FormData, type MasterData } from "@/lib/masters";
import { FORM_STATUSES, PROPERTY_TYPES, SOURCES_OF_LEAD } from "@/lib/fields";
import { fmtDate, fmtNum } from "@/lib/format";
import { bkgEditAction, saveScdAction, submitScdAction } from "@/app/actions";
import { COMPANY } from "../lib/company";

const MASTER_FIELDS = ["Builder", "ProjectLocation", "Area", "PaymentPlan", "BSPPSF", "OtherChargesPSF", "DSlab", "DSlabType"];

type Mode = { kind: "new" } | { kind: "edit"; id: number; resubmit: boolean } | { kind: "bkg"; bkgId: string };

export function ScdForm({ masters, initial, role, mode }: { masters: MasterData; initial: FormData; role: string; mode: Mode }) {
  const router = useRouter();
  const [d, setD] = useState<FormData>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [agree, setAgree] = useState(mode.kind !== "new");
  const [pending, start] = useTransition();
  const backOffice = role === "admin" || role === "master";

  const hierarchy = useMemo(() => new Hierarchy(masters.employees), [masters.employees]);
  const filled = useMemo(() => applyLookups(d, masters, true), [d, masters]);
  const MANUAL = COMPANY.manualMasters; // TRPL: master-derived fields are typed; the masters only suggest (grey hint, used when left blank)
  const calc = useMemo(
    () =>
      computeBooking(filled, {
        hierarchy,
        exp: [],
        rcra: masters.rcra.map((r) => ({ rcra: r.name, ra: r.ra })),
        overrides: [],
        allBkgIds: [],
      }),
    [filled, hierarchy, masters.rcra],
  );
  const pl = priceListFor(masters, filled.Project, filled.BkgLoginDate);
  const schedule = demandSchedule(filled, masters);
  const units = masters.inventory.filter(
    (u) => u.project === filled.Project && (u.status === "Available" || u.unitNo === String(initial.UnitNo ?? "")),
  );
  const empNames = useMemo(() => employeeNames(masters), [masters]);

  const set = (k: string, v: string | number | null) =>
    setD((p) => {
      const n = { ...p, [k]: v };
      if (k === "Project") {
        n.UnitNo = null;
        if (MANUAL) for (const f of MASTER_FIELDS) n[f] = null; // a new project: re-suggest from the masters
      }
      if (k === "Emp" || k === "BkgLoginDate") n.Branch = null; // re-derive from Emp, still editable
      return n;
    });

  const txt = (k: string, label: string, opts: { type?: string; ro?: boolean; req?: boolean } = {}) => {
    const ro = opts.ro && !(MANUAL && MASTER_FIELDS.includes(k));
    return (
    <Field k={k} label={label} req={opts.req} errors={errors}>
      <input
        id={k}
        className="input"
        type={opts.type ?? "text"}
        readOnly={ro}
        placeholder={!ro && MANUAL && MASTER_FIELDS.includes(k) && filled[k] != null ? String(filled[k]) : undefined}
        value={String((ro ? filled[k] : d[k]) ?? "")}
        onChange={(e) => set(k, e.target.value === "" ? null : e.target.value)}
      />
    </Field>
    );
  };
  const num = (k: string, label: string, ro0 = false) => {
    const ro = ro0 && !(MANUAL && MASTER_FIELDS.includes(k));
    return (
    <Field k={k} label={label} errors={errors}>
      <input
        id={k}
        className="input text-right"
        inputMode="decimal"
        readOnly={ro}
        placeholder={!ro && MANUAL && MASTER_FIELDS.includes(k) && filled[k] != null ? fmtNum(filled[k]) : undefined}
        value={ro ? fmtNum(filled[k]) : String(d[k] ?? "")}
        onChange={(e) => set(k, e.target.value === "" ? null : Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))}
      />
    </Field>
    );
  };
  const sel = (k: string, label: string, options: string[], req = false) => (
    <Field k={k} label={label} req={req} errors={errors}>
      <select id={k} className="input" value={String(d[k] ?? "")} onChange={(e) => set(k, e.target.value || null)}>
        <option value="">— select —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  );
  // Builder / Project location come from the Project Master by themselves (typed only if the master has none for the project)
  const pick = (k: "Builder" | "ProjectLocation", label: string) => {
    const p = masters.projects.find((x) => x.name.toLowerCase() === String(filled.Project ?? "").toLowerCase());
    const fromMaster = k === "Builder" ? p?.builder : p?.location;
    if (fromMaster) return <Field k={k} label={label} errors={errors}><input id={k} className="input" readOnly value={String(filled[k] ?? "")} /></Field>;
    return txt(k, label);
  };
  const out = (label: string, v: unknown, strong = false) => (
    <div>
      <span className="label">{label}</span>
      <div className={`rounded-md bg-slate-50 px-2.5 py-1.5 text-right text-sm ${strong ? "font-semibold" : ""}`}>{fmtNum(v) || "—"}</div>
    </div>
  );

  function submit() {
    setMessage(null);
    if (!agree) return setMessage("Please accept the declaration at the bottom of the form.");
    start(async () => {
      if (mode.kind === "bkg") {
        // what the screen shows for the master-driven fields (Builder, Location, suggested prices, Branch) is what is saved
        const send: FormData = { ...d };
        for (const k of [...MASTER_FIELDS, "Branch"]) if (d[k] === null || d[k] === undefined || d[k] === "") send[k] = filled[k] ?? null;
        if (MANUAL) { send.Builder = filled.Builder ?? null; send.ProjectLocation = filled.ProjectLocation ?? null; }
        const e = await bkgEditAction(mode.bkgId, send);
        if (e.ok) { router.push(e.applied ? `/bookings/${mode.bkgId}?saved=1` : `/changes/${e.id}`); router.refresh(); }
        else { setErrors(e.errors ?? {}); setMessage(e.message ?? "Please fix the highlighted fields."); window.scrollTo({ top: 0, behavior: "smooth" }); }
        return;
      }
      const r = mode.kind === "new" ? await submitScdAction(d) : await saveScdAction(mode.id, d);
      if (r.ok) {
        if (r.bkgId) router.push(`/bookings/${r.bkgId}`);
        else router.push(`/submissions/${r.id}`);
        router.refresh();
      } else {
        setErrors(r.errors ?? {});
        setMessage(r.message ?? "Please fix the highlighted fields.");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  return (
    <div className="space-y-4">
      {message && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{message}</div>}
      {mode.kind === "bkg" && (
        <div className="card border-sky-200 bg-sky-50 text-sm">
          Editing booking <b>{mode.bkgId}</b>. White boxes can be changed; grey boxes are calculated, or come from the Project Master / price list and change when you change the project or date.
          Receipts and dues come from Exp and are not edited here. {role === "master" ? "Your changes are saved at once and logged." : "Your changes go to Master for approval; nothing changes until Master approves."}
        </div>
      )}

      <Section title="Lead">
        {sel("SourceOfLead", "Source of lead", SOURCES_OF_LEAD, true)}
        {sel("PropertyType", "Property type", PROPERTY_TYPES, true)}
      </Section>

      <Section title="Booking">
        {txt("BkgLoginDate", "Date of booking", { type: "date", req: true })}
        {COMPANY.key === "trpl" && txt("ERPID", "ERP ID")}
        <Field k="FormStatus" label="Form status" req errors={errors}>
          <select id="FormStatus" className="input" value={String(d.FormStatus ?? "Not Live")} onChange={(e) => set("FormStatus", e.target.value)}>
            {FORM_STATUSES.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field k="Emp" label="Associate (Emp)" req errors={errors}>
          <input id="Emp" className="input" list="emp-list" value={String(d.Emp ?? "")} onChange={(e) => set("Emp", e.target.value || null)} placeholder="Type to search" />
          <datalist id="emp-list">{empNames.map((n) => <option key={n} value={n} />)}</datalist>
        </Field>
        <div>
          <span className="label">Director (auto)</span>
          <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">{String(calc.Director ?? "") || "—"}</div>
        </div>
        <Field k="Branch" label="Branch (from Emp, editable)" errors={errors}>
          <input id="Branch" className="input" value={String(d.Branch ?? filled.Branch ?? "")} onChange={(e) => set("Branch", e.target.value || null)} />
        </Field>
      </Section>

      <Section title="Client details">
        {txt("Client", "Applicant name", { req: true })}
        {txt("CoApplicant", "Co-applicant")}
        {txt("ContactNo", "Mobile 1", { req: true })}
        {txt("Mobile2", "Mobile 2")}
        {txt("Email", "Email", { type: "email" })}
        {txt("Address", "Address")}
        {txt("AreaSectorColony", "Area / sector / colony")}
        {txt("City", "City")}
        {txt("State", "State")}
        {txt("PIN", "PIN")}
        {txt("Aadhaar", "Aadhaar no.")}
        {txt("PAN", "PAN no.")}
      </Section>

      <section className="card">
        <h2 className="h2">Project / Unit</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {sel("Project", "Project", MANUAL ? projectNames(masters) : masters.projects.map((p) => p.name), true)}
        {MANUAL ? pick("Builder", "Builder") : txt("Builder", "Builder", { ro: true })}
        {MANUAL ? pick("ProjectLocation", "Project location") : txt("ProjectLocation", "Project location", { ro: true })}
        {MANUAL ? (
          <Field k="UnitNo" label="Unit no." req errors={errors}>
            <input id="UnitNo" className="input" list="unit-list" value={String(d.UnitNo ?? "")} onChange={(e) => set("UnitNo", e.target.value || null)} />
            <datalist id="unit-list">{units.map((u) => <option key={u.unitNo} value={u.unitNo} />)}</datalist>
          </Field>
        ) : (
        <Field k="UnitNo" label="Unit no. (available only)" req errors={errors}>
          <select id="UnitNo" className="input" value={String(d.UnitNo ?? "")} onChange={(e) => set("UnitNo", e.target.value || null)} disabled={!filled.Project}>
            <option value="">{filled.Project ? (units.length ? "— select —" : "No units available") : "Pick a project first"}</option>
            {units.map((u) => <option key={u.unitNo} value={u.unitNo}>{u.unitNo}</option>)}
          </select>
        </Field>
        )}
        {txt("BuilderUID", "Builder UID")}
        <div className="hidden md:block" />
        {num("Area", "Area (sq ft)", true)}
        {txt("PaymentPlan", "Payment plan", { ro: true })}
        </div>
      </section>

      {!MANUAL && filled.Project && filled.BkgLoginDate && !pl && (
        <div className="card border-amber-300 bg-amber-50 text-sm">No price list covers {String(filled.Project)} on {fmtDate(filled.BkgLoginDate)}. Ask the back office to update the price list.</div>
      )}

      <section className="card">
        <h2 className="h2">Costing details</h2>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-3">
          <div className="space-y-3">
            {num("BSPPSF", "BSPPSF (price list)", true)}
            {out("Total DiscountPSF", totalDiscount(filled))}
            {out("NetBSPPSF", calc.NetBSPPSF, true)}
            {out("TotalChargesPSF", calc.TotalChargesPSF)}
            {out("TotalCostPSF", calc.TotalCostPSF, true)}
            {out("TotalCostAmt", calc.TotalCostAmt)}
            {COMPANY.gstManual ? num("GST", "GST (Rs) - only if charged") : out(`GST (${Math.round(COMPANY.gstRate * 100)}%)`, calc.GST)}
            {out("TCWithGST", calc.TCWithGST, true)}
          </div>
          <div className="space-y-3">
            {num("InaugralDiscountPSF", "InaugralDiscountPSF")}
            {num("NPVDiscountPSF", "NPVDiscountPSF")}
            {num("SchemeDiscountPSF", "SchemeDiscountPSF")}
            {num("FormRevisedPSF", "FormRevisedPSF", !backOffice)}
            {num("AgreementRevisedPSF", "AgreementRevisedPSF", !backOffice)}
            {num("PaymentPlanDiscountPSF", "PaymentPlanDiscountPSF")}
            {num("OnFormDiscountPSF", "OnFormDiscountPSF")}
          </div>
          <div className="space-y-3">
            {num("PLCPSF", "PLC (PSF)")}
            {num("IFMSPSF", "IFMS (PSF)")}
            {num("PowerBackupPSF", "Power Backup (PSF)")}
            {num("SinkingFundClubPSF", "Sinking Fund/Club (PSF)")}
            {num("OtherChargesPSF", "Other Charges (PSF) (price list)", true)}
          </div>
        </div>
      </section>

      {schedule.length > 0 && (
        <section className="card">
          <h2 className="h2">Demand due dates</h2>
          <table className="table">
            <thead><tr><th>Milestone</th><th>%</th><th>Due date</th><th className="text-right">Amount incl. GST</th></tr></thead>
            <tbody>
              {schedule.map((s) => (
                <tr key={s.label}>
                  <td>{s.label}</td><td>{Math.round(s.pct * 100)}%</td><td>{fmtDate(s.date)}</td>
                  <td className="text-right">{fmtNum(Math.round(s.pct * Number(calc.TCWithGST ?? 0)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Section title="Broker details">
        {txt("BrokerName", "Broker name")}
        {num("BrokerAmt", "Broker amount (Rs)")}
        {num("CreditNoteAmt", "Credit note amount (Rs)")}
      </Section>

      <section className="card">
        <h2 className="h2">Slabs & revenue</h2>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-3">
          <div className="space-y-3">
            {num("CSlab", backOffice ? "CSlab" : "CSlab (back office)", !backOffice)}
            {txt("CSlabType", "CSlabType", { ro: !backOffice })}
            {out("CoRev", calc.CoRev, true)}
          </div>
          <div className="space-y-3">
            {num("DSlab", "DSlab (price list)", true)}
            {txt("DSlabType", "DSlabType", { ro: true })}
            {out("DirectorRevenue", calc.DirectorRevenue, true)}
          </div>
          <div className="space-y-3">
            {num("ASlab", backOffice ? "ASlab" : "ASlab (back office)", !backOffice)}
            {txt("ASlabType", "ASlabType", { ro: !backOffice })}
            {out("AssociateRevenue", calc.AssociateRevenue, true)}
          </div>
        </div>
      </section>

      <Section title="Incentives applicable on this booking (Rs)">
        {num("DirectorSplRevenue", "Director special revenue")}
        {num("SpinToWin", "Spin to win")}
        {num("IncentiveRV", "Incentive RV")}
        {num("IncentivePOC", "Incentive POC")}
        {num("IncentiveBuilder", "Incentive builder")}
      </Section>

      {backOffice && (
        <Section title="Back office (Admin / Master only)">
          {txt("BBA Status", "BBA status")}
          {sel("RC/RA", "RC/RA", masters.rcra.map((r) => r.name))}
          {sel("CalcBasis", "Calc basis", ["TC", "BSP"])}
          {num("UnitAdj", "Unit adjustment")}
          {txt("SlabRemarks", "Slab remarks")}
          {txt("SIFStatus", "SIF status")}
          {txt("WorkingRemarks", "Working remarks")}
          {txt("ExpectedCollectionDate", "Expected collection date", { type: "date" })}
          {num("RAAchievePertenage", "RA achieve %")}
        </Section>
      )}

      <section className="card space-y-3">
        {mode.kind !== "bkg" && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I undertake that the details mentioned above are true and I am solely responsible for all the details filled and commitments given to the Client(s). {COMPANY.legalName} is not responsible for any of my actions/commitments to the Client(s).</span>
        </label>
        )}
        <button className="btn btn-primary" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : mode.kind === "bkg" ? (role === "master" ? "Save changes to Bkg" : "Send changes to Master for approval") : mode.kind === "new" ? (role === "master" ? "Save to Bkg" : "Submit for approval") : mode.resubmit ? "Resubmit for approval" : "Save changes"}
        </button>
      </section>
    </div>
  );
}

const DISCOUNT_KEYS = ["InaugralDiscountPSF", "NPVDiscountPSF", "SchemeDiscountPSF", "FormRevisedPSF", "AgreementRevisedPSF", "PaymentPlanDiscountPSF", "OnFormDiscountPSF"];
function totalDiscount(d: FormData) {
  return DISCOUNT_KEYS.reduce((s, k) => s + (typeof d[k] === "number" ? (d[k] as number) : 0), 0);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="h2">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function Field({ k, label, req, errors, children }: { k: string; label: string; req?: boolean; errors: Record<string, string>; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={k}>{label}{req && <span className="text-red-600"> *</span>}</label>
      {children}
      {errors[k] && <p className="err">{errors[k]}</p>}
    </div>
  );
}
