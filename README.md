# Real-Val — Realty Vault booking system

Web version of the RealV workbook's **SCD** form (entry), **SCD Logged** (lookup) and **Bkg** table, with approvals.

- **Next.js** on **Vercel**, data in **Neon Postgres**.
- Every Bkg formula (costing, GST 12%, slab revenue, Exp-based receipts and dues, the Emp hierarchy / revenue-share waterfall)
  is ported to TypeScript in `src/lib/calc/` and checked against Excel's own values by `tests/parity.test.ts`.

## Roles and approval flow

| Who | Submits an SCD | Then |
|---|---|---|
| Sales user | → **Waiting for Admin** | Admin approves → **Waiting for Master** → Master validates → added to Bkg with a new BkgID |
| Admin | → **Waiting for Master** | Master validates → added to Bkg |
| Master (sanjeev71@gmail.com) | → added to Bkg immediately | — |

- Any approver can **send back** (submitter edits and resubmits) or **reject**; both need a comment.
- Master can **send to superior**: an email with a single-use, 7-day link; the superior's decision comes back to Master, who still validates.
- **Nudge** re-sends the approval email to whoever it is waiting on (once every 4 hours).
- Units are blocked while an SCD for them is pending, and once a Live / Not Live booking exists.
- **Bulk upload** (Master only): CSV or XLSX in the template's format, straight into Bkg, all-or-nothing.

## Sign-in

No passwords. Each sign-in emails a 6-digit code (valid 10 minutes, 5 attempts, 1 per minute).
Master adds people on the **Users** page; disabling a user blocks them at once.

## Data that stays in Excel for now

Emp, Exp and the Master sheets are still maintained in Excel. To refresh the web app:

```powershell
powershell -File scripts/export-excel.ps1 -Workbook "C:\path\to\RealV.xlsb"
npm run import:excel -- --masters-only     # refresh masters, Emp, Exp
npm run import:excel                       # same, plus add Bkg rows not yet in the DB
```

`data/` holds client and employee data and is never committed. Employee PAN/Aadhaar/bank details are not exported.

## Local development

```bash
npm install
npm run db:migrate
npm run import:excel
npm run dev
```

Without Gmail settings, emails (including sign-in codes) are printed in the terminal.

## Deploying

1. Vercel → import the GitHub repo `Real-Val`.
2. Vercel project → **Storage** → **Create / Connect Database** → **Neon** → region Singapore. This sets `DATABASE_URL`.
3. Settings → Environment Variables: `SESSION_SECRET`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `MASTER_EMAIL`.
4. Deploy. The build (`vercel-build`) applies database migrations first.
5. Load your data once: put the Neon `DATABASE_URL` in `.env.local` and run `npm run import:excel`.
